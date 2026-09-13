import type { EntityType, Note, NoteResponse, NotesResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

/** The API always returns the comment it wrote; a missing body is a real failure. */
const requireNote = (note: Note | undefined): Note => {
  if (!note) throw new Error('Comment request returned no data')
  return note
}

/**
 * Comments live in the `notes` table and come in three shapes — a comment on an
 * entity, a comment on a moment (`entity_type: 'time'`) and a reply
 * (`entity_type: 'note'`). Replies are never returned on their own: they come
 * back nested as `replies[]` on their thread root, oldest first.
 */

/** Every comment on one entity, each thread root with its replies nested. */
export const fetchComments = async (entityType: EntityType, entityId: string): Promise<Note[]> => {
  const response = await axios.get<NotesResponse>(`${API_URL}/notes`, {
    headers: authHeaders(),
    params: { entity_id: entityId, entity_type: entityType },
  })

  return response.data.data ?? []
}

/** Every thread root anchored in a time window, with replies nested. */
export const fetchCommentsInRange = async (from: Date, to: Date): Promise<Note[]> => {
  const response = await axios.get<NotesResponse>(`${API_URL}/notes`, {
    headers: authHeaders(),
    params: { from: from.toISOString(), to: to.toISOString() },
  })

  return response.data.data ?? []
}

/** Comment on a thing — times are inherited from the entity, never sent. */
export const addEntityComment = async (
  entityType: EntityType,
  entityId: string,
  content: string,
): Promise<Note> => {
  const response = await axios.post<NoteResponse>(
    `${API_URL}/notes`,
    { content, entity_id: entityId, entity_type: entityType },
    { headers: authHeaders() },
  )

  return requireNote(response.data.data)
}

/** Comment on a moment — `start_time` is required, `end_time` makes it a span. */
export const addTimeComment = async (content: string, startTime: Date, endTime?: Date): Promise<Note> => {
  const response = await axios.post<NoteResponse>(
    `${API_URL}/notes`,
    {
      content,
      ...(endTime ? { end_time: endTime.toISOString() } : {}),
      entity_type: 'time',
      start_time: startTime.toISOString(),
    },
    { headers: authHeaders() },
  )

  return requireNote(response.data.data)
}

/** Reply to a thread root. Threads are one level deep — always reply to the root. */
export const addReply = async (rootId: string, content: string): Promise<Note> => {
  const response = await axios.post<NoteResponse>(
    `${API_URL}/notes`,
    { content, entity_id: rootId, entity_type: 'note' },
    { headers: authHeaders() },
  )

  return requireNote(response.data.data)
}

/**
 * Times can only be changed on a `time` comment — the API answers 400 otherwise.
 * A null `end_time` clears the end, turning a span back into a point in time.
 */
export const updateComment = async (
  id: string,
  fields: { content?: string; start_time?: string; end_time?: string | null },
): Promise<Note> => {
  const response = await axios.patch<NoteResponse>(`${API_URL}/notes/${id}`, fields, {
    headers: authHeaders(),
  })

  return requireNote(response.data.data)
}

/** Deleting a thread root deletes its replies too. */
export const deleteComment = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/notes/${id}`, { headers: authHeaders() })
}
