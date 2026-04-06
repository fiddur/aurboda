/**
 * Notes service — CRUD operations for entity notes.
 *
 * Notes inherit time information from their parent entity (tag, activity, productivity record)
 * so they can be queried by time range. Metric notes (composite entity_id) do not have
 * inherited times since they reference a point in time already encoded in the entity_id.
 */

import type { EntityType as ApiEntityType } from '@aurboda/api-spec'

import {
  deleteNote as dbDeleteNote,
  getNotesForEntity as dbGetNotesForEntity,
  insertNote as dbInsertNote,
  updateNote as dbUpdateNote,
  updateNoteTimesForEntity as dbUpdateNoteTimesForEntity,
  getActivityById,
  getProductivityById,
  getReportById,
  type EntityType,
} from '../db/index.ts'

export interface AddNoteInput {
  entity_type: EntityType
  entity_id: string
  content: string
}

export interface NoteResult {
  success: boolean
  data?: {
    id: string
    entity_type: ApiEntityType
    entity_id: string
    content: string
    start_time?: string
    end_time?: string
    created_at: string
    updated_at: string
  }
  error?: string
}

/**
 * Look up the time range of the parent entity to inherit into the note.
 * Returns undefined for metric entity types since they use a composite key.
 */
async function getEntityTimes(
  user: string,
  entityType: EntityType,
  entityId: string,
): Promise<{ start_time: Date; end_time?: Date } | undefined> {
  switch (entityType) {
    case 'tag': // tags are now activities — fall through
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
  }
}

export async function addNote(user: string, input: AddNoteInput): Promise<NoteResult> {
  const times = await getEntityTimes(user, input.entity_type, input.entity_id)
  const note = await dbInsertNote(
    user,
    input.entity_type,
    input.entity_id,
    input.content,
    times?.start_time,
    times?.end_time,
  )
  return {
    data: {
      content: note.content,
      created_at: note.created_at.toISOString(),
      end_time: note.end_time?.toISOString(),
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
      start_time: note.start_time?.toISOString(),
      updated_at: note.updated_at.toISOString(),
    },
    success: true,
  }
}

export async function updateNoteContent(user: string, id: string, content: string): Promise<NoteResult> {
  const note = await dbUpdateNote(user, id, content)
  if (!note) {
    return { error: 'Note not found', success: false }
  }
  return {
    data: {
      content: note.content,
      created_at: note.created_at.toISOString(),
      end_time: note.end_time?.toISOString(),
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
      start_time: note.start_time?.toISOString(),
      updated_at: note.updated_at.toISOString(),
    },
    success: true,
  }
}

export async function deleteNoteById(
  user: string,
  id: string,
): Promise<{ success: boolean; deleted: boolean }> {
  const deleted = await dbDeleteNote(user, id)
  return { deleted, success: deleted }
}

export async function getNotesForEntity(user: string, entityType: ApiEntityType, entityId: string) {
  const notes = await dbGetNotesForEntity(user, entityType as EntityType, entityId)
  return notes.map((n) => ({
    content: n.content,
    created_at: n.created_at.toISOString(),
    end_time: n.end_time?.toISOString(),
    entity_id: n.entity_id,
    entity_type: n.entity_type,
    id: n.id,
    start_time: n.start_time?.toISOString(),
    updated_at: n.updated_at.toISOString(),
  }))
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
