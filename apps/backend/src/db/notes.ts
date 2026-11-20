import type { DataSource } from '@aurboda/api-spec'

import type { Queryable } from './pool.ts'
import type { EntityType, Note, NoteRevision } from './types.ts'

import { UUID_RE } from '../utils.ts'
import { query, withUserTransaction } from './connection.ts'
import { buildDynamicUpdate } from './dynamic-update.ts'
import { mapNoteRow } from './row-mappers.ts'

const NOTE_COLUMNS = `id, entity_type, entity_id, content, source, start_time, end_time,
  to_char("date", 'YYYY-MM-DD') AS "date", title, tags, hashtags, deleted_at, created_at, updated_at`

/** The journal fields of a note; a reply carries its root's `date` and no title. */
export interface NoteExtras {
  title?: string | null
  tags?: string[]
  hashtags?: string[]
  date?: string | null
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
  const result = await query(
    user,
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

/**
 * Update a live note in one transaction: the row is locked, `expected_updated_at` (when given)
 * is compared with the stored `updated_at` to the millisecond, the previous text is kept as a
 * revision when the content or title changes, and when the anchor moves its replies move with it.
 * `updated_at` is always bumped.
 */
export const updateNoteGuarded = async (
  user: string,
  id: string,
  fields: NoteFieldUpdates,
  options: { expected_updated_at?: Date; revisions: NoteRevisionPolicy },
): Promise<GuardedNoteUpdate> =>
  withUserTransaction(user, async (tx) => {
    const locked = await query(
      tx,
      `SELECT ${NOTE_COLUMNS} FROM notes WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`,
      [id],
    )
    if (locked.rows.length === 0) return { status: 'not_found' }
    const existing = mapNoteRow(locked.rows[0])

    if (
      options.expected_updated_at !== undefined &&
      options.expected_updated_at.getTime() !== existing.updated_at.getTime()
    ) {
      return { note: existing, status: 'conflict' }
    }

    const contentChanged = fields.content !== undefined && fields.content !== existing.content
    const titleChanged = fields.title !== undefined && (fields.title ?? undefined) !== existing.title
    if (contentChanged || titleChanged) await saveRevisionIn(tx, existing, options.revisions)

    const update = buildDynamicUpdate('notes', id, fieldEntries(fields), {
      defaultClauses: ['updated_at = NOW()'],
      returning: NOTE_COLUMNS,
    })
    const result = await query(tx, update!.sql, update!.params)
    const note = mapNoteRow(result.rows[0])

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

/**
 * Whether a root note's parent is live, for the alias `n` with a `parent_id` column (the uuid of
 * `entity_id` when it is one). A comment whose parent is soft-deleted (it reappears on restore) or
 * gone altogether would draw a Timeline bubble linking to something that 404s. The parent lookup is
 * a primary-key probe per row.
 */
const PARENT_IS_LIVE = `CASE n.entity_type
       WHEN 'activity' THEN EXISTS (SELECT 1 FROM activities a WHERE a.id = n.parent_id AND a.deleted_at IS NULL)
       WHEN 'productivity' THEN EXISTS (SELECT 1 FROM productivity p WHERE p.id = n.parent_id AND p.deleted_at IS NULL)
       WHEN 'meal' THEN EXISTS (SELECT 1 FROM meals m WHERE m.id = n.parent_id)
       WHEN 'report' THEN EXISTS (SELECT 1 FROM reports r WHERE r.id = n.parent_id)
       ELSE TRUE
     END`

/** The CASE guards the uuid cast, since Postgres does not short-circuit a WHERE. */
const parentIdColumn = (uuidParam: string): string =>
  `CASE WHEN n.entity_id ~* ${uuidParam} THEN n.entity_id::uuid END AS parent_id`

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
): Promise<Note[]> => {
  const result = await query(
    user,
    `SELECT ${NOTE_COLUMNS} FROM (
       SELECT n.*, ${parentIdColumn('$3')}
       FROM notes n
       WHERE n.entity_type <> 'note'
         AND n.deleted_at IS NULL
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
}

export interface NotesSearchPage {
  notes: Note[]
  next_cursor: NotesSearchCursor | null
}

/**
 * Thread roots, newest first by anchor (a `day` note's anchor is the start of its date in `tz`),
 * then created_at and id, with keyset pagination on that order. A text match in a live reply
 * returns its root. Roots with no anchor at all (metric comments) are left out.
 */
export const searchNotes = async (user: string, params: NotesSearchParams): Promise<NotesSearchPage> => {
  const values: unknown[] = []
  const param = (value: unknown): string => {
    values.push(value)
    return `$${values.length}`
  }
  const tz = param(params.tz)
  const anchor = `CASE WHEN n.entity_type = 'day' THEN (n."date"::timestamp AT TIME ZONE ${tz}) ELSE n.start_time END`
  const localDay = `CASE WHEN n.entity_type = 'day' THEN n."date" ELSE (n.start_time AT TIME ZONE ${tz})::date END`

  const conditions = [
    `n.entity_type = ANY(${param(params.entity_types)}::text[])`,
    `n.entity_type <> 'note'`,
    `n.deleted_at IS NULL`,
    `(n.start_time IS NOT NULL OR n.entity_type = 'day')`,
  ]
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
  if (params.from) conditions.push(`${localDay} >= ${param(params.from)}::date`)
  if (params.to) conditions.push(`${localDay} <= ${param(params.to)}::date`)
  if (params.on_this_day) {
    conditions.push(`EXTRACT(YEAR FROM ${localDay}) < ${param(params.on_this_day.before_year)}`)
    conditions.push(`to_char(${localDay}, 'MM-DD') = ANY(${param(params.on_this_day.month_days)}::text[])`)
  }
  const uuidParam = param(UUID_RE.source)
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
            to_char(created_at AT TIME ZONE 'UTC', ${CURSOR_FORMAT}) AS cursor_created_at
       FROM (
       SELECT n.*, ${anchor} AS anchor FROM (
         SELECT n.*, ${parentIdColumn(uuidParam)}
           FROM notes n
          WHERE ${conditions.join(' AND ')}
       ) n
       WHERE ${PARENT_IS_LIVE}
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
  }
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
 * Remove for good the notes deleted more than `retentionDays` ago, and the replies of the roots
 * it removes. Returns how many notes were removed.
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
    return gone.rows.length + (replies.rowCount ?? 0)
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
