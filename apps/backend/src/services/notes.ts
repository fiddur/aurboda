/**
 * A comment is a row in `notes` and comes in four shapes:
 *  - **on an entity** — `entity_type` is one of the real entities (activity,
 *    productivity, metric, report, meal) and `entity_id` points at it. Its
 *    `start_time`/`end_time` are a cache of the parent's timing, rewritten by
 *    `syncNoteTimesForEntity` whenever the parent moves.
 *  - **on a moment** — `entity_type = 'time'`, no `entity_id`; `start_time`
 *    (required) and `end_time` (optional) are user input and editable.
 *  - **on a day** — `entity_type = 'day'`, no `entity_id`, no times; `date`
 *    (YYYY-MM-DD) pins it to a calendar date whatever the timezone. A journal
 *    entry is a `time` or a `day` note, and can be switched between the two.
 *  - **a reply** — `entity_type = 'note'`, `entity_id` is the root comment's id.
 *    It inherits the root's times (and date) so the whole thread sits at one point in time.
 *
 * Deleting is recoverable: `deleted_at` hides a note (and a root's replies) from
 * every read until it is restored or purged after DELETED_NOTE_RETENTION_DAYS.
 *
 * Threads are exactly one level deep: replying to a reply re-anchors to its root.
 */

import {
  DELETED_NOTE_RETENTION_DAYS,
  endPrecedesStart,
  extractHashtags,
  isFreeStandingNoteType,
  isValidEntityId,
  NOTE_REVISION_LIMIT,
  NOTE_REVISION_MIN_INTERVAL_MINUTES,
  NOTE_TAGS_MAX,
  NOTE_TITLE_MAX_LENGTH,
  NOTES_SEARCH_DEFAULT_LIMIT,
  NOTES_SEARCH_MAX_LIMIT,
  normalizeNoteTags,
  normalizeNoteTitle,
  notesSearchRootTypes,
  parseNotesSearchEntityTypes,
  parseNotesSearchTags,
} from '@aurboda/api-spec'

