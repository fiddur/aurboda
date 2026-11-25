import type { DataSource } from '@aurboda/api-spec'

import type { Queryable } from './pool.ts'
import type { EntityType, Note, NoteRevision } from './types.ts'

import { UUID_RE } from '../utils.ts'
import { buildBucketExpr } from './bucket-expr.ts'
import { query, withUserTransaction } from './connection.ts'
import { buildDynamicUpdate } from './dynamic-update.ts'
import { type NoteLinkInput, relatedToCondition, replaceNoteLinks } from './note-links.ts'
import { PARENT_IS_LIVE, parentIdColumn } from './note-sql.ts'
import { mapNoteRow } from './row-mappers.ts'

const NOTE_COLUMNS = `id, entity_type, entity_id, content, source, start_time, end_time,
  to_char("date", 'YYYY-MM-DD') AS "date", title, tags, hashtags, deleted_at, created_at, updated_at`

/** The journal fields of a note; a reply carries its root's `date` and no title. */
export interface NoteExtras {
  title?: string | null
  tags?: string[]
  hashtags?: string[]
  date?: string | null
  related?: NoteLinkInput[]
}

const insertNoteIn = async (
  db: Queryable | string,
  entityType: EntityType,
  entityId: string | null,
  content: string,
  startTime: Date | undefined,
  endTime: Date | undefined,
  extras: NoteExtras,
): Promise<Note> => {
  const result = await query(
    db,
    `INSERT INTO notes (entity_type, entity_id, content, start_time, end_time, title, tags, hashtags, "date")
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING ${NOTE_COLUMNS}`,
    [
      entityType,
      entityId,
      content,
      startTime ?? null,
      endTime ?? null,
      extras.title ?? null,
      extras.tags ?? [],
      extras.hashtags ?? [],
      extras.date ?? null,
    ],
  )

  return mapNoteRow(result.rows[0])
}

export const insertNote = async (
  user: string,
  entityType: EntityType,
  entityId: string | null,
  content: string,
  startTime?: Date,
  endTime?: Date,
  extras: NoteExtras = {},
): Promise<Note> => {
  const related = extras.related
  if (related === undefined) {
    return insertNoteIn(user, entityType, entityId, content, startTime, endTime, extras)
  }
  return withUserTransaction(user, async (tx) => {
    const note = await insertNoteIn(tx, entityType, entityId, content, startTime, endTime, extras)
    await replaceNoteLinks(tx, note.id, related)
    return note
  })
}

