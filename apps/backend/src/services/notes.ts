/**
 * Notes service — CRUD operations for entity notes.
 */

import type { EntityType as ApiEntityType } from '@aurboda/api-spec'
import {
  deleteNote as dbDeleteNote,
  getNotesForEntity as dbGetNotesForEntity,
  insertNote as dbInsertNote,
  updateNote as dbUpdateNote,
  type EntityType,
} from '../db'

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
    created_at: string
    updated_at: string
  }
  error?: string
}

export async function addNote(user: string, input: AddNoteInput): Promise<NoteResult> {
  const note = await dbInsertNote(user, input.entity_type, input.entity_id, input.content)
  return {
    data: {
      content: note.content,
      created_at: note.created_at.toISOString(),
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
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
      entity_id: note.entity_id,
      entity_type: note.entity_type,
      id: note.id,
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
    entity_id: n.entity_id,
    entity_type: n.entity_type,
    id: n.id,
    updated_at: n.updated_at.toISOString(),
  }))
}