import {
  deleteNote as dbDeleteNote,
  getDeletedNotes as dbGetDeletedNotes,
  getNoteById as dbGetNoteById,
  getNoteRevisions as dbGetNoteRevisions,
  getNoteRoot as dbGetNoteRoot,
  getNotesForEntity as dbGetNotesForEntity,
  getNotesForTimeRange as dbGetNotesForTimeRange,
  getRepliesForRootIds as dbGetRepliesForRootIds,
  insertNote as dbInsertNote,
  restoreNote as dbRestoreNote,
  searchNotes as dbSearchNotes,
  softDeleteNote as dbSoftDeleteNote,
  updateNoteGuarded as dbUpdateNoteGuarded,
  updateNoteTimesForEntity as dbUpdateNoteTimesForEntity,
  getActivityById,
  getMealById,
  getProductivityById,
  getReportById,
  type EntityType,
  type Note as DbNote,
  type NoteFieldUpdates,
  type NotesSearchCursor,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { getUserTimezone } from './settings.ts'

export interface AddNoteInput {
  entity_type: EntityType
  entity_id?: string | null
  content: string
  /** Only for `entity_type: 'time'`. */
  start_time?: string
  /** Only for `entity_type: 'time'`. */
  end_time?: string
  /** Only for `entity_type: 'day'`, where it is required. */
  date?: string
  /** Not on a reply. */
  title?: string | null
  tags?: string[]
}

export interface UpdateNoteInput {
  content?: string
  /** Only for `time` and `day` notes; on a `day` note it makes it a `time` note. */
  start_time?: string
  /** Only for `entity_type: 'time'`. Null clears it, making the comment a point in time. */
  end_time?: string | null
  /** Only for `time` and `day` notes; on a `time` note it makes it a `day` note. */
  date?: string
  /** Null clears it. Not on a reply. */
  title?: string | null
  tags?: string[]
  /** When given and the note's `updated_at` differs, nothing is written: the answer is a conflict. */
  expected_updated_at?: string
}

export interface NoteReplyData {
  id: string
  content: string
  source?: string
  start_time?: string
  end_time?: string
  date?: string
  title?: string
  tags: string[]
  deleted_at?: string
  created_at: string
  updated_at: string
}

export interface NoteData {
  id: string
  entity_type: EntityType
  entity_id: string | null
  content: string
  source?: string
  start_time?: string
  end_time?: string
  date?: string
  title?: string
  tags: string[]
  deleted_at?: string
  purge_at?: string
  created_at: string
  updated_at: string
  replies?: NoteReplyData[]
}

export type NoteResultErrorCode = 'not_found' | 'invalid' | 'conflict'

export interface NoteResult {
  success: boolean
  data?: NoteData
  error?: string
  errorCode?: NoteResultErrorCode
}

export interface NoteRevisionData {
  id: string
  content: string
  title?: string
  saved_at: string
}

export interface NotesSearchInput {
  q?: string
  tags?: string
  from?: string
  to?: string
  on_this_day?: string
  entity_types?: string
  tz?: string
  limit?: number
  cursor?: string
}

export type NotesSearchResult =
  | { success: true; data: NoteData[]; next_cursor: string | null }
  | { success: false; error: string; errorCode: 'invalid' }

export const NOTE_CONFLICT_ERROR = 'This comment was changed elsewhere'

const TIMES_ON_ANCHORED_NOTE = 'Times can only be set on a time-anchored comment'
const DATE_ON_ANCHORED_NOTE = 'A date can only be set on a free-standing comment (a "time" or "day" entry)'
const END_BEFORE_START = 'end_time must not precede start_time'
const SYNCED_NOTE_NOT_EDITABLE =
  'This comment came from a synced source and cannot be edited — the next sync would overwrite it'
const EMPTY_CONTENT = 'content must not be empty'
const REPLY_TITLE = 'A reply cannot have a title'

/** A note's tags: the explicit ones and the #hashtags of its content, deduplicated and sorted. */
export const noteTags = (note: DbNote): string[] =>
  [...new Set([...(note.tags ?? []), ...(note.hashtags ?? [])])].sort()

export const toNoteReplyData = (note: DbNote): NoteReplyData => ({
  content: note.content,
  created_at: note.created_at.toISOString(),
  date: note.date,
  deleted_at: note.deleted_at?.toISOString(),
  end_time: note.end_time?.toISOString(),
  id: note.id,
  source: note.source,
  start_time: note.start_time?.toISOString(),
  tags: noteTags(note),
  title: note.title,
  updated_at: note.updated_at.toISOString(),
})

const invalid = (error: string): NoteResult => ({ error, errorCode: 'invalid', success: false })
const notFound = (): NoteResult => ({ error: 'Note not found', errorCode: 'not_found', success: false })

const DAY_MS = 24 * 60 * 60 * 1000

export const toNoteData = (note: DbNote, replies?: DbNote[]): NoteData => ({
  content: note.content,
  created_at: note.created_at.toISOString(),
  date: note.date,
  deleted_at: note.deleted_at?.toISOString(),
  end_time: note.end_time?.toISOString(),
  entity_id: note.entity_id,
  entity_type: note.entity_type,
  id: note.id,
  purge_at: note.deleted_at
    ? new Date(note.deleted_at.getTime() + DELETED_NOTE_RETENTION_DAYS * DAY_MS).toISOString()
    : undefined,
  replies: replies?.map(toNoteReplyData),
  source: note.source,
  start_time: note.start_time?.toISOString(),
  tags: noteTags(note),
  title: note.title,
  updated_at: note.updated_at.toISOString(),
})

/** Attach each root's replies, oldest first, in one batched lookup. */
const withReplies = async (user: string, roots: DbNote[]): Promise<NoteData[]> => {
  if (roots.length === 0) return []
  const repliesByRoot = await dbGetRepliesForRootIds(
    user,
    roots.map((n) => n.id),
  )
  return roots.map((n) => toNoteData(n, repliesByRoot.get(n.id) ?? []))
}

/** A real calendar date in YYYY-MM-DD, not just the shape of one. */
export const isCalendarDate = (value: string): boolean => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  try {
    Temporal.PlainDate.from(value, { overflow: 'reject' })
    return true
  } catch {
    return false
  }
}