/** A soft-deleted note is as good as absent, except to restore and purge, which ask for it. */
export const getNoteById = async (
  user: string,
  id: string,
  options: { include_deleted?: boolean } = {},
): Promise<Note | null> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 ${options.include_deleted ? '' : 'AND deleted_at IS NULL'}`,
    [id],
  )

  if (result.rows.length === 0) return null
  return mapNoteRow(result.rows[0])
}

export const getNotesForEntity = async (
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE entity_type = $1 AND entity_id = $2 AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [entityType, entityId],
  )

  return result.rows.map(mapNoteRow)
}

export interface NoteFieldUpdates {
  content?: string
  /** Only `time` ↔ `day`: switching a free-standing note between a moment and a date. */
  entity_type?: 'time' | 'day'
  start_time?: Date | null
  end_time?: Date | null
  date?: string | null
  title?: string | null
  tags?: string[]
  hashtags?: string[]
  /** Replaces the note's links; no column of its own, so it keeps no revision. */
  related?: NoteLinkInput[]
}

export interface NoteRevisionPolicy {
  /** A change within this many minutes of the newest revision keeps no revision of its own. */
  min_interval_minutes: number
  /** The newest revisions kept per note. */
  limit: number
}

export type GuardedNoteUpdate =
  | { status: 'not_found' }
  | { status: 'conflict'; note: Note }
  | { status: 'updated'; note: Note }

const fieldEntries = (fields: NoteFieldUpdates) => {
  const columns: [keyof NoteFieldUpdates, string][] = [
    ['content', 'content'],
    ['entity_type', 'entity_type'],
    ['start_time', 'start_time'],
    ['end_time', 'end_time'],
    ['date', '"date"'],
    ['title', 'title'],
    ['tags', 'tags'],
    ['hashtags', 'hashtags'],
  ]
  return columns.flatMap(([field, column]) =>
    fields[field] === undefined ? [] : [{ column, value: fields[field] }],
  )
}

const saveRevisionIn = async (tx: Queryable, previous: Note, policy: NoteRevisionPolicy): Promise<void> => {
  await query(
    tx,
    `INSERT INTO note_revisions (note_id, content, title)
     SELECT $1, $2, $3
      WHERE NOT EXISTS (
        SELECT 1 FROM note_revisions
         WHERE note_id = $1 AND saved_at > NOW() - make_interval(mins => $4::int)
      )`,
    [previous.id, previous.content, previous.title ?? null, policy.min_interval_minutes],
  )
  await query(
    tx,
    `DELETE FROM note_revisions
      WHERE note_id = $1
        AND id NOT IN (
          SELECT id FROM note_revisions WHERE note_id = $1 ORDER BY saved_at DESC, id DESC LIMIT $2
        )`,
    [previous.id, policy.limit],
  )
}

/** Whether an update replaces text worth keeping: an entry created empty keeps no empty first version. */
const keepsRevision = (existing: Note, fields: NoteFieldUpdates): boolean => {
  const contentChanged = fields.content !== undefined && fields.content !== existing.content
  const titleChanged = fields.title !== undefined && (fields.title ?? undefined) !== existing.title
  const wasBlank = existing.content.trim() === '' && !existing.title?.trim()
  return (contentChanged || titleChanged) && !wasBlank
}

const isStale = (
  existing: Note,
  expected: { expected_updated_at?: Date; expected_entity_type?: EntityType },
): boolean =>
  (expected.expected_updated_at !== undefined &&
    expected.expected_updated_at.getTime() !== existing.updated_at.getTime()) ||
  (expected.expected_entity_type !== undefined && expected.expected_entity_type !== existing.entity_type)

/**
 * Update a live note in one transaction: the row is locked, `expected_updated_at` (when given)
 * is compared with the stored `updated_at` to the millisecond, the previous text is kept as a
 * revision when the content or title changes, and when the anchor moves its replies move with it.
 * `updated_at` is always bumped, also when only the links change.
 */
export const updateNoteGuarded = async (
  user: string,
  id: string,
  fields: NoteFieldUpdates,
  options: {
    expected_updated_at?: Date
    /**
     * The kind the anchor change was worked out for: when the locked row has become another kind
     * since (a concurrent switch between `time` and `day`), the change is a conflict, not a shape
     * violation.
     */
    expected_entity_type?: EntityType
    revisions: NoteRevisionPolicy
  },
): Promise<GuardedNoteUpdate> =>
  withUserTransaction(user, async (tx) => {
    const locked = await query(
      tx,
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    if (locked.rows.length === 0) return { status: 'not_found' }
    const existing = mapNoteRow(locked.rows[0])

    if (isStale(existing, options)) return { note: existing, status: 'conflict' }

    if (keepsRevision(existing, fields)) await saveRevisionIn(tx, existing, options.revisions)

    const update = buildDynamicUpdate('notes', id, fieldEntries(fields), {
      defaultClauses: ['updated_at = NOW()'],
      returning: NOTE_COLUMNS,
    })
    const result = await query(tx, update!.sql, update!.params)
    const note = mapNoteRow(result.rows[0])
    if (fields.related !== undefined) await replaceNoteLinks(tx, note.id, fields.related)

    const anchorMoved =
      fields.start_time !== undefined || fields.end_time !== undefined || fields.date !== undefined
    if (anchorMoved) {
      await query(
        tx,
        `UPDATE notes SET start_time = $2, end_time = $3, "date" = $4::date, updated_at = NOW()
          WHERE entity_type = 'note' AND entity_id = $1`,
        [note.id, note.start_time ?? null, note.end_time ?? null, note.date ?? null],
      )
    }

    return { note, status: 'updated' }
  })

export const getNoteRevisions = async (user: string, noteId: string): Promise<NoteRevision[]> => {
  const result = await query(
    user,
    `SELECT id, note_id, content, title, saved_at FROM note_revisions
      WHERE note_id = $1
      ORDER BY saved_at DESC, id DESC`,
    [noteId],
  )
  return result.rows.map((row) => ({
    content: row.content,
    id: row.id,
    note_id: row.note_id,
    saved_at: new Date(row.saved_at),
    title: row.title ?? undefined,
  }))
}

/**
 * Resolve a note to its thread root. A reply (`entity_type = 'note'`) resolves
 * to the note its `entity_id` points at; anything else resolves to itself.
 * One hop is enough: replies-to-replies are re-anchored at write time.
 */
export const getNoteRoot = async (user: string, id: string): Promise<Note | null> => {
  const note = await getNoteById(user, id)
  if (!note) return null
  if (note.entity_type !== 'note' || !note.entity_id) return note
  return getNoteById(user, note.entity_id)
}

/**
 * Called when the parent entity's timing changes (e.g. a tag is updated). Soft-deleted notes are
 * kept in step too, so a restore finds them right.
 */
export const updateNoteTimesForEntity = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  startTime: Date,
  endTime?: Date,
): Promise<void> => {
  await query(
    user,
    `UPDATE notes SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE entity_type = $3 AND entity_id = $4`,
    [startTime, endTime ?? null, entityType, entityId],
  )

  // Replies sit at the same point in time as the comment they hang off.
  await query(
    user,
    `UPDATE notes SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE entity_type = 'note'
       AND entity_id IN (SELECT id::text FROM notes WHERE entity_type = $3 AND entity_id = $4)`,
    [startTime, endTime ?? null, entityType, entityId],
  )
}

export const getNotesByEntityIds = async (
  user: string,
  entityType: EntityType,
  entityIds: string[],
): Promise<Map<string, Note[]>> => {
  if (entityIds.length === 0) return new Map()
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
     WHERE entity_type = $1 AND entity_id = ANY($2) AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [entityType, entityIds],
  )
  const map = new Map<string, Note[]>()
  for (const row of result.rows) {
    const note = mapNoteRow(row)
    if (note.entity_id === null) continue
    map.getOrInsert(note.entity_id, []).push(note)
  }
  return map
}

/** Threads are one level deep, so the result never needs recursing into. */
export const getRepliesForRootIds = async (user: string, rootIds: string[]): Promise<Map<string, Note[]>> =>
  getNotesByEntityIds(user, 'note', rootIds)

/** An entry still to be written up: a live picture on it and no text yet. For the alias `n`. */
const NEEDS_TEXT = `(n.content ~ '^\\s*$' AND EXISTS (
       SELECT 1 FROM note_attachments a
        WHERE a.note_id = n.id AND a.kind = 'image' AND a.deleted_at IS NULL))`

/** Local calendar dates, inclusive: the `day` notes the range read returns besides the timed ones. */
export interface LocalDateRange {
  from: string
  to: string
}

/**
 * Notes with no start_time (e.g. metric notes using composite entity_id) are excluded from this query,
 * except `day` notes whose date falls within `days`. Replies (`entity_type = 'note'`) are excluded
 * too — they only ever surface nested under their root — and so are soft-deleted notes and comments
 * whose parent is soft-deleted or gone (see {@link PARENT_IS_LIVE}). `day` notes come first.
 */
export const getNotesForTimeRange = async (
  user: string,
  start: Date,
  end: Date,
  days?: LocalDateRange,
  options: { needs_text?: boolean } = {},
): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM (
       SELECT n.*, ${parentIdColumn('$3')}
       FROM notes n
       WHERE n.entity_type <> 'note'
         AND n.deleted_at IS NULL
         ${options.needs_text ? `AND ${NEEDS_TEXT}` : ''}
         AND ((n.start_time IS NOT NULL
               AND ((n.end_time IS NOT NULL AND n.start_time <= $2 AND n.end_time >= $1)
                    OR (n.end_time IS NULL AND n.start_time >= $1 AND n.start_time <= $2)))
              OR (n.entity_type = 'day' AND n."date" BETWEEN $4::date AND $5::date))
     ) n
     WHERE ${PARENT_IS_LIVE}
     ORDER BY n.start_time ASC NULLS FIRST, n."date" ASC, n.created_at ASC`,
    [start, end, UUID_RE.source, days?.from ?? null, days?.to ?? null],
  )

  return result.rows.map(mapNoteRow)
}

