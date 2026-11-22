import type { Queryable } from './pool.ts'
import type { Activity } from './types.ts'

import { activityColumns } from './activities/queries.ts'
import { query, withUserTransaction } from './connection.ts'
import { deleteNoteLinksOfTarget } from './note-links.ts'
import { deleteNotesForEntitiesIn } from './notes.ts'
import { mapActivityRow } from './row-mappers.ts'

export interface PersonRecord {
  id: string
  name: string
  relationship: string | null
  birth_month: number | null
  birth_day: number | null
  birth_year: number | null
  birthday_notify_days_before: number | null
  pronouns: string | null
  actor_uri: string | null
  actor_handle: string | null
  actor_name: string | null
  actor_icon: string | null
  actor_cached_at: Date | null
  archived: boolean
  deleted_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface PersonActorCache {
  actor_handle: string | null
  actor_name: string | null
  actor_icon: string | null
}

export interface PersonFields {
  name?: string
  relationship?: string | null
  birth_month?: number | null
  birth_day?: number | null
  birth_year?: number | null
  birthday_notify_days_before?: number | null
  pronouns?: string | null
  archived?: boolean
  /** Setting it (or null) also replaces the presentation cache with `actor_cache`. */
  actor_uri?: string | null
  actor_cache?: PersonActorCache
}

export interface PersonInsert extends PersonFields {
  name: string
}

export interface PersonDateRecord {
  id: string
  person_id: string
  label: string
  kind: string
  month: number
  day: number
  year: number | null
  notify_days_before: number | null
  created_at: Date
  updated_at: Date
}

export interface PersonDateFields {
  label?: string
  kind?: string
  month?: number
  day?: number
  year?: number | null
  notify_days_before?: number | null
}

export interface PersonDateInsert extends PersonDateFields {
  label: string
  kind: string
  month: number
  day: number
}

/** A dated entry of a live, non-archived person: one of their dates, or their birthday (`date_id` null). */
export interface ImportantDateSource {
  person_id: string
  person_name: string
  date_id: string | null
  label: string | null
  kind: string
  month: number
  day: number
  year: number | null
  notify_days_before: number | null
}

export interface ActivityPersonRef {
  id: string
  name: string
}

const PERSON_COLUMNS = `id, name, relationship, birth_month, birth_day, birth_year, birthday_notify_days_before,
  pronouns, actor_uri, actor_handle, actor_name, actor_icon, actor_cached_at, archived, deleted_at, created_at, updated_at`

const PERSON_DATE_COLUMNS =
  'id, person_id, label, kind, month, day, year, notify_days_before, created_at, updated_at'

export const listPeople = async (
  user: string,
  options: { include_archived?: boolean } = {},
): Promise<PersonRecord[]> => {
  const result = await query<PersonRecord>(
    user,
    `SELECT ${PERSON_COLUMNS} FROM people
     WHERE deleted_at IS NULL ${options.include_archived ? '' : 'AND NOT archived'}
     ORDER BY lower(name), created_at, id`,
  )
  return result.rows
}

export const listDeletedPeople = async (user: string): Promise<PersonRecord[]> => {
  const result = await query<PersonRecord>(
    user,
    `SELECT ${PERSON_COLUMNS} FROM people WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC, id`,
  )
  return result.rows
}

/** A deleted person is as good as absent, except to restore and purge, which ask for it. */
export const getPerson = async (
  user: string,
  id: string,
  options: { include_deleted?: boolean } = {},
): Promise<PersonRecord | null> => {
  const result = await query<PersonRecord>(
    user,
    `SELECT ${PERSON_COLUMNS} FROM people WHERE id = $1 ${options.include_deleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  )
  return result.rows[0] ?? null
}

export const getLivePersonByActor = async (user: string, actorUri: string): Promise<PersonRecord | null> => {
  const result = await query<PersonRecord>(
    user,
    `SELECT ${PERSON_COLUMNS} FROM people WHERE actor_uri = $1 AND deleted_at IS NULL`,
    [actorUri],
  )
  return result.rows[0] ?? null
}

/**
 * Changes whenever a live person's name changes or a person is added, deleted, restored or purged,
 * so a cache of anything that shows a person's name can carry it in its key.
 */
export const getPeopleNamesVersion = async (user: string): Promise<string> => {
  const result = await query<{ version: string }>(
    user,
    `SELECT COUNT(*)::int || ':' || COALESCE(md5(string_agg(id::text || ':' || name, ',' ORDER BY id)), '') AS version
       FROM people WHERE deleted_at IS NULL`,
  )
  return result.rows[0]!.version
}

/** The ids among `ids` that name a live person. */
export const listLivePersonIds = async (user: string, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return []
  const result = await query<{ id: string }>(
    user,
    'SELECT id FROM people WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
    [ids],
  )
  return result.rows.map((row) => row.id)
}

const personAssignments = (fields: PersonFields): [string, unknown][] => {
  const out: [string, unknown][] = []
  const plain = [
    'name',
    'relationship',
    'birth_month',
    'birth_day',
    'birth_year',
    'birthday_notify_days_before',
    'pronouns',
    'archived',
  ] as const
  for (const column of plain) if (fields[column] !== undefined) out.push([column, fields[column]])
  if (fields.actor_uri !== undefined) {
    out.push(['actor_uri', fields.actor_uri])
    out.push(['actor_handle', fields.actor_cache?.actor_handle ?? null])
    out.push(['actor_name', fields.actor_cache?.actor_name ?? null])
    out.push(['actor_icon', fields.actor_cache?.actor_icon ?? null])
  }
  return out
}

const cachedAtFor = (fields: PersonFields): string | null =>
  fields.actor_uri === undefined ? null : fields.actor_uri === null ? 'NULL' : 'NOW()'

export const insertPerson = async (user: string, input: PersonInsert): Promise<PersonRecord> => {
  const assignments = personAssignments(input)
  const columns = assignments.map(([column]) => column)
  const values = assignments.map(([, value]) => value)
  const placeholders = values.map((_, i) => `$${i + 1}`)
  const cachedAt = cachedAtFor(input)
  if (cachedAt) {
    columns.push('actor_cached_at')
    placeholders.push(cachedAt)
  }
  const result = await query<PersonRecord>(
    user,
    `INSERT INTO people (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING ${PERSON_COLUMNS}`,
    values,
  )
  return result.rows[0]!
}

/** Null when there is no such live person. */
export const updatePerson = async (
  user: string,
  id: string,
  fields: PersonFields,
): Promise<PersonRecord | null> => {
  const assignments = personAssignments(fields)
  const sets = assignments.map(([column], i) => `${column} = $${i + 2}`)
  const cachedAt = cachedAtFor(fields)
  if (cachedAt) sets.push(`actor_cached_at = ${cachedAt}`)
  sets.push('updated_at = NOW()')
  const result = await query<PersonRecord>(
    user,
    `UPDATE people SET ${sets.join(', ')} WHERE id = $1 AND deleted_at IS NULL RETURNING ${PERSON_COLUMNS}`,
    [id, ...assignments.map(([, value]) => value)],
  )
  return result.rows[0] ?? null
}

/** Refreshes the presentation cache only; never touches `updated_at`. */
export const updatePersonActorCache = async (
  user: string,
  id: string,
  actorUri: string,
  cache: PersonActorCache,
): Promise<void> => {
  await query(
    user,
    `UPDATE people SET actor_handle = $3, actor_name = $4, actor_icon = $5, actor_cached_at = NOW()
     WHERE id = $1 AND actor_uri = $2`,
    [id, actorUri, cache.actor_handle, cache.actor_name, cache.actor_icon],
  )
}

export const softDeletePerson = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    'UPDATE people SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL',
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

export type PersonRestoreResult =
  | { status: 'restored' | 'live'; person: PersonRecord }
  | { status: 'not_found' }
  | { status: 'actor_taken'; person: PersonRecord; holder: PersonRecord }

/** A live one is answered as it is. Refused while another live profile holds the same actor. */
export const restorePerson = async (user: string, id: string): Promise<PersonRestoreResult> =>
  withUserTransaction(user, async (tx) => {
    const found = await query<PersonRecord>(
      tx,
      `SELECT ${PERSON_COLUMNS} FROM people WHERE id = $1 FOR UPDATE`,
      [id],
    )
    const person = found.rows[0]
    if (!person) return { status: 'not_found' }
    if (!person.deleted_at) return { person, status: 'live' }
    if (person.actor_uri) {
      const holder = await query<PersonRecord>(
        tx,
        `SELECT ${PERSON_COLUMNS} FROM people WHERE actor_uri = $1 AND deleted_at IS NULL`,
        [person.actor_uri],
      )
      if (holder.rows[0]) return { holder: holder.rows[0], person, status: 'actor_taken' }
    }
    const restored = await query<PersonRecord>(
      tx,
      `UPDATE people SET deleted_at = NULL WHERE id = $1 RETURNING ${PERSON_COLUMNS}`,
      [id],
    )
    return { person: restored.rows[0]!, status: 'restored' }
  })

const purgeIn = async (tx: Queryable, ids: string[]): Promise<number> => {
  if (ids.length === 0) return 0
  await deleteNotesForEntitiesIn(tx, 'person', ids)
  await deleteNoteLinksOfTarget(tx, 'person', ids)
  const result = await query(tx, 'DELETE FROM people WHERE id = ANY($1::uuid[])', [ids])
  return result.rowCount ?? 0
}

/** Removes a person for good, deleted or not, with their dates, notes, activity links and journal links. */
export const purgePerson = async (user: string, id: string): Promise<boolean> =>
  withUserTransaction(user, async (tx) => (await purgeIn(tx, [id])) > 0)

/** Removes for good the people deleted more than `retentionDays` ago. Returns how many. */
export const pruneDeletedPeople = async (user: string, retentionDays: number): Promise<number> =>
  withUserTransaction(user, async (tx) => {
    const due = await query<{ id: string }>(
      tx,
      `SELECT id FROM people WHERE deleted_at < NOW() - make_interval(days => $1::int)`,
      [retentionDays],
    )
    return purgeIn(
      tx,
      due.rows.map((row) => row.id),
    )
  })

export const listPersonDates = async (user: string, personId: string): Promise<PersonDateRecord[]> => {
  const result = await query<PersonDateRecord>(
    user,
    `SELECT ${PERSON_DATE_COLUMNS} FROM person_dates WHERE person_id = $1 ORDER BY month, day, created_at, id`,
    [personId],
  )
  return result.rows
}

export const getPersonDate = async (
  user: string,
  personId: string,
  dateId: string,
): Promise<PersonDateRecord | null> => {
  const result = await query<PersonDateRecord>(
    user,
    `SELECT ${PERSON_DATE_COLUMNS} FROM person_dates WHERE id = $1 AND person_id = $2`,
    [dateId, personId],
  )
  return result.rows[0] ?? null
}

export const insertPersonDate = async (
  user: string,
  personId: string,
  input: PersonDateInsert,
): Promise<PersonDateRecord> => {
  const result = await query<PersonDateRecord>(
    user,
    `INSERT INTO person_dates (person_id, label, kind, month, day, year, notify_days_before)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${PERSON_DATE_COLUMNS}`,
    [
      personId,
      input.label,
      input.kind,
      input.month,
      input.day,
      input.year ?? null,
      input.notify_days_before ?? null,
    ],
  )
  return result.rows[0]!
}

/** Null when the person has no such date. */
export const updatePersonDate = async (
  user: string,
  personId: string,
  dateId: string,
  fields: PersonDateFields,
): Promise<PersonDateRecord | null> => {
  const columns = ['label', 'kind', 'month', 'day', 'year', 'notify_days_before'] as const
  const assignments = columns.filter((column) => fields[column] !== undefined)
  const sets = [...assignments.map((column, i) => `${column} = $${i + 3}`), 'updated_at = NOW()']
  const result = await query<PersonDateRecord>(
    user,
    `UPDATE person_dates SET ${sets.join(', ')} WHERE id = $1 AND person_id = $2 RETURNING ${PERSON_DATE_COLUMNS}`,
    [dateId, personId, ...assignments.map((column) => fields[column])],
  )
  return result.rows[0] ?? null
}

export const deletePersonDate = async (user: string, personId: string, dateId: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM person_dates WHERE id = $1 AND person_id = $2', [
    dateId,
    personId,
  ])
  return (result.rowCount ?? 0) > 0
}

/** Every date and birthday of the live, non-archived people. */
export const listImportantDateSources = async (user: string): Promise<ImportantDateSource[]> => {
  const result = await query<ImportantDateSource>(
    user,
    `SELECT p.id AS person_id, p.name AS person_name, d.id AS date_id, d.label, d.kind,
            d.month, d.day, d.year, d.notify_days_before
       FROM person_dates d JOIN people p ON p.id = d.person_id
      WHERE p.deleted_at IS NULL AND NOT p.archived
     UNION ALL
     SELECT id, name, NULL, NULL, 'birthday', birth_month, birth_day, birth_year, birthday_notify_days_before
       FROM people
      WHERE deleted_at IS NULL AND NOT archived AND birth_month IS NOT NULL AND birth_day IS NOT NULL`,
  )
  return result.rows
}

/** The live people linked to each of `activityIds`, by name. */
export const getPeopleForActivities = async (
  user: string,
  activityIds: string[],
): Promise<Map<string, ActivityPersonRef[]>> => {
  const out = new Map<string, ActivityPersonRef[]>()
  if (activityIds.length === 0) return out
  const result = await query<{ activity_id: string; id: string; name: string }>(
    user,
    `SELECT ap.activity_id, p.id, p.name
       FROM activity_people ap JOIN people p ON p.id = ap.person_id
      WHERE ap.activity_id = ANY($1::uuid[]) AND p.deleted_at IS NULL
      ORDER BY lower(p.name), p.id`,
    [activityIds],
  )
  for (const row of result.rows) {
    const list = out.get(row.activity_id) ?? []
    list.push({ id: row.id, name: row.name })
    out.set(row.activity_id, list)
  }
  return out
}

/**
 * Links `personIds` to `activityId` as its whole set, and drops the links of `clearIds` (the
 * other rows of its merge group, so the set read back is exactly the one given).
 */
export const setActivityPeople = async (
  user: string,
  activityId: string,
  personIds: string[],
  clearIds: string[] = [],
): Promise<void> =>
  withUserTransaction(user, async (tx) => {
    await query(tx, 'DELETE FROM activity_people WHERE activity_id = ANY($1::uuid[])', [
      [activityId, ...clearIds],
    ])
    await addActivityPeopleIn(tx, activityId, personIds)
  })

const addActivityPeopleIn = async (tx: Queryable | string, activityId: string, personIds: string[]) => {
  if (personIds.length === 0) return
  await query(
    tx,
    `INSERT INTO activity_people (activity_id, person_id)
     SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`,
    [activityId, personIds],
  )
}

export const addActivityPeople = async (
  user: string,
  activityId: string,
  personIds: string[],
): Promise<void> => addActivityPeopleIn(user, activityId, personIds)

/** Gives `targetId` the union of the links of `sourceIds`; the sources keep theirs. */
export const copyActivityPeopleIn = async (
  tx: Queryable,
  sourceIds: string[],
  targetId: string,
): Promise<void> => {
  if (sourceIds.length === 0) return
  await query(
    tx,
    `INSERT INTO activity_people (activity_id, person_id)
     SELECT $1, person_id FROM activity_people WHERE activity_id = ANY($2::uuid[])
     ON CONFLICT DO NOTHING`,
    [targetId, sourceIds],
  )
}

export interface PersonActivityFilter {
  types?: string[]
  start?: Date
  end?: Date
}

/** A position in a person's activities: the start in epoch microseconds (exact, unlike a Date) and the id. */
export interface PersonActivityCursor {
  start_us: string
  id: string
}

export interface PersonActivityGroup extends PersonActivityCursor {
  activity_type: string
}

/**
 * The person's activities as merge groups, one row per group: a linked row stands for the live
 * row that supersedes it, so a synced row and its override, or the members of a cross-source
 * merge, count once whichever of them carries the link.
 */
const personActivityGroupsSql = (filter: PersonActivityFilter, params: unknown[]): string => {
  const clauses: string[] = []
  if (filter.types) {
    params.push(filter.types)
    clauses.push(`g.activity_type = ANY($${params.length}::text[])`)
  }
  if (filter.start) {
    params.push(filter.start)
    clauses.push(`g.start_time >= $${params.length}`)
  }
  if (filter.end) {
    params.push(filter.end)
    clauses.push(`g.start_time <= $${params.length}`)
  }
  return `WITH group_ids AS (
      SELECT DISTINCT COALESCE(w.id, a.id) AS id
        FROM activity_people ap
        JOIN activities a ON a.id = ap.activity_id AND a.deleted_at IS NULL
        LEFT JOIN activities w ON w.id = a.superseded_by AND w.deleted_at IS NULL
       WHERE ap.person_id = $1
    ), groups AS (
      SELECT g.id, g.activity_type, (extract(epoch FROM g.start_time) * 1000000)::bigint AS start_us
        FROM group_ids JOIN activities g ON g.id = group_ids.id
       ${clauses.length > 0 ? `WHERE ${clauses.join(' AND ')}` : ''}
    )`
}

/** A page of the person's activity groups, newest first, after `before` when given. */
export const listPersonActivityGroups = async (
  user: string,
  personId: string,
  filter: PersonActivityFilter,
  page: { before?: PersonActivityCursor; limit: number },
): Promise<PersonActivityGroup[]> => {
  const params: unknown[] = [personId]
  const groups = personActivityGroupsSql(filter, params)
  let after = ''
  if (page.before) {
    params.push(page.before.start_us, page.before.id)
    after = `WHERE (start_us, id) < ($${params.length - 1}::bigint, $${params.length}::uuid)`
  }
  params.push(page.limit)
  const result = await query<PersonActivityGroup>(
    user,
    `${groups}
     SELECT id, activity_type, start_us::text AS start_us FROM groups ${after}
      ORDER BY start_us DESC, id DESC
      LIMIT $${params.length}`,
    params,
  )
  return result.rows
}

export const countPersonActivityGroups = async (
  user: string,
  personId: string,
  filter: PersonActivityFilter,
): Promise<number> => {
  const params: unknown[] = [personId]
  const result = await query<{ count: number }>(
    user,
    `${personActivityGroupsSql(filter, params)} SELECT COUNT(*)::int AS count FROM groups`,
    params,
  )
  return result.rows[0]!.count
}

/** The person's activity groups counted by type, most frequent first. */
export const countPersonActivityGroupsByType = async (
  user: string,
  personId: string,
): Promise<{ activity_type: string; count: number }[]> => {
  const params: unknown[] = [personId]
  const result = await query<{ activity_type: string; count: number }>(
    user,
    `${personActivityGroupsSql({}, params)}
     SELECT activity_type, COUNT(*)::int AS count FROM groups
      GROUP BY activity_type ORDER BY count DESC, activity_type`,
    params,
  )
  return result.rows
}

/** The live rows of each group in `groupIds`: the group's own row and the rows it supersedes. */
export const listActivityGroupMembers = async (user: string, groupIds: string[]): Promise<Activity[]> => {
  if (groupIds.length === 0) return []
  const result = await query(
    user,
    `SELECT ${activityColumns('a')} FROM activities a
      WHERE a.deleted_at IS NULL AND (a.id = ANY($1::uuid[]) OR a.superseded_by = ANY($1::uuid[]))
      ORDER BY a.start_time`,
    [groupIds],
  )
  return result.rows.map(mapActivityRow)
}

/** The live activity rows linked to the person that start in [start, end]. */
export const listLinkedActivityIds = async (
  user: string,
  personId: string,
  start: Date,
  end: Date,
): Promise<string[]> => {
  const result = await query<{ id: string }>(
    user,
    `SELECT a.id FROM activity_people ap JOIN activities a ON a.id = ap.activity_id
      WHERE ap.person_id = $1 AND a.deleted_at IS NULL AND a.start_time >= $2 AND a.start_time <= $3`,
    [personId, start, end],
  )
  return result.rows.map((row) => row.id)
}

export interface TimeInterval {
  start_time: Date
  end_time: Date
}

/**
 * The live activities with an end that overlap [start, end) and have a live person linked (`personId`
 * when given, else anyone).
 */
export const listActivityIntervalsWithPeople = async (
  user: string,
  start: Date,
  end: Date,
  personId?: string,
): Promise<TimeInterval[]> => {
  const result = await query<TimeInterval>(
    user,
    `SELECT a.start_time, a.end_time FROM activities a
      WHERE a.deleted_at IS NULL AND a.end_time IS NOT NULL
        AND a.end_time > $1 AND a.start_time < $2
        AND EXISTS (
          SELECT 1 FROM activity_people ap JOIN people p ON p.id = ap.person_id
           WHERE ap.activity_id = a.id AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR p.id = $3::uuid)
        )
      ORDER BY a.start_time`,
    [start, end, personId ?? null],
  )
  return result.rows
}

/** Live, non-archived people with at least one live activity linked, by name. */
export const listPeopleWithActivities = async (user: string): Promise<ActivityPersonRef[]> => {
  const result = await query<ActivityPersonRef>(
    user,
    `SELECT p.id, p.name FROM people p
      WHERE p.deleted_at IS NULL AND NOT p.archived
        AND EXISTS (
          SELECT 1 FROM activity_people ap JOIN activities a ON a.id = ap.activity_id
           WHERE ap.person_id = p.id AND a.deleted_at IS NULL
        )
      ORDER BY lower(p.name), p.id`,
  )
  return result.rows
}

export interface ActorPresentationRow {
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
}

export interface FollowPresentationRow extends ActorPresentationRow {
  accepted: boolean
}

/** The user's (non-tag) follow rows and newest timeline presentation for each of `actorUris`. */
export const listActorPresentations = async (
  user: string,
  actorUris: string[],
): Promise<{ following: FollowPresentationRow[]; timeline: ActorPresentationRow[] }> => {
  if (actorUris.length === 0) return { following: [], timeline: [] }
  const [following, timeline] = await Promise.all([
    query<FollowPresentationRow>(
      user,
      `SELECT actor_uri, handle, display_name, avatar_url, accepted FROM feed_following
        WHERE actor_uri = ANY($1::text[]) AND tag IS NULL`,
      [actorUris],
    ),
    query<ActorPresentationRow>(
      user,
      `SELECT DISTINCT ON (actor_uri) actor_uri, handle, display_name, avatar_url FROM timeline_entry
        WHERE actor_uri = ANY($1::text[])
        ORDER BY actor_uri, received_at DESC`,
      [actorUris],
    ),
  ])
  return { following: following.rows, timeline: timeline.rows }
}