/** Why the title or tags are refused, if they are; else the stored forms. */
const checkTitleAndTags = (
  input: { title?: string | null; tags?: string[] },
  isReply: boolean,
): string | { title: string | null | undefined; tags: string[] | undefined } => {
  const title = normalizeNoteTitle(input.title)
  if (title != null && title.length > NOTE_TITLE_MAX_LENGTH) {
    return `title must be at most ${NOTE_TITLE_MAX_LENGTH} characters`
  }
  if (isReply && title != null) return REPLY_TITLE
  if (input.tags === undefined) return { tags: undefined, title }
  if (input.tags.length > NOTE_TAGS_MAX) return `At most ${NOTE_TAGS_MAX} tags`
  const tags = normalizeNoteTags(input.tags)
  if (tags === null) return 'Not a valid tag list (letters, digits and _, not only digits)'
  return { tags, title }
}

/**
 * Look up the time range of the parent entity to inherit into the note.
 * Returns undefined for metric entity types since they use a composite key,
 * and for `time` notes whose times come from the request instead.
 */
async function getEntityTimes(
  user: string,
  entityType: Exclude<EntityType, 'note'>,
  entityId: string,
): Promise<{ start_time: Date; end_time?: Date } | undefined> {
  switch (entityType) {
    case 'activity': {
      const activity = await getActivityById(user, entityId)
      if (!activity) return undefined
      return { end_time: activity.end_time ?? undefined, start_time: activity.start_time }
    }
    case 'productivity': {
      const record = await getProductivityById(user, entityId)
      if (!record) return undefined
      return { end_time: record.end_time, start_time: record.start_time }
    }
    case 'metric':
      // Metric entity_id is a composite key; time is encoded in the key itself.
      // We don't set inherited times for metric notes.
      return undefined
    case 'report': {
      const report = await getReportById(user, entityId)
      if (!report) return undefined
      return { start_time: report.report_date }
    }
    case 'meal': {
      const meal = await getMealById(user, entityId)
      if (!meal) return undefined
      return { start_time: meal.time }
    }
    case 'time':
    case 'day':
      // A moment's times are supplied by the caller; a day has none.
      return undefined
  }
}

// eslint-disable-next-line complexity -- one validation branch per shape
export async function addNote(user: string, input: AddNoteInput): Promise<NoteResult> {
  const checked = checkTitleAndTags(input, input.entity_type === 'note')
  if (typeof checked === 'string') return invalid(checked)
  if (input.content.length === 0 && !isFreeStandingNoteType(input.entity_type)) return invalid(EMPTY_CONTENT)
  if (input.entity_type !== 'day' && input.date !== undefined) {
    return invalid("date can only be set when entity_type is 'day'")
  }
  const extras = { hashtags: extractHashtags(input.content), tags: checked.tags, title: checked.title }

  if (input.entity_type === 'day') {
    if (input.entity_id) return invalid("entity_id must be omitted when entity_type is 'day'")
    if (input.start_time !== undefined || input.end_time !== undefined) {
      return invalid("A 'day' entry has no start_time or end_time")
    }
    if (input.date === undefined || !isCalendarDate(input.date)) {
      return invalid("date (YYYY-MM-DD) is required when entity_type is 'day'")
    }
    const note = await dbInsertNote(user, 'day', null, input.content, undefined, undefined, {
      ...extras,
      date: input.date,
    })
    return { data: toNoteData(note), success: true }
  }

  if (input.entity_type === 'time') {
    if (input.entity_id) {
      return invalid("entity_id must be omitted when entity_type is 'time'")
    }
    if (!input.start_time) {
      return invalid("start_time is required when entity_type is 'time'")
    }
    if (endPrecedesStart(input.start_time, input.end_time)) {
      return invalid(END_BEFORE_START)
    }
    const note = await dbInsertNote(
      user,
      'time',
      null,
      input.content,
      new Date(input.start_time),
      input.end_time ? new Date(input.end_time) : undefined,
      extras,
    )
    return { data: toNoteData(note), success: true }
  }

  if (!input.entity_id) {
    return invalid("entity_id is required unless entity_type is 'time' or 'day'")
  }
  if (!isValidEntityId(input.entity_type, input.entity_id)) {
    return invalid(`entity_id must be a UUID when entity_type is '${input.entity_type}'`)
  }
  if (input.start_time !== undefined || input.end_time !== undefined) {
    return invalid(TIMES_ON_ANCHORED_NOTE)
  }

  if (input.entity_type === 'note') {
    // Threads are one level deep: replying to a reply re-anchors to its root.
    const root = await dbGetNoteRoot(user, input.entity_id)
    if (!root) {
      return { error: 'Comment to reply to not found', errorCode: 'not_found', success: false }
    }
    const reply = await dbInsertNote(user, 'note', root.id, input.content, root.start_time, root.end_time, {
      ...extras,
      date: root.date,
    })
    return { data: toNoteData(reply), success: true }
  }

  const times = await getEntityTimes(user, input.entity_type, input.entity_id)
  const note = await dbInsertNote(
    user,
    input.entity_type,
    input.entity_id,
    input.content,
    times?.start_time,
    times?.end_time,
    extras,
  )
  return { data: toNoteData(note), success: true }
}