/** ISO 8601 in UTC with microseconds, so the keyset loses nothing to JavaScript's milliseconds. */
const CURSOR_FORMAT = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`

export interface NotesSearchCursor {
  /** The anchor and created_at in {@link CURSOR_FORMAT}. */
  anchor: string
  created_at: string
  id: string
}

export interface NotesSearchParams {
  entity_types: EntityType[]
  tz: string
  limit: number
  /** A tsquery-ready pair: the words for websearch_to_tsquery, and a last word to match as a prefix. */
  text?: { websearch: string; prefix?: string }
  tags?: string[]
  from?: string
  to?: string
  /** An earlier year than this, on one of these MM-DD days. */
  on_this_day?: { before_year: number; month_days: string[] }
  cursor?: NotesSearchCursor
  /** Only entries with a live picture and no text. */
  needs_text?: boolean
  related?: NoteLinkInput
}

export interface NotesSearchPage {
  notes: Note[]
  next_cursor: NotesSearchCursor | null
  /** How many roots match across every page; only on the first page (no cursor). */
  total?: number
}

type Param = (value: unknown) => string

const paramList = (): { values: unknown[]; param: Param } => {
  const values: unknown[] = []
  return {
    param: (value) => {
      values.push(value)
      return `$${values.length}`
    },
    values,
  }
}

/**
 * The live thread roots of `entityTypes` that have an anchor, as the alias `n` with an `anchor`
 * column: a `day` note's is the start of its date in the zone `tz` names, any other's its
 * start_time. Roots with no anchor at all (metric comments) are left out. This is the set and the
 * anchor the Journal list orders by, so its neighbours step through the same entries.
 */
const anchoredRootsSql = (
  param: Param,
  tz: string,
  entityTypes: EntityType[],
  conditions: string[] = [],
): string => `
       SELECT n.*, CASE WHEN n.entity_type = 'day' THEN (n."date"::timestamp AT TIME ZONE ${tz}) ELSE n.start_time END AS anchor FROM (
         SELECT n.*, ${parentIdColumn(param(UUID_RE.source))}
           FROM notes n
          WHERE ${[
            `n.entity_type = ANY(${param(entityTypes)}::text[])`,
            `n.entity_type <> 'note'`,
            `n.deleted_at IS NULL`,
            `(n.start_time IS NOT NULL OR n.entity_type = 'day')`,
            ...conditions,
          ].join(' AND ')}
       ) n
       WHERE ${PARENT_IS_LIVE}`

type NotesSearchFilters = Pick<
  NotesSearchParams,
  'from' | 'needs_text' | 'on_this_day' | 'related' | 'tags' | 'text' | 'to'
>

const searchConditions = (param: Param, tz: string, params: NotesSearchFilters): string[] => {
  const localDay = `CASE WHEN n.entity_type = 'day' THEN n."date" ELSE (n.start_time AT TIME ZONE ${tz})::date END`
  const conditions: string[] = []
  if (params.text) {
    const websearch = `websearch_to_tsquery('simple', ${param(params.text.websearch)})`
    const tsquery = params.text.prefix
      ? `(${websearch} && to_tsquery('simple', ${param(`${params.text.prefix}:*`)}))`
      : websearch
    conditions.push(`(n.search @@ ${tsquery} OR EXISTS (
        SELECT 1 FROM notes r
         WHERE r.entity_type = 'note' AND r.entity_id = n.id::text AND r.deleted_at IS NULL
           AND r.search @@ ${tsquery}))`)
  }
  if (params.tags && params.tags.length > 0) {
    conditions.push(`(n.tags || n.hashtags) @> ${param(params.tags)}::text[]`)
  }
  if (params.needs_text) conditions.push(NEEDS_TEXT)
  if (params.related) {
    conditions.push(relatedToCondition(param(params.related.entity_type), param(params.related.entity_id)))
  }
  if (params.from) conditions.push(`${localDay} >= ${param(params.from)}::date`)
  if (params.to) conditions.push(`${localDay} <= ${param(params.to)}::date`)
  if (params.on_this_day) {
    conditions.push(`EXTRACT(YEAR FROM ${localDay}) < ${param(params.on_this_day.before_year)}`)
    conditions.push(`to_char(${localDay}, 'MM-DD') = ANY(${param(params.on_this_day.month_days)}::text[])`)
  }
  return conditions
}

/**
 * Thread roots, newest first by anchor (a `day` note's anchor is the start of its date in `tz`),
 * then created_at and id, with keyset pagination on that order. A text match in a live reply
 * returns its root. Roots with no anchor at all (metric comments) are left out.
 */
export const searchNotes = async (user: string, params: NotesSearchParams): Promise<NotesSearchPage> => {
  const { param, values } = paramList()
  const tz = param(params.tz)
  const conditions = searchConditions(param, tz, params)
  const roots = anchoredRootsSql(param, tz, params.entity_types, conditions)
  const cursorCondition = params.cursor
    ? `WHERE (n.anchor, n.created_at, n.id) < (${param(params.cursor.anchor)}::timestamptz, ${param(
        params.cursor.created_at,
      )}::timestamptz, ${param(params.cursor.id)}::uuid)`
    : ''
  const limit = param(params.limit + 1)

  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS},
            to_char(anchor AT TIME ZONE 'UTC', ${CURSOR_FORMAT}) AS cursor_anchor,
            to_char(created_at AT TIME ZONE 'UTC', ${CURSOR_FORMAT}) AS cursor_created_at,
            total
       FROM (SELECT n.*, count(*) OVER ()::int AS total FROM (${roots}
       ) n
     ) n
     ${cursorCondition}
     ORDER BY n.anchor DESC, n.created_at DESC, n.id DESC
     LIMIT ${limit}`,
    values,
  )

  const rows = result.rows.slice(0, params.limit)
  const last = rows.at(-1)
  return {
    next_cursor:
      result.rows.length > params.limit && last
        ? { anchor: last.cursor_anchor, created_at: last.cursor_created_at, id: last.id }
        : null,
    notes: rows.map(mapNoteRow),
    ...(params.cursor ? {} : { total: result.rows[0]?.total ?? 0 }),
  }
}

