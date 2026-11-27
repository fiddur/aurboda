/**
 * A comment is a row in `notes` and comes in four shapes:
 *  - **on an entity** — `entity_type` is one of the real entities (activity,
 *    productivity, metric, report, meal, person) and `entity_id` points at it. Its
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
  findHashtags,
  isFreeStandingNoteType,
  isValidEntityId,
  JOURNAL_ENTRY_EXCERPT_MAX,
  JOURNAL_ENTRY_REFS_LIMIT,
  type JournalEntryRef,
  NOTE_REPLY_RELATED_ERROR,
  NOTE_REVISION_LIMIT,
  NOTE_REVISION_MIN_INTERVAL_MINUTES,
  NOTE_TAGS_MAX,
  NOTE_TAGS_MERGE_INTO_ERROR,
  NOTE_TITLE_MAX_LENGTH,
  NOTES_SEARCH_DEFAULT_LIMIT,
  NOTES_SEARCH_MAX_LIMIT,
  NOTES_SEARCH_RELATED_PAIR_ERROR,
  NOTES_SEARCH_TAGS_ERROR,
  notesSearchEntityTypeError,
  normalizeNoteTags,
  normalizeNoteTitle,
  notesSearchRootTypes,
  parseNotesSearchEntityTypes,
  parseNotesSearchTags,
  NOTES_SEARCH_DEFAULT_ENTITY_TYPES,
  type NoteAttachment,
  type NoteNeighbor,
  type NoteNeighbors,
  type NoteRelated,
  type NoteRelatedEntityType,
  type NoteTagSummary,
} from '@aurboda/api-spec'

import {
  deleteBlankNote as dbDeleteBlankNote,
  deleteNote as dbDeleteNote,
  getDeletedNotes as dbGetDeletedNotes,
  getNoteAttachmentsForNoteIds as dbGetNoteAttachmentsForNoteIds,
  getNoteLinksForNoteIds as dbGetNoteLinksForNoteIds,
  listLiveLinkTargetIds as dbListLiveLinkTargetIds,
  listNotesRelatedTo as dbListNotesRelatedTo,
  getNoteById as dbGetNoteById,
  getNoteNeighbors as dbGetNoteNeighbors,
  getNoteRevisions as dbGetNoteRevisions,
  getNoteRoot as dbGetNoteRoot,
  getNotesForEntity as dbGetNotesForEntity,
  getNotesForTimeRange as dbGetNotesForTimeRange,
  getNotesWithAnyTag as dbGetNotesWithAnyTag,
  listNoteTags as dbListNoteTags,
  getRepliesForRootIds as dbGetRepliesForRootIds,
  insertNote as dbInsertNote,
  restoreNote as dbRestoreNote,
  searchNotes as dbSearchNotes,
  softDeleteNote as dbSoftDeleteNote,
  updateNoteGuarded as dbUpdateNoteGuarded,
  updateNoteTimesForEntity as dbUpdateNoteTimesForEntity,
  getActivityById,
  getMealById,
  getPerson,
  getProductivityById,
  getReportById,
  type EntityType,
  type Note as DbNote,
  type NoteFieldUpdates,
  type NoteLinkInput,
  type NoteLinkRecord,
  type NotesSearchCursor,
} from '../db/index.ts'
import { UUID_RE } from '../utils.ts'
import { toNoteAttachmentData } from './note-attachments.ts'
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
  related?: NoteLinkInput[]
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
  related?: NoteLinkInput[]
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
  /** On a journal entry (a `time` or `day` root): its live pictures and recordings, in page order. */
  attachments?: NoteAttachment[]
  /** On a thread root: what it is related to whose targets are live. */
  related?: NoteRelated[]
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
  needs_text?: boolean
  related_type?: NoteRelatedEntityType
  related_id?: string
}

export type NotesSearchResult =
  | { success: true; data: NoteData[]; next_cursor: string | null; total?: number }
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

export const toNoteData = (
  note: DbNote,
  replies?: DbNote[],
  attachments?: readonly NoteAttachment[],
  related?: readonly NoteRelated[],
): NoteData => ({
  attachments: attachments === undefined ? undefined : [...attachments],
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
  related: related === undefined ? undefined : [...related],
  replies: replies?.map(toNoteReplyData),
  source: note.source,
  start_time: note.start_time?.toISOString(),
  tags: noteTags(note),
  title: note.title,
  updated_at: note.updated_at.toISOString(),
})