/** Why moving a `time` note to the times in `fields` is refused, if it is: the result is checked whole. */
const checkMove = (existing: DbNote, fields: UpdateNoteInput): string | undefined => {
  const startTime = fields.start_time ?? existing.start_time?.toISOString()
  const endTime = fields.end_time === undefined ? existing.end_time?.toISOString() : fields.end_time
  return endPrecedesStart(startTime, endTime) ? END_BEFORE_START : undefined
}

/**
 * The anchor columns to write: a `time` note moves, or becomes a `day` note when given a date;
 * a `day` note changes its date, or becomes a `time` note when given a start_time.
 */
const anchorUpdate = (existing: DbNote, fields: UpdateNoteInput): string | NoteFieldUpdates => {
  const movesInTime = fields.start_time !== undefined || fields.end_time !== undefined
  if (fields.date !== undefined) {
    if (movesInTime) return 'date cannot be set together with start_time or end_time'
    if (!isFreeStandingNoteType(existing.entity_type)) return DATE_ON_ANCHORED_NOTE
    if (!isCalendarDate(fields.date)) return 'date must be a calendar date (YYYY-MM-DD)'
    return { date: fields.date, end_time: null, entity_type: 'day', start_time: null }
  }
  if (!movesInTime) return {}
  if (existing.entity_type === 'day') {
    if (fields.start_time === undefined) return "start_time is required to give a 'day' entry a time"
    if (endPrecedesStart(fields.start_time, fields.end_time)) return END_BEFORE_START
    return {
      date: null,
      end_time: fields.end_time ? new Date(fields.end_time) : null,
      entity_type: 'time',
      start_time: new Date(fields.start_time),
    }
  }
  if (existing.entity_type !== 'time') return TIMES_ON_ANCHORED_NOTE
  const moveError = checkMove(existing, fields)
  if (moveError) return moveError
  return {
    // null clears the end, turning a span back into a point in time.
    end_time: fields.end_time == null ? fields.end_time : new Date(fields.end_time),
    start_time: fields.start_time === undefined ? undefined : new Date(fields.start_time),
  }
}

/**
 * Update a comment's content, title and tags and — for a free-standing comment only — its anchor.
 * Moving one moves its whole thread with it. With `expected_updated_at` a change made elsewhere in
 * the meantime is a conflict that writes nothing. The text it replaces is kept as a revision.
 */
export async function updateNote(user: string, id: string, fields: UpdateNoteInput): Promise<NoteResult> {
  if (!UUID_RE.test(id)) return notFound()
  const existing = await dbGetNoteById(user, id)
  if (!existing) {
    return notFound()
  }

  // A synced comment (Oura, Health Connect, …) is owned by its source: the next
  // sync rewrites it through upsertSyncedNote, so an edit here would silently
  // vanish. The web UI hides Edit; REST and MCP need the same answer.
  if (existing.source) {
    return invalid(SYNCED_NOTE_NOT_EDITABLE)
  }

  const checked = checkTitleAndTags(fields, existing.entity_type === 'note')
  if (typeof checked === 'string') return invalid(checked)
  if (fields.content === '' && !isFreeStandingNoteType(existing.entity_type)) return invalid(EMPTY_CONTENT)

  const anchor = anchorUpdate(existing, fields)
  if (typeof anchor === 'string') return invalid(anchor)

  const result = await dbUpdateNoteGuarded(
    user,
    id,
    {
      ...anchor,
      content: fields.content,
      hashtags: fields.content === undefined ? undefined : extractHashtags(fields.content),
      tags: checked.tags,
      title: checked.title,
    },
    {
      expected_updated_at:
        fields.expected_updated_at === undefined ? undefined : new Date(fields.expected_updated_at),
      revisions: { limit: NOTE_REVISION_LIMIT, min_interval_minutes: NOTE_REVISION_MIN_INTERVAL_MINUTES },
    },
  )
  if (result.status === 'not_found') return notFound()
  if (result.status === 'conflict') {
    return {
      data: toNoteData(result.note),
      error: NOTE_CONFLICT_ERROR,
      errorCode: 'conflict',
      success: false,
    }
  }
  return { data: toNoteData(result.note), success: true }
}