/**
 * The roots just before (older) and after (newer) `id` in {@link searchNotes}' order without
 * filters, or null when `id` is not one of those roots (missing, deleted, a reply, a comment
 * outside `entity_types`).
 */
export const getNoteNeighbors = async (
  user: string,
  id: string,
  params: { tz: string; entity_types: EntityType[] },
): Promise<{ previous: Note | null; next: Note | null } | null> => {
  if (!UUID_RE.test(id)) return null
  const { param, values } = paramList()
  const roots = anchoredRootsSql(param, param(params.tz), params.entity_types)
  const target = param(id)
  const result = await query(
    user,
    `WITH roots AS (${roots}
     ),
     target AS (SELECT * FROM roots WHERE id = ${target}::uuid),
     previous AS (
       SELECT r.* FROM roots r, target t
        WHERE (r.anchor, r.created_at, r.id) < (t.anchor, t.created_at, t.id)
        ORDER BY r.anchor DESC, r.created_at DESC, r.id DESC
        LIMIT 1
     ),
     next AS (
       SELECT r.* FROM roots r, target t
        WHERE (r.anchor, r.created_at, r.id) > (t.anchor, t.created_at, t.id)
        ORDER BY r.anchor, r.created_at, r.id
        LIMIT 1
     )
     SELECT 'target' AS position, ${NOTE_COLUMNS} FROM target
     UNION ALL SELECT 'previous', ${NOTE_COLUMNS} FROM previous
     UNION ALL SELECT 'next', ${NOTE_COLUMNS} FROM next`,
    values,
  )
  const at = (position: string): Note | null => {
    const row = result.rows.find((r) => r.position === position)
    return row ? mapNoteRow(row) : null
  }
  if (!result.rows.some((r) => r.position === 'target')) return null
  return { next: at('next'), previous: at('previous') }
}