/** The live attachments of the journal entries among `roots`, in one batched lookup. */
const attachmentsFor = async (user: string, roots: DbNote[]): Promise<Map<string, NoteAttachment[]>> => {
  const entryIds = roots.filter((n) => isFreeStandingNoteType(n.entity_type)).map((n) => n.id)
  if (entryIds.length === 0) return new Map()
  const records = await dbGetNoteAttachmentsForNoteIds(user, entryIds)
  return new Map([...records].map(([id, list]) => [id, list.map(toNoteAttachmentData)]))
}

/** A journal entry's attachments ([] when it has none); undefined for any other comment. */
const entryAttachments = (
  note: DbNote,
  byNote: Map<string, NoteAttachment[]>,
): NoteAttachment[] | undefined =>
  isFreeStandingNoteType(note.entity_type) ? (byNote.get(note.id) ?? []) : undefined

const localDate = (instant: Date, tz: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime()).toZonedDateTimeISO(tz).toPlainDate().toString()

const localTime = (instant: Date, tz: string): string =>
  Temporal.Instant.fromEpochMilliseconds(instant.getTime())
    .toZonedDateTimeISO(tz)
    .toPlainTime()
    .toString({ smallestUnit: 'minute' })

const titleCase = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

/**
 * A link's label in `tz`: the person's name; the activity's name and local date (a sleep is dated
 * by the morning it ended, as the editor's picker lists it); the meal's type and local time; the
 * report's type and local date; the check-in's form name and local time.
 */
export const noteRelatedLabel = (
  link: Pick<NoteLinkRecord, 'entity_type' | 'name' | 'start_time' | 'end_time' | 'activity_type'>,
  tz: string,
): string => {
  if (link.start_time === null) return link.name
  switch (link.entity_type) {
    case 'meal': {
      const type = link.name.trim()
      return `${type ? type.charAt(0).toUpperCase() + type.slice(1) : 'Meal'} ${localTime(link.start_time, tz)}`
    }
    case 'report':
      return `${titleCase(link.name)}, ${localDate(link.start_time, tz)}`
    case 'check_in':
      return `${link.name} ${localTime(link.start_time, tz)}`
    default: {
      const dated = link.activity_type === 'sleep' && link.end_time !== null ? link.end_time : link.start_time
      return `${link.name}, ${localDate(dated, tz)}`
    }
  }
}

/** The visible links of the thread roots among `notes`, labelled, in one batched lookup. */
const relatedFor = async (user: string, notes: DbNote[]): Promise<Map<string, NoteRelated[]>> => {
  const rootIds = notes.filter((n) => n.entity_type !== 'note').map((n) => n.id)
  if (rootIds.length === 0) return new Map()
  const links = await dbGetNoteLinksForNoteIds(user, rootIds)
  const needsZone = [...links.values()].some((list) => list.some((link) => link.start_time !== null))
  const tz = needsZone ? await getUserTimezone(user) : 'UTC'
  return new Map(
    [...links].map(([id, list]) => [
      id,
      list.map((link) => ({
        ...(link.activity_type === null ? {} : { activity_type: link.activity_type }),
        ...(link.form_id === null ? {} : { form_id: link.form_id }),
        entity_id: link.entity_id,
        entity_type: link.entity_type,
        label: noteRelatedLabel(link, tz),
      })),
    ]),
  )
}

/** A thread root's links ([] when it has none); undefined for a reply. */
const rootRelated = (note: DbNote, byNote: Map<string, NoteRelated[]>): NoteRelated[] | undefined =>
  note.entity_type === 'note' ? undefined : (byNote.get(note.id) ?? [])

/** Attach each root's replies, oldest first, a journal entry's attachments and the links, in batched lookups. */
export const withReplies = async (user: string, roots: DbNote[]): Promise<NoteData[]> => {
  if (roots.length === 0) return []
  const [repliesByRoot, attachments, related] = await Promise.all([
    dbGetRepliesForRootIds(
      user,
      roots.map((n) => n.id),
    ),
    attachmentsFor(user, roots),
    relatedFor(user, roots),
  ])
  return roots.map((n) =>
    toNoteData(n, repliesByRoot.get(n.id) ?? [], entryAttachments(n, attachments), rootRelated(n, related)),
  )
}