/**
 * Delete a comment, and on a thread root its replies. Without `purge` it can be restored for
 * {@link DELETED_NOTE_RETENTION_DAYS} days; with it, it is removed for good at once, deleted or not.
 */
export async function deleteNoteById(
  user: string,
  id: string,
  options: { purge?: boolean } = {},
): Promise<{ success: boolean; deleted: boolean }> {
  if (!UUID_RE.test(id)) return { deleted: false, success: false }
  const deleted = options.purge ? await dbDeleteNote(user, id) : await dbSoftDeleteNote(user, id)
  return { deleted, success: deleted }
}

/** Bring back a deleted comment, with the replies deleted with it. A live one is answered as it is. */
export async function restoreNoteById(user: string, id: string): Promise<NoteResult> {
  if (!UUID_RE.test(id)) return notFound()
  const result = await dbRestoreNote(user, id)
  if (result.status === 'not_found') return notFound()
  if (result.status === 'root_deleted') {
    return { error: 'Restore the comment it replies to first', errorCode: 'conflict', success: false }
  }
  if (result.note.entity_type === 'note') return { data: toNoteData(result.note), success: true }
  const [data] = await withReplies(user, [result.note])
  return { data, success: true }
}

/** What can still be restored, newest deletion first, each with `deleted_at` and `purge_at`. */
export async function listDeletedNotes(user: string): Promise<NoteData[]> {
  const deleted = await dbGetDeletedNotes(user)
  return deleted.map(({ note, replies }) =>
    toNoteData(note, note.entity_type === 'note' ? undefined : replies),
  )
}

/** A note's earlier texts, newest first. A deleted comment's are out of sight with it. */
export async function getNoteRevisionsById(
  user: string,
  id: string,
): Promise<{ success: true; data: NoteRevisionData[] } | { success: false; error: string }> {
  if (!UUID_RE.test(id)) return { error: 'Note not found', success: false }
  const note = await dbGetNoteById(user, id)
  if (!note) return { error: 'Note not found', success: false }
  const revisions = await dbGetNoteRevisions(user, id)
  return {
    data: revisions.map((r) => ({
      content: r.content,
      id: r.id,
      saved_at: r.saved_at.toISOString(),
      title: r.title,
    })),
    success: true,
  }
}

const PREFIX_WORD = /^[\p{L}\p{N}]+$/u