export interface NoteTagCount {
  tag: string
  count: number
  last_used: Date
}

/**
 * The tags (explicit and #hashtags) on the roots {@link searchNotes} lists, each counted once per
 * note, most used first, with the newest carrying root's anchor.
 */
export const listNoteTags = async (
  user: string,
  params: { tz: string; entity_types: EntityType[] },
): Promise<NoteTagCount[]> => {
  const { param, values } = paramList()
  const roots = anchoredRootsSql(param, param(params.tz), params.entity_types)
  const result = await query(
    user,
    `SELECT t.tag, count(*)::int AS count, max(n.anchor) AS last_used
       FROM (${roots}
     ) n
     CROSS JOIN LATERAL (SELECT DISTINCT unnest(n.tags || n.hashtags) AS tag) t
     GROUP BY t.tag
     ORDER BY count DESC, t.tag`,
    values,
  )
  return result.rows.map((row) => ({
    count: row.count,
    last_used: new Date(row.last_used),
    tag: row.tag,
  }))
}

/** The search filters a journal chart narrows its entries by, as {@link searchNotes} reads them. */
export interface JournalFilterParams {
  entity_types: EntityType[]
  tz: string
  text?: NotesSearchParams['text']
  tags?: string[]
  related?: NoteLinkInput
}

export interface JournalSeriesParams extends JournalFilterParams {
  start: Date
  end: Date
  bucket_size: string
  /** `count` counts entries; `words` sums the words of each entry's own content. */
  value: 'count' | 'words'
  breakdown: { tags: boolean; people: boolean }
}

export interface JournalSeriesRow {
  bucket_start: Date
  /** With the tags breakdown: the tag, or null for an untagged entry. */
  tag?: string | null
  /** With the people breakdown: the person, or null for an entry related to no live person. */
  person?: { id: string; name: string; created_at: Date } | null
  value: number
}

const WORDS_SQL = `CASE WHEN n.content ~ '^\\s*$' THEN 0
              ELSE array_length(regexp_split_to_array(regexp_replace(n.content, '^\\s+|\\s+$', '', 'g'), '\\s+'), 1) END`

const ENTRY_TAGS_LATERAL = `LEFT JOIN LATERAL (SELECT DISTINCT unnest(n.tags || n.hashtags) AS tag) t ON TRUE`

const ENTRY_PEOPLE_LATERAL = `LEFT JOIN LATERAL (
       SELECT DISTINCT p.id AS person_id, p.name AS person_name, p.created_at AS person_created_at
         FROM note_links l
         JOIN people p ON p.id = l.entity_id AND p.deleted_at IS NULL
        WHERE l.note_id = n.id AND l.entity_type = 'person'
     ) ppl ON TRUE`

/**
 * The roots {@link searchNotes} lists for the filters, anchored in [start, end], per bucket of their
 * anchor: how many there are, or how many words they hold. With a breakdown, one row per bucket and
 * tag (each distinct tag of an entry, explicit or #hashtag) and/or person (each live person the
 * entry is related to), an entry counted under each of its tags and people.
 */