/** One root as answered by a write: with its attachments when it is a journal entry, and its links. */
const withAttachments = async (user: string, note: DbNote): Promise<NoteData> => {
  const [attachments, related] = await Promise.all([attachmentsFor(user, [note]), relatedFor(user, [note])])
  return toNoteData(note, undefined, entryAttachments(note, attachments), rootRelated(note, related))
}

/** A just-created root: a journal entry answers with its (still empty) attachments, as reads do. */
const createdNoteData = async (user: string, note: DbNote, related: boolean): Promise<NoteData> =>
  toNoteData(
    note,
    undefined,
    entryAttachments(note, new Map()),
    rootRelated(note, related ? await relatedFor(user, [note]) : new Map()),
  )

const relatedKinds: { type: NoteRelatedEntityType; label: string }[] = [
  { label: 'person', type: 'person' },
  { label: 'activity', type: 'activity' },
  { label: 'meal', type: 'meal' },
  { label: 'report', type: 'report' },
  { label: 'check-in', type: 'check_in' },
]

/** Why the links are refused (on a reply, or naming the targets that are not live), or null. */
const checkRelated = async (
  user: string,
  related: NoteLinkInput[] | undefined,
  isReply: boolean,
): Promise<string | null> => {
  if (related !== undefined && isReply) return NOTE_REPLY_RELATED_ERROR
  if (related === undefined || related.length === 0) return null
  for (const { label, type } of relatedKinds) {
    const ids = [...new Set(related.filter((l) => l.entity_type === type).map((l) => l.entity_id))]
    if (ids.length === 0) continue
    const live = new Set((await dbListLiveLinkTargetIds(user, type, ids)).map((id) => id.toLowerCase()))
    const unknown = ids.filter((id) => !live.has(id.toLowerCase()))
    if (unknown.length > 0) return `Unknown ${label}: ${unknown.join(', ')}`
  }
  return null
}

const ONLY_PICTURES = /^\s*(!\[[^\]]*\]\([^)]*\)\s*)+$/

/** The first line of a note's text with words in it (not empty, not only pictures), cut to the excerpt length. */
export const journalExcerpt = (content: string): string =>
  (content.split('\n').find((line) => line.trim() !== '' && !ONLY_PICTURES.test(line)) ?? '')
    .trim()
    .slice(0, JOURNAL_ENTRY_EXCERPT_MAX)

/** The live notes related to any of `targetIds`, newest first, as a target's page lists them. */
export async function listJournalEntryRefs(
  user: string,
  targetType: NoteRelatedEntityType,
  targetIds: string[],
): Promise<JournalEntryRef[]> {
  if (targetIds.length === 0) return []
  const notes = await dbListNotesRelatedTo(
    user,
    targetType,
    targetIds,
    JOURNAL_ENTRY_REFS_LIMIT,
    await getUserTimezone(user),
  )
  return notes.map((n) => ({
    date: n.date ?? undefined,
    entity_type: n.entity_type,
    excerpt: journalExcerpt(n.content),
    id: n.id,
    start_time: n.start_time?.toISOString(),
    title: n.title ?? undefined,
  }))
}

export const toNoteNeighbor = (note: DbNote): NoteNeighbor => ({
  date: note.entity_type === 'day' ? note.date : undefined,
  entity_type: note.entity_type,
  excerpt: journalExcerpt(note.content),
  id: note.id,
  start_time: note.entity_type === 'day' ? undefined : note.start_time?.toISOString(),
  title: note.title || undefined,
})

/**
 * The Journal entries just before (older) and after (newer) one entry, in the Journal list's
 * order with no filters; null when `id` is not a live Journal entry.
 */
