import {
  type Activity,
  type AddPersonBody,
  type AddPersonDateBody,
  DELETED_PERSON_RETENTION_DAYS,
  formatBirthDate,
  IMPORTANT_DATES_DEFAULT_DAYS,
  IMPORTANT_DATES_MAX_SPAN_DAYS,
  type ImportantDate,
  type JournalEntryRef,
  isValidMonthDay,
  normalizeFediverseHandle,
  parseBirthDate,
  type Person,
  type PersonActor,
  type PersonDate,
  type PersonDateKind,
  type PersonDetail,
  PERSON_POSTS_DEFAULT_LIMIT,
  PERSON_POSTS_MAX_LIMIT,
  PERSON_RECENT_ACTIVITIES_LIMIT,
  personDateKinds,
  type TimelineEntry,
  type UpdatePersonBody,
  type UpdatePersonDateBody,
  UUID_RE,
} from '@aurboda/api-spec'

import type { Activity as DbActivity } from '../db/types.ts'

import {
  type ActorPresentationRow,
  deletePersonDate,
  type FollowPresentationRow,
  getLivePersonByActor,
  getPerson,
  getPersonDate,
  type ImportantDateSource,
  insertPerson,
  insertPersonDate,
  listActorPresentations,
  listDeletedPeople,
  listImportantDateSources,
  listPeople,
  listPersonDates,
  listRecentActivitiesForPerson,
  listTimelineEntriesByActor,
  type PersonActorCache,
  type PersonDateFields,
  type PersonDateInsert,
  type PersonDateRecord,
  type PersonFields,
  type PersonInsert,
  type PersonRecord,
  type PersonRestoreResult,
  purgePerson,
  restorePerson,
  softDeletePerson,
  updatePerson,
  updatePersonActorCache,
  updatePersonDate,
} from '../db/index.ts'
import { isUniqueViolation } from '../db/pg-errors.ts'
import {
  birthdayLabel,
  type DatedEntry,
  dueImportantDates,
  importantDateDedupeKey,
  importantDateOccurrences,
  importantDateTitle,
} from './important-dates.ts'
import { listJournalEntryRefs } from './notes.ts'
import { type Notifier, notifier } from './notifications.ts'
import { getUserTimezone } from './settings.ts'
import { loadReactionsForRows, serializeTimelineEntry } from './timeline.ts'

export interface ResolvedActor {
  actor_uri: string
  handle: string | null
  name: string | null
  icon: string | null
}

/** Resolves a fediverse handle the way a follow does (WebFinger and the actor document). */
export type ResolveActorHandle = (
  user: string,
  handle: string,
) => Promise<{ ok: true; actor: ResolvedActor } | { ok: false; error: string }>

export interface PeopleDeps {
  list: (user: string, options: { include_archived?: boolean }) => Promise<PersonRecord[]>
  listDeleted: (user: string) => Promise<PersonRecord[]>
  get: (user: string, id: string) => Promise<PersonRecord | null>
  getByActor: (user: string, actorUri: string) => Promise<PersonRecord | null>
  insert: (user: string, input: PersonInsert) => Promise<PersonRecord>
  update: (user: string, id: string, fields: PersonFields) => Promise<PersonRecord | null>
  updateActorCache: (user: string, id: string, actorUri: string, cache: PersonActorCache) => Promise<void>
  softDelete: (user: string, id: string) => Promise<boolean>
  restore: (user: string, id: string) => Promise<PersonRestoreResult>
  purge: (user: string, id: string) => Promise<boolean>
  listDates: (user: string, personId: string) => Promise<PersonDateRecord[]>
  getDate: (user: string, personId: string, dateId: string) => Promise<PersonDateRecord | null>
  insertDate: (user: string, personId: string, input: PersonDateInsert) => Promise<PersonDateRecord>
  updateDate: (
    user: string,
    personId: string,
    dateId: string,
    fields: PersonDateFields,
  ) => Promise<PersonDateRecord | null>
  deleteDate: (user: string, personId: string, dateId: string) => Promise<boolean>
  listDateSources: (user: string) => Promise<ImportantDateSource[]>
  listRecentActivities: (user: string, personId: string, limit: number) => Promise<DbActivity[]>
  listJournalEntries: (user: string, personId: string) => Promise<JournalEntryRef[]>
  actorPresentations: (
    user: string,
    actorUris: string[],
  ) => Promise<{ following: FollowPresentationRow[]; timeline: ActorPresentationRow[] }>
  listPosts: (user: string, actorUri: string, limit: number) => Promise<TimelineEntry[]>
  /** Absent where federation is not set up: a handle is then refused. */
  resolveHandle?: ResolveActorHandle
  getTimezone: (user: string) => Promise<string>
  now: () => Date
  raise: Notifier['raiseBestEffort']
}