export const getJournalSeries = async (
  user: string,
  params: JournalSeriesParams,
): Promise<JournalSeriesRow[]> => {
  const { param, values } = paramList()
  const tz = param(params.tz)
  const roots = anchoredRootsSql(param, tz, params.entity_types, searchConditions(param, tz, params))
  const bucket = buildBucketExpr(params.bucket_size, 'n.anchor', values.length + 1, params.tz)
  values.push(...bucket.params)
  const start = param(params.start)
  const end = param(params.end)
  const columns = [
    ...(params.breakdown.tags ? ['t.tag'] : []),
    ...(params.breakdown.people ? ['ppl.person_id', 'ppl.person_name', 'ppl.person_created_at'] : []),
  ]
  const result = await query(
    user,
    `SELECT ${bucket.expr} AS bucket_start,
            ${[...columns, params.value === 'count' ? 'count(*)' : `SUM(${WORDS_SQL})`].join(', ')} AS value
       FROM (${roots}
     ) n
     ${params.breakdown.tags ? ENTRY_TAGS_LATERAL : ''}
     ${params.breakdown.people ? ENTRY_PEOPLE_LATERAL : ''}
      WHERE n.anchor BETWEEN ${start} AND ${end}
      GROUP BY ${['1', ...columns].join(', ')}
      ORDER BY 1`,
    values,
  )
  return result.rows.map((row) => ({
    bucket_start: new Date(row.bucket_start),
    ...(params.breakdown.tags ? { tag: row.tag ?? null } : {}),
    ...(params.breakdown.people
      ? {
          person:
            row.person_id == null
              ? null
              : { created_at: new Date(row.person_created_at), id: row.person_id, name: row.person_name },
        }
      : {}),
    value: Number(row.value),
  }))
}

/** The local day (`YYYY-MM-DD` in `tz`) of the earliest root {@link searchNotes} lists for the filters. */
export const getFirstJournalDay = async (
  user: string,
  params: JournalFilterParams,
): Promise<string | undefined> => {
  const { param, values } = paramList()
  const tz = param(params.tz)
  const roots = anchoredRootsSql(param, tz, params.entity_types, searchConditions(param, tz, params))
  const result = await query<{ first_day: string | null }>(
    user,
    `SELECT to_char(min(n.anchor) AT TIME ZONE ${tz}, 'YYYY-MM-DD') AS first_day FROM (${roots}
     ) n`,
    values,
  )
  return result.rows[0]?.first_day ?? undefined
}

/** Every live note, of any kind (replies included), carrying one of `tags` explicitly or as a #hashtag. */
export const getNotesWithAnyTag = async (user: string, tags: string[]): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes
      WHERE deleted_at IS NULL AND (tags || hashtags) && $1::text[]
      ORDER BY created_at, id`,
    [tags],
  )
  return result.rows.map(mapNoteRow)
}

/**
 * Delete a note for good and, when it is a thread root, every reply hanging off it, deleted or
 * not. There is no FK between a reply and its root, so the cascade is explicit.
 */
export const deleteNote = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM notes WHERE id = $1 OR (entity_type = 'note' AND entity_id = $1::text)`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Remove a live note for good when it holds nothing a restore could bring back: no text, title
 * or tags, and no attachments, links, replies or revisions, deleted ones included. Answers
 * whether it did; a note with anything in it is left alone.
 */
export const deleteBlankNote = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `DELETE FROM notes n
      WHERE n.id = $1 AND n.deleted_at IS NULL
        AND n.content !~ '\\S' AND COALESCE(n.title, '') !~ '\\S' AND cardinality(n.tags) = 0
        AND NOT EXISTS (SELECT 1 FROM note_attachments a WHERE a.note_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM note_links l WHERE l.note_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM note_revisions v WHERE v.note_id = n.id)
        AND NOT EXISTS (SELECT 1 FROM notes r WHERE r.entity_type = 'note' AND r.entity_id = n.id::text)`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Soft-delete a live note. A thread root takes its live replies with it, under the same
 * `deleted_at`, which is how a restore tells them from a reply deleted on its own earlier.
 */
export const softDeleteNote = async (user: string, id: string): Promise<boolean> =>
  withUserTransaction(user, async (tx) => {
    const deleted = await query<{ id: string; entity_type: string }>(
      tx,
      `UPDATE notes SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id, entity_type`,
      [id],
    )
    const note = deleted.rows[0]
    if (!note) return false
    if (note.entity_type !== 'note') {
      await query(
        tx,
        `UPDATE notes SET deleted_at = NOW()
          WHERE entity_type = 'note' AND entity_id = $1 AND deleted_at IS NULL`,
        [note.id],
      )
    }
    return true
  })

export type NoteRestoreResult =
  | { status: 'not_found' }
  | { status: 'root_deleted' }
  | { status: 'restored'; note: Note }

/**
 * Bring back a soft-deleted note. A root brings back the replies deleted with it (the same
 * `deleted_at`), not one deleted on its own before. A reply under a deleted root stays deleted
 * until its root is restored. A live note is answered as it is.
 */