export async function getJournalNeighbors(
  user: string,
  id: string,
  tz?: string,
): Promise<NoteNeighbors | null> {
  const found = await dbGetNoteNeighbors(user, id, {
    entity_types: [...NOTES_SEARCH_DEFAULT_ENTITY_TYPES],
    tz: tz ?? (await getUserTimezone(user)),
  })
  if (!found) return null
  return {
    next: found.next ? toNoteNeighbor(found.next) : undefined,
    previous: found.previous ? toNoteNeighbor(found.previous) : undefined,
  }
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
    case 'person':
      // A moment's times are supplied by the caller; a day and a person have none.
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
  const relatedError = await checkRelated(user, input.related, input.entity_type === 'note')
  if (relatedError) return invalid(relatedError)
  const hasRelated = input.related !== undefined && input.related.length > 0
  const extras = {
    hashtags: extractHashtags(input.content),
    tags: checked.tags,
    title: checked.title,
    ...(hasRelated ? { related: input.related } : {}),
  }

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
    return { data: await createdNoteData(user, note, hasRelated), success: true }
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
    return { data: await createdNoteData(user, note, hasRelated), success: true }
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

  if (input.entity_type === 'person' && !(await getPerson(user, input.entity_id))) {
    return { error: 'Person not found', errorCode: 'not_found', success: false }
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
  return {
    data: toNoteData(
      note,
      undefined,
      undefined,
      rootRelated(note, hasRelated ? await relatedFor(user, [note]) : new Map()),
    ),
    success: true,
  }
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

/** A merge's rewrite keeps a revision however recent the last one; an edit only every few minutes. */
const revisionPolicy = (alwaysKeep: boolean) => ({
  limit: NOTE_REVISION_LIMIT,
  min_interval_minutes: alwaysKeep ? 0 : NOTE_REVISION_MIN_INTERVAL_MINUTES,
})

/**
 * Update a comment's content, title and tags and — for a free-standing comment only — its anchor.
 * Moving one moves its whole thread with it. With `expected_updated_at` a change made elsewhere in
 * the meantime is a conflict that writes nothing. The text it replaces is kept as a revision.
 */
export async function updateNote(
  user: string,
  id: string,
  fields: UpdateNoteInput,
  options: { always_keep_revision?: boolean } = {},
): Promise<NoteResult> {
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
  const relatedError = await checkRelated(user, fields.related, existing.entity_type === 'note')
  if (relatedError) return invalid(relatedError)

  const anchor = anchorUpdate(existing, fields)
  if (typeof anchor === 'string') return invalid(anchor)

  const result = await dbUpdateNoteGuarded(
    user,
    id,
    {
      ...anchor,
      content: fields.content,
      hashtags: fields.content === undefined ? undefined : extractHashtags(fields.content),
      related: fields.related,
      tags: checked.tags,
      title: checked.title,
    },
    {
      ...(Object.keys(anchor).length > 0 ? { expected_entity_type: existing.entity_type } : {}),
      expected_updated_at:
        fields.expected_updated_at === undefined ? undefined : new Date(fields.expected_updated_at),
      revisions: revisionPolicy(options.always_keep_revision === true),
    },
  )
  if (result.status === 'not_found') return notFound()
  if (result.status === 'conflict') {
    return {
      data: await withAttachments(user, result.note),
      error: NOTE_CONFLICT_ERROR,
      errorCode: 'conflict',
      success: false,
    }
  }
  return { data: await withAttachments(user, result.note), success: true }
}

/**
 * Delete a comment, and on a thread root its replies. Without `purge` it can be restored for
 * {@link DELETED_NOTE_RETENTION_DAYS} days, unless it holds nothing to restore, which removes it
 * for good; with it, it is removed for good at once, deleted or not. `purged` says which happened.
 */
export async function deleteNoteById(
  user: string,
  id: string,
  options: { purge?: boolean } = {},
): Promise<{ success: boolean; deleted: boolean; purged: boolean }> {
  if (!UUID_RE.test(id)) return { deleted: false, purged: false, success: false }
  if (options.purge) {
    const deleted = await dbDeleteNote(user, id)
    return { deleted, purged: deleted, success: deleted }
  }
  if (await dbDeleteBlankNote(user, id)) return { deleted: true, purged: true, success: true }
  const deleted = await dbSoftDeleteNote(user, id)
  return { deleted, purged: false, success: deleted }
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

/** One live comment by id: a thread root with its replies (and an entry's attachments), or a reply on its own. */
export async function getNoteForUser(user: string, id: string): Promise<NoteResult> {
  if (!UUID_RE.test(id)) return notFound()
  const note = await dbGetNoteById(user, id)
  if (!note) return notFound()
  if (note.entity_type === 'note') return { data: toNoteData(note), success: true }
  const [data] = await withReplies(user, [note])
  return { data, success: true }
}

/** What can still be restored, newest deletion first, each with `deleted_at` and `purge_at`. */
export async function listDeletedNotes(user: string): Promise<NoteData[]> {
  const deleted = await dbGetDeletedNotes(user)
  const attachments = await attachmentsFor(
    user,
    deleted.map(({ note }) => note),
  )
  return deleted.map(({ note, replies }) =>
    toNoteData(note, note.entity_type === 'note' ? undefined : replies, entryAttachments(note, attachments)),
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
  if (tags === null) return searchInvalid(NOTES_SEARCH_TAGS_ERROR)
  const entityTypes = parseNotesSearchEntityTypes(input.entity_types)
  const unknownType = entityTypes.find((type) => !(notesSearchRootTypes as readonly string[]).includes(type))
  if (unknownType !== undefined) return searchInvalid(notesSearchEntityTypeError(unknownType))
  for (const date of [input.from, input.to, input.on_this_day]) {
    if (date !== undefined && !isCalendarDate(date)) return searchInvalid(`Not a date (YYYY-MM-DD): ${date}`)
  }
  if (input.from !== undefined && input.to !== undefined && input.from > input.to) {
    return searchInvalid('to must not precede from')
  }
  if ((input.related_type === undefined) !== (input.related_id === undefined)) {
    return searchInvalid(NOTES_SEARCH_RELATED_PAIR_ERROR)
  }
  if (input.related_id !== undefined && !UUID_RE.test(input.related_id)) {
    return searchInvalid(`Not a UUID: ${input.related_id}`)
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
    related:
      input.related_type === undefined || input.related_id === undefined
        ? undefined
        : { entity_id: input.related_id, entity_type: input.related_type },
    tags,
    text: input.q === undefined ? undefined : splitSearchText(input.q),
    needs_text: input.needs_text,
    to: input.to,
    tz: input.tz ?? (await getUserTimezone(user)),
  })
  return {
    data: await withReplies(user, page.notes),
    next_cursor: page.next_cursor ? encodeNotesCursor(page.next_cursor) : null,
    success: true,
    total: page.total,
  }
}

/**
 * All comments on an entity, each with its own thread nested under `replies`. A deleted person has
 * none, as an unknown entity has none; restoring the person brings them back.
 */
export async function getNotesForEntity(
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<NoteData[]> {
  if (entityType === 'person' && (!UUID_RE.test(entityId) || !(await getPerson(user, entityId)))) return []
  const notes = await dbGetNotesForEntity(user, entityType, entityId)
  return withReplies(user, notes)
}

/**
 * The window's end is exclusive for its dates: a window ending exactly at a local midnight covers
 * the day before it, not the day it opens.
 */
const lastInstantBefore = (from: Date, to: Date): Date =>
  to.getTime() > from.getTime() ? new Date(to.getTime() - 1) : to

/**
 * Every comment anchored in [from, to] — thread roots only, each with its
 * replies nested — and the `day` entries on the window's local dates in `tz`
 * (default the user's zone). This is what the Timeline's comment track reads.
 */
export async function getNotesInRange(
  user: string,
  from: Date,
  to: Date,
  tz?: string,
  options: { needs_text?: boolean } = {},
): Promise<NoteData[]> {
  const zone = tz ?? (await getUserTimezone(user))
  const roots = await dbGetNotesForTimeRange(
    user,
    from,
    to,
    { from: localDate(from, zone), to: localDate(lastInstantBefore(from, to), zone) },
    options.needs_text ? { needs_text: true } : {},
  )
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

export type NoteTagsListResult =
  | { success: true; data: NoteTagSummary[] }
  | { success: false; error: string; errorCode: 'invalid' }

/** The tags on the roots of `entity_types` (default: the free-standing entries), most used first. */
export async function listNoteTagsForUser(
  user: string,
  input: { entity_types?: string; tz?: string },
): Promise<NoteTagsListResult> {
  const entityTypes = parseNotesSearchEntityTypes(input.entity_types)
  const unknownType = entityTypes.find((type) => !(notesSearchRootTypes as readonly string[]).includes(type))
  if (unknownType !== undefined) {
    return {
      error: `Not a comment root type: ${unknownType} (one of ${notesSearchRootTypes.join(', ')})`,
      errorCode: 'invalid',
      success: false,
    }
  }
  const tags = await dbListNoteTags(user, {
    entity_types: entityTypes,
    tz: input.tz ?? (await getUserTimezone(user)),
  })
  return {
    data: tags.map((tag) => ({ count: tag.count, last_used: tag.last_used.toISOString(), tag: tag.tag })),
    success: true,
  }
}

/**
 * A note's explicit tags and text with every tag in `from` made `into`: the tags are replaced
 * (deduplicated, order kept) and each `#from` hashtag rewritten to `#into`. Null when nothing changes.
 * A rewritten text comes back in NFC, the form the hashtags are found in.
 */
export const mergeTagsInNote = (
  note: { content: string; tags: string[] },
  from: readonly string[],
  into: string,
): { content: string; tags: string[] } | null => {
  const tags = [...new Set(note.tags.map((tag) => (from.includes(tag) ? into : tag)))]
  const tagsChanged = tags.length !== note.tags.length || tags.some((tag, i) => tag !== note.tags[i])
  const normalized = note.content.normalize('NFC')
  const matches = findHashtags(normalized).filter((match) => from.includes(match.tag))
  const content = matches.reduceRight(
    (text, match) =>
      `${text.slice(0, match.index)}#${into}${text.slice(match.index + 1 + match.text.length)}`,
    normalized,
  )
  if (!tagsChanged && matches.length === 0) return null
  return { content: matches.length === 0 ? note.content : content, tags }
}

export type MergeNoteTagsResult =
  | { success: true; data: { changed: number; skipped: number } }
  | { success: false; error: string; errorCode: 'invalid' }

type MergeOutcome = 'changed' | 'skipped' | 'unchanged'

/**
 * Rewrite one note for a tag merge, refusing it when it was edited since it was read. On such a
 * conflict it is read again and merged once more; a second conflict, or a note gone meanwhile,
 * leaves it `skipped`.
 */
const mergeTagsIntoNote = async (
  user: string,
  note: DbNote,
  from: readonly string[],
  into: string,
  retry: boolean,
): Promise<MergeOutcome> => {
  const merged = mergeTagsInNote({ content: note.content, tags: note.tags ?? [] }, from, into)
  if (merged === null) return 'unchanged'
  const result = await updateNote(
    user,
    note.id,
    {
      content: merged.content === note.content ? undefined : merged.content,
      expected_updated_at: note.updated_at.toISOString(),
      tags: merged.tags,
    },
    { always_keep_revision: true },
  )
  if (result.success) return 'changed'
  if (result.errorCode !== 'conflict') return 'unchanged'
  if (!retry) return 'skipped'
  const current = await dbGetNoteById(user, note.id)
  return current === null ? 'skipped' : mergeTagsIntoNote(user, current, from, into, false)
}

/** Whether a tag merge would rewrite the note: a synced one is left to its source. */
const mergeWouldChange = (note: DbNote, from: readonly string[], into: string): boolean =>
  !note.source && mergeTagsInNote({ content: note.content, tags: note.tags ?? [] }, from, into) !== null

/**
 * Merge tags across every live note: each one carrying a tag in `from` gets `into` instead, through
 * {@link updateNote}, so its hashtags are recomputed and a rewritten text keeps a revision. A note
 * edited while the merge runs is not overwritten (see {@link mergeTagsIntoNote}); `skipped` counts
 * those left alone. With `dry_run` it only counts the notes it would change.
 */
export async function mergeNoteTags(
  user: string,
  input: { from: string[]; into: string; dry_run?: boolean },
): Promise<MergeNoteTagsResult> {
  const from = normalizeNoteTags(input.from)
  const [into] = normalizeNoteTags([input.into]) ?? []
  if (from === null || into === undefined) {
    return {
      error: 'Not a valid tag (letters, digits and _, not only digits)',
      errorCode: 'invalid',
      success: false,
    }
  }
  if (from.includes(into)) return { error: NOTE_TAGS_MERGE_INTO_ERROR, errorCode: 'invalid', success: false }

  const notes = await dbGetNotesWithAnyTag(user, from)
  if (input.dry_run) {
    return {
      data: { changed: notes.filter((note) => mergeWouldChange(note, from, into)).length, skipped: 0 },
      success: true,
    }
  }
  let changed = 0
  let skipped = 0
  for (const note of notes) {
    const outcome = await mergeTagsIntoNote(user, note, from, into, true)
    if (outcome === 'changed') changed++
    if (outcome === 'skipped') skipped++
  }
  return { data: { changed, skipped }, success: true }
}
