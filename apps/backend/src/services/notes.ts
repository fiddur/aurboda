/**
 * Notes service — CRUD operations for comments.
 *
 * A comment is a row in `notes` and comes in three shapes:
 *  - **on an entity** — `entity_type` is one of the real entities (activity,
 *    productivity, metric, report, meal) and `entity_id` points at it. Its
 *    `start_time`/`end_time` are a cache of the parent's timing, rewritten by
 *    `syncNoteTimesForEntity` whenever the parent moves.
 *  - **on a moment** — `entity_type = 'time'`, no `entity_id`; `start_time`
 *    (required) and `end_time` (optional) are user input and editable.
 *  - **a reply** — `entity_type = 'note'`, `entity_id` is the root comment's id.
 *    It inherits the root's times so the whole thread sits at one point in time.
 *
 * Threads are exactly one level deep: replying to a reply re-anchors to its root.
 */

import {
  deleteNote as dbDeleteNote,
  getNoteById as dbGetNoteById,
  getNoteRoot as dbGetNoteRoot,
  getNotesForEntity as dbGetNotesForEntity,
  getNotesForTimeRange as dbGetNotesForTimeRange,
  getRepliesForRootIds as dbGetRepliesForRootIds,
  insertNote as dbInsertNote,
  updateNoteFields as dbUpdateNoteFields,
  updateNoteTimesForEntity as dbUpdateNoteTimesForEntity,
  getActivityById,
  getMealById,
  getProductivityById,
  getReportById,
  type EntityType,
  type Note as DbNote,
} from '../db/index.ts'

export interface AddNoteInput {
  entity_type: EntityType
  entity_id?: string | null
  content: string
  /** Only for `entity_type: 'time'`. */
  start_time?: string
  /** Only for `entity_type: 'time'`. */
  end_time?: string
}

export interface UpdateNoteInput {
  content?: string
  /** Only for `entity_type: 'time'`. */
  start_time?: string
  /** Only for `entity_type: 'time'`. */
  end_time?: string
}

export interface NoteReplyData {
  id: string
  content: string
  source?: string
  start_time?: string
  end_time?: string
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
  created_at: string
  updated_at: string
  replies?: NoteReplyData[]
}

export interface NoteResult {
  success: boolean
  data?: NoteData
  error?: string
}

const TIMES_ON_ANCHORED_NOTE = 'Times can only be set on a time-anchored comment'

const toReplyData = (note: DbNote): NoteReplyData => ({
  content: note.content,
  created_at: note.created_at.toISOString(),
  end_time: note.end_time?.toISOString(),
  id: note.id,
  source: note.source,
  start_time: note.start_time?.toISOString(),
  updated_at: note.updated_at.toISOString(),
})

const toNoteData = (note: DbNote, replies?: DbNote[]): NoteData => ({
  content: note.content,
  created_at: note.created_at.toISOString(),
  end_time: note.end_time?.toISOString(),
  entity_id: note.entity_id,
  entity_type: note.entity_type,
  id: note.id,
  replies: replies?.map(toReplyData),
  source: note.source,
  start_time: note.start_time?.toISOString(),
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

/**
 * Look up the time range of the parent entity to inherit into the note.
 * Returns undefined for metric entity types since they use a composite key,
 * and for `time` notes whose times come from the request instead.
 */
async function getEntityTimes(
  user: string,
  entityType: EntityType,
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
    case 'note': {
      // A reply sits at the same point in time as the comment it hangs off.
      const parent = await dbGetNoteById(user, entityId)
      if (!parent?.start_time) return undefined
      return { end_time: parent.end_time, start_time: parent.start_time }
    }
    case 'time':
      // Times are supplied by the caller, not inherited.
      return undefined
  }
}

export async function addNote(user: string, input: AddNoteInput): Promise<NoteResult> {
  if (input.entity_type === 'time') {
    if (input.entity_id) {
      return { error: "entity_id must be omitted when entity_type is 'time'", success: false }
    }
    if (!input.start_time) {
      return { error: "start_time is required when entity_type is 'time'", success: false }
    }
    const note = await dbInsertNote(
      user,
      'time',
      null,
      input.content,
      new Date(input.start_time),
      input.end_time ? new Date(input.end_time) : undefined,
    )
    return { data: toNoteData(note), success: true }
  }

  if (!input.entity_id) {
    return { error: "entity_id is required unless entity_type is 'time'", success: false }
  }
  if (input.start_time !== undefined || input.end_time !== undefined) {
    return { error: TIMES_ON_ANCHORED_NOTE, success: false }
  }

  if (input.entity_type === 'note') {
    // Threads are one level deep: replying to a reply re-anchors to its root.
    const root = await dbGetNoteRoot(user, input.entity_id)
    if (!root) {
      return { error: 'Comment to reply to not found', success: false }
    }
    const reply = await dbInsertNote(user, 'note', root.id, input.content, root.start_time, root.end_time)
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
  )
  return { data: toNoteData(note), success: true }
}

/**
 * Update a comment's content and — for a `time` comment only — its time anchor.
 * Moving a `time` comment moves its whole thread with it.
 */
export async function updateNote(user: string, id: string, fields: UpdateNoteInput): Promise<NoteResult> {
  const existing = await dbGetNoteById(user, id)
  if (!existing) {
    return { error: 'Note not found', success: false }
  }

  const movesInTime = fields.start_time !== undefined || fields.end_time !== undefined
  if (movesInTime && existing.entity_type !== 'time') {
    return { error: TIMES_ON_ANCHORED_NOTE, success: false }
  }

  const note = await dbUpdateNoteFields(user, id, {
    content: fields.content,
    end_time: fields.end_time === undefined ? undefined : new Date(fields.end_time),
    start_time: fields.start_time === undefined ? undefined : new Date(fields.start_time),
  })
  if (!note) {
    return { error: 'Note not found', success: false }
  }

  if (movesInTime && note.start_time) {
    await dbUpdateNoteTimesForEntity(user, 'note', note.id, note.start_time, note.end_time)
  }

  return { data: toNoteData(note), success: true }
}

export async function deleteNoteById(
  user: string,
  id: string,
): Promise<{ success: boolean; deleted: boolean }> {
  const deleted = await dbDeleteNote(user, id)
  return { deleted, success: deleted }
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

/**
 * Every comment anchored in [from, to] — thread roots only, each with its
 * replies nested. This is what the Timeline's comment track reads.
 */
export async function getNotesInRange(user: string, from: Date, to: Date): Promise<NoteData[]> {
  const roots = await dbGetNotesForTimeRange(user, from, to)
  return withReplies(user, roots)
}

/**
 * Sync the inherited time fields on all notes for an entity when the entity's timing changes.
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