export const restoreNote = async (user: string, id: string): Promise<NoteRestoreResult> =>
  withUserTransaction(user, async (tx) => {
    const found = await query(tx, `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 FOR UPDATE`, [id])
    if (found.rows.length === 0) return { status: 'not_found' }
    const note = mapNoteRow(found.rows[0])
    if (!note.deleted_at) return { note, status: 'restored' }

    if (note.entity_type === 'note') {
      const root = await query(tx, `SELECT deleted_at FROM notes WHERE id::text = $1`, [note.entity_id])
      if (root.rows.length === 0 || root.rows[0].deleted_at !== null) return { status: 'root_deleted' }
    } else {
      await query(
        tx,
        `UPDATE notes SET deleted_at = NULL
          WHERE entity_type = 'note' AND entity_id = $1
            AND deleted_at = (SELECT deleted_at FROM notes WHERE id = $2)`,
        [note.id, note.id],
      )
    }
    const restored = await query(
      tx,
      `UPDATE notes SET deleted_at = NULL WHERE id = $1 RETURNING ${NOTE_COLUMNS}`,
      [note.id],
    )
    return { note: mapNoteRow(restored.rows[0]), status: 'restored' }
  })

export interface DeletedNote {
  note: Note
  /** The replies that a restore of this root brings back with it. Empty for a reply. */
  replies: Note[]
}

/**
 * What can be restored, newest deletion first: deleted thread roots, each with the replies
 * deleted with it, and deleted replies whose root is live.
 */
export const getDeletedNotes = async (user: string): Promise<DeletedNote[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes n
      WHERE n.deleted_at IS NOT NULL
        AND (n.entity_type <> 'note'
             OR EXISTS (SELECT 1 FROM notes r WHERE r.id::text = n.entity_id AND r.deleted_at IS NULL))
      ORDER BY n.deleted_at DESC, n.id DESC`,
  )
  const notes = result.rows.map(mapNoteRow)
  const roots = notes.filter((n) => n.entity_type !== 'note')
  const replies = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM notes r
      WHERE r.entity_type = 'note' AND r.entity_id = ANY($1)
        AND r.deleted_at = (SELECT n.deleted_at FROM notes n WHERE n.id::text = r.entity_id)
      ORDER BY r.created_at ASC`,
    [roots.map((n) => n.id)],
  )
  const repliesByRoot = new Map<string, Note[]>()
  for (const reply of replies.rows.map(mapNoteRow)) {
    if (reply.entity_id) repliesByRoot.getOrInsert(reply.entity_id, []).push(reply)
  }
  return notes.map((note) => ({
    note,
    replies: note.entity_type === 'note' ? [] : (repliesByRoot.get(note.id) ?? []),
  }))
}

/**
 * Remove for good the notes deleted more than `retentionDays` ago, the replies of the roots it
 * removes, and the attachments and templates deleted as long ago. Returns how many rows were removed.
 */
export const pruneDeletedNotes = async (user: string, retentionDays: number): Promise<number> =>
  withUserTransaction(user, async (tx) => {
    const gone = await query<{ id: string; entity_type: string }>(
      tx,
      `DELETE FROM notes WHERE deleted_at < NOW() - make_interval(days => $1::int) RETURNING id, entity_type`,
      [retentionDays],
    )
    const rootIds = gone.rows.filter((r) => r.entity_type !== 'note').map((r) => r.id)
    const replies = rootIds.length
      ? await query(tx, `DELETE FROM notes WHERE entity_type = 'note' AND entity_id = ANY($1)`, [rootIds])
      : { rowCount: 0 }
    const attachments = await query(
      tx,
      `DELETE FROM note_attachments WHERE deleted_at < NOW() - make_interval(days => $1::int)`,
      [retentionDays],
    )
    const templates = await query(
      tx,
      `DELETE FROM note_templates WHERE deleted_at < NOW() - make_interval(days => $1::int)`,
      [retentionDays],
    )
    return (
      gone.rows.length + (replies.rowCount ?? 0) + (attachments.rowCount ?? 0) + (templates.rowCount ?? 0)
    )
  })

/** There is no FK between a reply and its root, so removing roots must remove their replies by hand. */
const deleteRepliesIn = async (tx: Queryable, rootIds: string[]): Promise<void> => {
  if (rootIds.length === 0) return
  await query(tx, `DELETE FROM notes WHERE entity_type = 'note' AND entity_id = ANY($1)`, [rootIds])
}

/**
 * Delete every comment on the given entities, replies included. For an entity that is
 * removed for good (a meal, unlike a soft-deleted activity), its comments have
 * nothing left to hang off: they would keep drawing a Timeline bubble linking
 * to a page that 404s. Returns how many thread roots were removed. Runs inside
 * the caller's transaction, so the entities and their threads go together.
 */
export const deleteNotesForEntitiesIn = async (
  tx: Queryable,
  entityType: EntityType,
  entityIds: string[],
): Promise<number> => {
  if (entityIds.length === 0) return 0
  const deleted = await query<{ id: string }>(
    tx,
    `DELETE FROM notes WHERE entity_type = $1 AND entity_id = ANY($2) RETURNING id`,
    [entityType, entityIds],
  )
  const deletedIds = deleted.rows.map((r) => r.id)
  await deleteRepliesIn(tx, deletedIds)
  return deletedIds.length
}