/** The words of a search, with the last one split off to match as a prefix when it is a plain word. */
export const splitSearchText = (q: string): { websearch: string; prefix?: string } | undefined => {
  const text = q.trim()
  if (text.length === 0) return undefined
  const words = text.split(/\s+/)
  const last = words.at(-1)!
  const head = words.slice(0, -1).join(' ')
  const balancedQuotes = (text.match(/"/g) ?? []).length % 2 === 0
  const afterOr = words.at(-2)?.toLowerCase() === 'or'
  if (balancedQuotes && !afterOr && PREFIX_WORD.test(last) && last.toLowerCase() !== 'or') {
    return { prefix: last.toLowerCase(), websearch: head }
  }
  return { websearch: text }
}

const isLeapYear = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0

/** Earlier years on the same month and day; 28 February of a non-leap year takes 29 February too. */
export const onThisDayFilter = (date: string): { before_year: number; month_days: string[] } => {
  const [year, month, day] = date.split('-')
  const monthDay = `${month}-${day}`
  const leapDay = monthDay === '02-28' && !isLeapYear(Number(year)) ? ['02-29'] : []
  return { before_year: Number(year), month_days: [monthDay, ...leapDay] }
}

const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/

export const encodeNotesCursor = (cursor: NotesSearchCursor): string =>
  Buffer.from(JSON.stringify([cursor.anchor, cursor.created_at, cursor.id])).toString('base64url')

export const decodeNotesCursor = (raw: string): NotesSearchCursor | null => {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8'))
    if (!Array.isArray(parsed) || parsed.length !== 3) return null
    const [anchor, createdAt, id] = parsed
    if (typeof anchor !== 'string' || !CURSOR_INSTANT.test(anchor)) return null
    if (typeof createdAt !== 'string' || !CURSOR_INSTANT.test(createdAt)) return null
    if (typeof id !== 'string' || !UUID_RE.test(id)) return null
    return { anchor, created_at: createdAt, id }
  } catch {
    return null
  }
}

const searchInvalid = (error: string): NotesSearchResult => ({ error, errorCode: 'invalid', success: false })

/**
 * Search and list comment thread roots, newest first, replies nested. Without filters it lists
 * the free-standing entries, which is what the journal reads.
 */
// eslint-disable-next-line complexity -- one check per query parameter
export async function searchNotesForUser(user: string, input: NotesSearchInput): Promise<NotesSearchResult> {
  const tags = parseNotesSearchTags(input.tags)
  if (tags === null) return searchInvalid('Not a valid tag list (letters, digits and _, comma-separated)')
  const entityTypes = parseNotesSearchEntityTypes(input.entity_types)
  const unknownType = entityTypes.find((type) => !(notesSearchRootTypes as readonly string[]).includes(type))
  if (unknownType !== undefined) {
    return searchInvalid(
      `Not a comment root type: ${unknownType} (one of ${notesSearchRootTypes.join(', ')})`,
    )
  }
  for (const date of [input.from, input.to, input.on_this_day]) {
    if (date !== undefined && !isCalendarDate(date)) return searchInvalid(`Not a date (YYYY-MM-DD): ${date}`)
  }
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return searchInvalid('to must not precede from')
  }
  const cursor = input.cursor === undefined ? undefined : decodeNotesCursor(input.cursor)
  if (cursor === null) return searchInvalid('Not a valid cursor')
  const limit = Math.min(
    Math.max(Math.trunc(input.limit ?? NOTES_SEARCH_DEFAULT_LIMIT), 1),
    NOTES_SEARCH_MAX_LIMIT,
  )

  const page = await dbSearchNotes(user, {
    cursor,
    entity_types: entityTypes,
    from: input.from,
    limit,
    on_this_day: input.on_this_day === undefined ? undefined : onThisDayFilter(input.on_this_day),
    tags,
    text: input.q === undefined ? undefined : splitSearchText(input.q),
    to: input.to,
    tz: input.tz ?? (await getUserTimezone(user)),
  })
  return {
    data: await withReplies(user, page.notes),
    next_cursor: page.next_cursor ? encodeNotesCursor(page.next_cursor) : null,
    success: true,
  }
}

/** All comments on an entity, each with its own thread nested under `replies`. */
export async function getNotesForEntity(
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<NoteData[]> {
  const notes = await dbGetNotesForEntity(user, entityType, entityId)
  return withReplies(user, notes)
}

const localDate = (instant: Date, tz: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(tz).toPlainDate().toString()

/**
 * Every comment anchored in [from, to] — thread roots only, each with its
 * replies nested — and the `day` entries on the window's local dates in `tz`
 * (default the user's zone). This is what the Timeline's comment track reads.
 */
export async function getNotesInRange(user: string, from: Date, to: Date, tz?: string): Promise<NoteData[]> {
  const zone = tz ?? (await getUserTimezone(user))
  const roots = await dbGetNotesForTimeRange(user, from, to, {
    from: localDate(from, zone),
    to: localDate(to, zone),
  })
  return withReplies(user, roots)
}

/**
 * Call this from tag/activity update handlers.
 */
export async function syncNoteTimesForEntity(
  user: string,
  entityType: EntityType,
  entityId: string,
  startTime: Date,
  endTime?: Date,
): Promise<void> {
  await dbUpdateNoteTimesForEntity(user, entityType, entityId, startTime, endTime)
}