const listPostsFromTimeline = async (
  user: string,
  actorUri: string,
  limit: number,
): Promise<TimelineEntry[]> => {
  const rows = await listTimelineEntriesByActor(user, actorUri, limit)
  const reactions = await loadReactionsForRows(user, rows)
  return rows.map((row) => serializeTimelineEntry(row, undefined, reactions))
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
export const defaultPeopleDeps = (resolveHandle?: ResolveActorHandle): PeopleDeps => ({
  actorPresentations: (user, uris) => listActorPresentations(user, uris),
  deleteDate: (user, personId, dateId) => deletePersonDate(user, personId, dateId),
  get: (user, id) => getPerson(user, id),
  getByActor: (user, uri) => getLivePersonByActor(user, uri),
  getDate: (user, personId, dateId) => getPersonDate(user, personId, dateId),
  getTimezone: (user) => getUserTimezone(user),
  insert: (user, input) => insertPerson(user, input),
  insertDate: (user, personId, input) => insertPersonDate(user, personId, input),
  list: (user, options) => listPeople(user, options),
  listDateSources: (user) => listImportantDateSources(user),
  listDates: (user, personId) => listPersonDates(user, personId),
  listDeleted: (user) => listDeletedPeople(user),
  listJournalEntries: (user, personId) => listJournalEntryRefs(user, 'person', [personId]),
  listPosts: listPostsFromTimeline,
  listRecentActivities: (user, personId, limit) => listRecentActivitiesForPerson(user, personId, limit),
  now: () => new Date(),
  purge: (user, id) => purgePerson(user, id),
  raise: (user, input) => notifier.raiseBestEffort(user, input),
  resolveHandle,
  restore: (user, id) => restorePerson(user, id),
  softDelete: (user, id) => softDeletePerson(user, id),
  update: (user, id, fields) => updatePerson(user, id, fields),
  updateActorCache: (user, id, uri, cache) => updatePersonActorCache(user, id, uri, cache),
  updateDate: (user, personId, dateId, fields) => updatePersonDate(user, personId, dateId, fields),
})

export type PeopleResult<T> = { ok: true; value: T } | { ok: false; status: 400 | 404 | 409; error: string }

const ok = <T>(value: T): PeopleResult<T> => ({ ok: true, value })
const fail = <T>(status: 400 | 404 | 409, error: string): PeopleResult<T> => ({ error, ok: false, status })

export const PERSON_NOT_FOUND = 'Person not found'
export const PERSON_DATE_NOT_FOUND = 'Date not found'
export const HANDLES_UNAVAILABLE = 'Fediverse handles are not available on this server'

const DAY_MS = 24 * 60 * 60 * 1000

const birthDateOf = (record: PersonRecord): string | null =>
  record.birth_month === null || record.birth_day === null
    ? null
    : formatBirthDate({ day: record.birth_day, month: record.birth_month, year: record.birth_year })

const cachedActor = (record: PersonRecord): PersonActor | null =>
  record.actor_uri === null
    ? null
    : {
        following: false,
        handle: record.actor_handle,
        icon: record.actor_icon,
        name: record.actor_name,
        uri: record.actor_uri,
      }

export const serializePerson = (
  record: PersonRecord,
  actor: PersonActor | null = cachedActor(record),
): Person => ({
  actor,
  archived: record.archived,
  birth_date: birthDateOf(record),
  birthday_notify_days_before: record.birthday_notify_days_before,
  created_at: record.created_at.toISOString(),
  ...(record.deleted_at
    ? {
        deleted_at: record.deleted_at.toISOString(),
        purge_at: new Date(
          record.deleted_at.getTime() + DELETED_PERSON_RETENTION_DAYS * DAY_MS,
        ).toISOString(),
      }
    : {}),
  id: record.id,
  name: record.name,
  pronouns: record.pronouns,
  relationship: record.relationship,
  updated_at: record.updated_at.toISOString(),
})

export const serializePersonDate = (record: PersonDateRecord): PersonDate => ({
  created_at: record.created_at.toISOString(),
  day: record.day,
  id: record.id,
  kind: toKind(record.kind),
  label: record.label,
  month: record.month,
  notify_days_before: record.notify_days_before,
  person_id: record.person_id,
  updated_at: record.updated_at.toISOString(),
  year: record.year,
})

const toKind = (kind: string): PersonDateKind =>
  (personDateKinds as readonly string[]).includes(kind) ? (kind as PersonDateKind) : 'other'

/**
 * Each record's account, from the user's follow row, else the newest timeline entry by it,
 * else the cache, field by field. Never a network call.
 */
export const resolveActors = async (
  deps: PeopleDeps,
  user: string,
  records: PersonRecord[],
): Promise<Map<string, PersonActor>> => {
  const uris = [...new Set(records.flatMap((r) => (r.actor_uri ? [r.actor_uri] : [])))]
  const out = new Map<string, PersonActor>()
  if (uris.length === 0) return out
  const { following, timeline } = await deps.actorPresentations(user, uris)
  const follows = new Map(following.map((row) => [row.actor_uri, row]))
  const posts = new Map(timeline.map((row) => [row.actor_uri, row]))
  for (const record of records) {
    const uri = record.actor_uri
    if (!uri || out.has(uri)) continue
    out.set(uri, presentActor(uri, record, follows.get(uri), posts.get(uri)))
  }
  return out
}

const presentActor = (
  uri: string,
  record: PersonRecord,
  follow: FollowPresentationRow | undefined,
  post: ActorPresentationRow | undefined,
): PersonActor => ({
  following: follow?.accepted ?? false,
  handle: follow?.handle ?? post?.handle ?? record.actor_handle,
  icon: follow?.avatar_url ?? post?.avatar_url ?? record.actor_icon,
  name: follow?.display_name ?? post?.display_name ?? record.actor_name,
  uri,
})

const actorOf = (record: PersonRecord, actors: Map<string, PersonActor>): PersonActor | null =>
  record.actor_uri ? (actors.get(record.actor_uri) ?? cachedActor(record)) : null

export const listPeopleView = async (
  deps: PeopleDeps,
  user: string,
  options: { archived?: boolean; deleted?: boolean } = {},
): Promise<Person[]> => {
  const records = options.deleted
    ? await deps.listDeleted(user)
    : await deps.list(user, { include_archived: options.archived === true })
  const actors = await resolveActors(deps, user, records)
  return records.map((record) => serializePerson(record, actorOf(record, actors)))
}

const isStale = (record: PersonRecord, actor: PersonActor): boolean =>
  actor.handle !== record.actor_handle || actor.name !== record.actor_name || actor.icon !== record.actor_icon

const serializeActivityItem = (activity: DbActivity): Activity => ({
  activity_type: activity.activity_type,
  data: activity.data,
  duration: activity.end_time
    ? Math.round((activity.end_time.getTime() - activity.start_time.getTime()) / 60_000)
    : undefined,
  end_time: activity.end_time?.toISOString(),
  id: activity.id,
  source: activity.source,
  start_time: activity.start_time.toISOString(),
  title: activity.title,
})

/** The person with their dates, latest activities and related journal entries; refreshes the account cache when it went stale. */
export const getPersonDetail = async (
  deps: PeopleDeps,
  user: string,
  id: string,
): Promise<PersonDetail | null> => {
  if (!UUID_RE.test(id)) return null
  const record = await deps.get(user, id)
  if (!record) return null
  const [actors, dates, activities, journalEntries] = await Promise.all([
    resolveActors(deps, user, [record]),
    deps.listDates(user, id),
    deps.listRecentActivities(user, id, PERSON_RECENT_ACTIVITIES_LIMIT),
    deps.listJournalEntries(user, id),
  ])
  const actor = actorOf(record, actors)
  if (actor && record.actor_uri && isStale(record, actor)) {
    await deps
      .updateActorCache(user, id, record.actor_uri, {
        actor_handle: actor.handle,
        actor_icon: actor.icon,
        actor_name: actor.name,
      })
      .catch(() => undefined)
  }
  return {
    ...serializePerson(record, actor),
    dates: dates.map(serializePersonDate),
    journal_entries: journalEntries,
    recent_activities: activities.map(serializeActivityItem),
  }
}

const blankToNull = (text: string | null | undefined): string | null | undefined =>
  text === undefined ? undefined : text === null || text.trim() === '' ? null : text.trim()

const birthFields = (
  birthDate: string | null | undefined,
): Pick<PersonFields, 'birth_day' | 'birth_month' | 'birth_year'> => {
  if (birthDate === undefined) return {}
  const parts = birthDate === null ? null : parseBirthDate(birthDate)
  return { birth_day: parts?.day ?? null, birth_month: parts?.month ?? null, birth_year: parts?.year ?? null }
}

const duplicateActor = (holder: PersonRecord): string =>
  `Another person already has this fediverse account: ${holder.name}`

/** The actor fields for `handle` (null clears it), or why it is refused. */
const actorFields = async (
  deps: PeopleDeps,
  user: string,
  handle: string | null | undefined,
  selfId?: string,
): Promise<PeopleResult<Pick<PersonFields, 'actor_cache' | 'actor_uri'>>> => {
  if (handle === undefined) return ok({})
  if (handle === null) return ok({ actor_uri: null })
  if (!deps.resolveHandle) return fail(400, HANDLES_UNAVAILABLE)
  const normalized = normalizeFediverseHandle(handle)
  if (!normalized) return fail(400, 'Must be a fediverse handle like @name@server')
  const resolved = await deps.resolveHandle(user, `@${normalized}`)
  if (!resolved.ok) return fail(400, resolved.error)
  const holder = await deps.getByActor(user, resolved.actor.actor_uri)
  if (holder && holder.id !== selfId) return fail(409, duplicateActor(holder))
  return ok({
    actor_cache: {
      actor_handle: resolved.actor.handle,
      actor_icon: resolved.actor.icon,
      actor_name: resolved.actor.name,
    },
    actor_uri: resolved.actor.actor_uri,
  })
}

/** A concurrent profile took the actor between the check and the write. */
const raceOnActor = async <T>(
  deps: PeopleDeps,
  user: string,
  actorUri: string | null | undefined,
  write: () => Promise<T>,
): Promise<PeopleResult<T>> => {
  try {
    return ok(await write())
  } catch (error) {
    if (!actorUri || !isUniqueViolation(error)) throw error
    const holder = await deps.getByActor(user, actorUri)
    return fail(409, holder ? duplicateActor(holder) : 'Another person already has this fediverse account')
  }
}

export const addPerson = async (
  deps: PeopleDeps,
  user: string,
  body: AddPersonBody,
): Promise<PeopleResult<Person>> => {
  const actor = await actorFields(deps, user, body.handle)
  if (!actor.ok) return actor
  const written = await raceOnActor(deps, user, actor.value.actor_uri, () =>
    deps.insert(user, {
      ...actor.value,
      ...birthFields(body.birth_date),
      archived: body.archived,
      birthday_notify_days_before: body.birthday_notify_days_before,
      name: body.name.trim(),
      pronouns: blankToNull(body.pronouns),
      relationship: blankToNull(body.relationship),
    }),
  )
  if (!written.ok) return written
  return ok(await serializeResolved(deps, user, written.value))
}

const serializeResolved = async (deps: PeopleDeps, user: string, record: PersonRecord): Promise<Person> =>
  serializePerson(record, actorOf(record, await resolveActors(deps, user, [record])))

export const updatePersonById = async (
  deps: PeopleDeps,
  user: string,
  id: string,
  body: UpdatePersonBody,
): Promise<PeopleResult<Person>> => {
  if (!UUID_RE.test(id) || !(await deps.get(user, id))) return fail(404, PERSON_NOT_FOUND)
  const actor = await actorFields(deps, user, body.handle, id)
  if (!actor.ok) return actor
  const written = await raceOnActor(deps, user, actor.value.actor_uri, () =>
    deps.update(user, id, {
      ...actor.value,
      ...birthFields(body.birth_date),
      archived: body.archived,
      birthday_notify_days_before: body.birthday_notify_days_before,
      name: body.name?.trim(),
      pronouns: blankToNull(body.pronouns),
      relationship: blankToNull(body.relationship),
    }),
  )
  if (!written.ok) return written
  if (!written.value) return fail(404, PERSON_NOT_FOUND)
  return ok(await serializeResolved(deps, user, written.value))
}

/**
 * Without `purge` the person goes out of sight with their dates, notes and activity links, and
 * can be restored for {@link DELETED_PERSON_RETENTION_DAYS} days; with it, all of that is removed
 * for good at once, deleted or not.
 */
export const deletePersonById = async (
  deps: PeopleDeps,
  user: string,
  id: string,
  options: { purge?: boolean } = {},
): Promise<boolean> => {
  if (!UUID_RE.test(id)) return false
  return options.purge ? deps.purge(user, id) : deps.softDelete(user, id)
}

export const restorePersonById = async (
  deps: PeopleDeps,
  user: string,
  id: string,
): Promise<PeopleResult<Person>> => {
  if (!UUID_RE.test(id)) return fail(404, PERSON_NOT_FOUND)
  const result = await deps.restore(user, id)
  if (result.status === 'not_found') return fail(404, PERSON_NOT_FOUND)
  if (result.status === 'actor_taken') {
    return fail(409, `${duplicateActor(result.holder)}. Clear its handle first.`)
  }
  return ok(await serializeResolved(deps, user, result.person))
}

const livePerson = async (deps: PeopleDeps, user: string, personId: string): Promise<PersonRecord | null> =>
  UUID_RE.test(personId) ? deps.get(user, personId) : null

export const listPersonDatesById = async (
  deps: PeopleDeps,
  user: string,
  personId: string,
): Promise<PersonDate[] | null> => {
  if (!(await livePerson(deps, user, personId))) return null
  return (await deps.listDates(user, personId)).map(serializePersonDate)
}

export const addPersonDate = async (
  deps: PeopleDeps,
  user: string,
  personId: string,
  body: AddPersonDateBody,
): Promise<PeopleResult<PersonDate>> => {
  if (!(await livePerson(deps, user, personId))) return fail(404, PERSON_NOT_FOUND)
  const record = await deps.insertDate(user, personId, {
    day: body.day,
    kind: body.kind ?? 'other',
    label: body.label.trim(),
    month: body.month,
    notify_days_before: body.notify_days_before ?? null,
    year: body.year ?? null,
  })
  return ok(serializePersonDate(record))
}

export const updatePersonDateById = async (
  deps: PeopleDeps,
  user: string,
  personId: string,
  dateId: string,
  body: UpdatePersonDateBody,
): Promise<PeopleResult<PersonDate>> => {
  if (!(await livePerson(deps, user, personId))) return fail(404, PERSON_NOT_FOUND)
  const existing = UUID_RE.test(dateId) ? await deps.getDate(user, personId, dateId) : null
  if (!existing) return fail(404, PERSON_DATE_NOT_FOUND)
  const month = body.month ?? existing.month
  const day = body.day ?? existing.day
  const year = body.year === undefined ? existing.year : body.year
  if (!isValidMonthDay(month, day, year)) return fail(400, 'Not a real date')
  const record = await deps.updateDate(user, personId, dateId, {
    day: body.day,
    kind: body.kind,
    label: body.label?.trim(),
    month: body.month,
    notify_days_before: body.notify_days_before,
    year: body.year,
  })
  return record ? ok(serializePersonDate(record)) : fail(404, PERSON_DATE_NOT_FOUND)
}

export const deletePersonDateById = async (
  deps: PeopleDeps,
  user: string,
  personId: string,
  dateId: string,
): Promise<PeopleResult<true>> => {
  if (!(await livePerson(deps, user, personId))) return fail(404, PERSON_NOT_FOUND)
  if (!UUID_RE.test(dateId) || !(await deps.deleteDate(user, personId, dateId))) {
    return fail(404, PERSON_DATE_NOT_FOUND)
  }
  return ok(true)
}

export const toDatedEntry = (source: ImportantDateSource): DatedEntry => ({
  date_id: source.date_id,
  day: source.day,
  kind: toKind(source.kind),
  label: source.date_id === null ? birthdayLabel(source.person_name) : (source.label ?? ''),
  month: source.month,
  notify_days_before: source.notify_days_before,
  person: { id: source.person_id, name: source.person_name },
  year: source.year,
})

const localToday = (now: Date, timezone: string): Temporal.PlainDate =>
  Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(timezone).toPlainDate()

export interface ImportantDatesView {
  dates: ImportantDate[]
  from: string
  timezone: string
  to: string
}

/** Every occurrence in [from, to] of the dates and birthdays of the live, non-archived people. */
export const listImportantDates = async (
  deps: PeopleDeps,
  user: string,
  query: { from?: string; to?: string },
): Promise<PeopleResult<ImportantDatesView>> => {
  const timezone = await deps.getTimezone(user)
  const from = query.from ? Temporal.PlainDate.from(query.from) : localToday(deps.now(), timezone)
  const to = query.to ? Temporal.PlainDate.from(query.to) : from.add({ days: IMPORTANT_DATES_DEFAULT_DAYS })
  if (Temporal.PlainDate.compare(to, from) < 0) return fail(400, 'to must not precede from')
  if (from.until(to, { largestUnit: 'days' }).days > IMPORTANT_DATES_MAX_SPAN_DAYS) {
    return fail(400, `from and to may be at most ${IMPORTANT_DATES_MAX_SPAN_DAYS} days apart`)
  }
  const sources = await deps.listDateSources(user)
  return ok({
    dates: importantDateOccurrences(sources.map(toDatedEntry), from.toString(), to.toString()),
    from: from.toString(),
    timezone,
    to: to.toString(),
  })
}

export const listPersonPosts = async (
  deps: PeopleDeps,
  user: string,
  personId: string,
  limit: number = PERSON_POSTS_DEFAULT_LIMIT,
): Promise<PeopleResult<TimelineEntry[]>> => {
  const person = await livePerson(deps, user, personId)
  if (!person) return fail(404, PERSON_NOT_FOUND)
  if (!person.actor_uri) return fail(404, 'This person has no fediverse handle')
  const bounded = Math.min(Math.max(Math.trunc(limit), 1), PERSON_POSTS_MAX_LIMIT)
  return ok(await deps.listPosts(user, person.actor_uri, bounded))
}

/** Raises every `important_date` notification due now. Resolves to how many were due. */
export const raiseDueImportantDates = async (deps: PeopleDeps, user: string): Promise<number> => {
  const [sources, timezone] = await Promise.all([deps.listDateSources(user), deps.getTimezone(user)])
  const due = dueImportantDates(sources.map(toDatedEntry), timezone, deps.now())
  for (const item of due) {
    await deps.raise(user, {
      data: { date_id: item.entry.date_id, occurrence_date: item.date, person_id: item.entry.person.id },
      dedupe_key: importantDateDedupeKey(item.entry, item.date),
      link: `/people/${item.entry.person.id}`,
      title: importantDateTitle(item),
      type: 'important_date',
    })
  }
  return due.length
}