export const deleteNotesForEntityIn = async (
  tx: Queryable,
  entityType: EntityType,
  entityId: string,
): Promise<number> => deleteNotesForEntitiesIn(tx, entityType, [entityId])

/**
 * Replace all user-authored notes (`source IS NULL`) for an entity with a
 * single new note. Synced notes (source = 'health_connect', 'oura', …) are
 * left untouched. If `content` is empty, just clears the user notes.
 *
 * Wrapped in a transaction so a concurrent edit can't observe the entity
 * with zero user notes between the DELETE and the INSERT.
 */
export const replaceUserNotes = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  content: string,
  startTime?: Date,
  endTime?: Date,
): Promise<void> =>
  withUserTransaction(user, async (tx) => {
    const deleted = await query<{ id: string }>(
      tx,
      `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 AND source IS NULL RETURNING id`,
      [entityType, entityId],
    )
    await deleteRepliesIn(
      tx,
      deleted.rows.map((r) => r.id),
    )
    if (content.length > 0) {
      await query(
        tx,
        `INSERT INTO notes (entity_type, entity_id, content, start_time, end_time)
         VALUES ($1, $2, $3, $4, $5)`,
        [entityType, entityId, content, startTime ?? null, endTime ?? null],
      )
    }
  })

/**
 * Join all user-authored notes (`source IS NULL`) for an entity into a single
 * string, ordered chronologically by created_at. Returns undefined if none.
 * Used for outbound HC sync, where the destination has a single `notes` field.
 *
 * Replies never surface here: they carry `entity_type = 'note'`, so the
 * entity_type filter already excludes them.
 */
export const getUserNotesJoined = async (
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<string | undefined> => {
  const result = await query<{ content: string }>(
    user,
    `SELECT content FROM notes
     WHERE entity_type = $1 AND entity_id = $2 AND source IS NULL AND deleted_at IS NULL
     ORDER BY created_at ASC`,
    [entityType, entityId],
  )
  if (result.rows.length === 0) return undefined
  return result.rows.map((r) => r.content).join('\n')
}

/**
 * Re-anchor notes from a set of source entities to a new entity (e.g. when
 * `mergeActivities` collapses several activities into one). All notes whose
 * `entity_id` is in `sourceIds` are reassigned to `targetId`.
 */
export const reanchorNotes = async (
  dbOrUser: Queryable | string,
  entityType: EntityType,
  sourceIds: string[],
  targetId: string,
): Promise<void> => {
  if (sourceIds.length === 0) return
  await query(
    dbOrUser,
    `UPDATE notes SET entity_id = $1, updated_at = NOW()
     WHERE entity_type = $2 AND entity_id = ANY($3)`,
    [targetId, entityType, sourceIds],
  )
}

/**
 * An empty/null content deletes the synced note (the comment was removed upstream) and its
 * replies. Otherwise the note's times move with the upstream ones, and its replies with it.
 */
export const upsertSyncedNoteIn = async (
  tx: Queryable,
  entityType: EntityType,
  entityId: string,
  source: DataSource,
  content: string | undefined,
  startTime?: Date,
  endTime?: Date,
): Promise<void> => {
  if (!content) {
    const deleted = await query<{ id: string }>(
      tx,
      `DELETE FROM notes WHERE entity_type = $1 AND entity_id = $2 AND source = $3 RETURNING id`,
      [entityType, entityId, source],
    )
    await deleteRepliesIn(
      tx,
      deleted.rows.map((r) => r.id),
    )
    return
  }

  const updated = await query<{ id: string }>(
    tx,
    `UPDATE notes SET content = $1, start_time = $5, end_time = $6, updated_at = NOW()
     WHERE entity_type = $2 AND entity_id = $3 AND source = $4
     RETURNING id`,
    [content, entityType, entityId, source, startTime ?? null, endTime ?? null],
  )

  if (updated.rows.length === 0) {
    await query(
      tx,
      `INSERT INTO notes (entity_type, entity_id, content, source, start_time, end_time)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [entityType, entityId, content, source, startTime ?? null, endTime ?? null],
    )
    return
  }

  await query(
    tx,
    `UPDATE notes SET start_time = $1, end_time = $2, updated_at = NOW()
     WHERE entity_type = 'note' AND entity_id = ANY($3)
       AND (start_time IS DISTINCT FROM $1 OR end_time IS DISTINCT FROM $2)`,
    [startTime ?? null, endTime ?? null, updated.rows.map((r) => r.id)],
  )
}

export const upsertSyncedNote = async (
  user: string,
  entityType: EntityType,
  entityId: string,
  source: DataSource,
  content: string | undefined,
  startTime?: Date,
  endTime?: Date,
): Promise<void> =>
  withUserTransaction(user, (tx) =>
    upsertSyncedNoteIn(tx, entityType, entityId, source, content, startTime, endTime),
  )
