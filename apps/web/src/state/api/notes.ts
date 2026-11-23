import type {
  AddNoteBody,
  AddNoteTemplateBody,
  BaseResponse,
  DismissNoteLinkSuggestionBody,
  EntityType,
  MergeNoteTagsResponse,
  Note,
  NoteAttachment,
  NoteAttachmentResponse,
  NoteLinkSuggestion,
  NoteLinkSuggestionsResponse,
  NoteNeighbors,
  NoteNeighborsResponse,
  NoteResponse,
  NoteRevision,
  NoteRevisionsResponse,
  NotesResponse,
  NoteTagSummary,
  NoteTagsListResponse,
  NotesSearchResponse,
  NoteTemplate,
  NoteTemplateResponse,
  NoteTemplatesResponse,
  UpdateNoteBody,
  UpdateNoteTemplateBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import {
  conflictFromError,
  type EntrySaveResult,
  type JournalQuery,
  journalSearchParams,
} from './journal-params'

export * from './journal-params'

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

export const fetchComments = async (entityType: EntityType, entityId: string): Promise<Note[]> => {
  const response = await axios.get<NotesResponse>(`${API_URL}/notes`, {
    headers: authHeaders(),
    params: { entity_id: entityId, entity_type: entityType },
  })

  return response.data.data ?? []
}

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

export const searchJournal = async (query: JournalQuery): Promise<NotesSearchResponse> => {
  const response = await axios.get<NotesSearchResponse>(`${API_URL}/notes/search`, {
    headers: authHeaders(),
    params: journalSearchParams(query),
  })
  return response.data
}

export const fetchNote = async (id: string): Promise<Note> => {
  const response = await axios.get<NoteResponse>(`${API_URL}/notes/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
  })
  return requireNote(response.data.data)
}

/** The entries just before (older, `previous`) and after (newer, `next`) one, in the Journal's order. */
export const fetchJournalNeighbors = async (id: string, tz?: string): Promise<NoteNeighbors> => {
  const response = await axios.get<NoteNeighborsResponse>(
    `${API_URL}/notes/${encodeURIComponent(id)}/neighbors`,
    {
      headers: authHeaders(),
      params: tz ? { tz } : {},
    },
  )
  return response.data.data ?? {}
}

/** The links suggested for a journal entry: people named in it, the night's sleep, the day's activities. */
export const fetchNoteLinkSuggestions = async (id: string): Promise<NoteLinkSuggestion[]> => {
  const response = await axios.get<NoteLinkSuggestionsResponse>(
    `${API_URL}/notes/${encodeURIComponent(id)}/link-suggestions`,
    { headers: authHeaders() },
  )
  return response.data.data ?? []
}

/** Stop suggesting a person or an activity for the entry. */
export const dismissNoteLinkSuggestion = async (
  id: string,
  body: DismissNoteLinkSuggestionBody,
): Promise<void> => {
  await axios.post<BaseResponse>(
    `${API_URL}/notes/${encodeURIComponent(id)}/link-suggestions/dismissals`,
    body,
    { headers: authHeaders() },
  )
}

/** The tags on journal entries (or, with `entityTypes`, those comment roots too), most used first. */
export const fetchNoteTags = async (entityTypes?: readonly EntityType[]): Promise<NoteTagSummary[]> => {
  const response = await axios.get<NoteTagsListResponse>(`${API_URL}/notes/tags`, {
    headers: authHeaders(),
    params: entityTypes && entityTypes.length > 0 ? { entity_types: entityTypes.join(',') } : {},
  })
  return response.data.data ?? []
}

/** Every note carrying a tag in `from` gets `into` instead; answers how many notes changed. */
export const mergeNoteTags = async (from: readonly string[], into: string): Promise<number> => {
  const response = await axios.post<MergeNoteTagsResponse>(
    `${API_URL}/notes/tags/merge`,
    { from, into },
    { headers: authHeaders() },
  )
  return response.data.data?.changed ?? 0
}

export const createJournalEntry = async (body: AddNoteBody): Promise<Note> => {
  const response = await axios.post<NoteResponse>(`${API_URL}/notes`, body, { headers: authHeaders() })
  return requireNote(response.data.data)
}

export const updateJournalEntry = async (id: string, body: UpdateNoteBody): Promise<EntrySaveResult> => {
  try {
    const response = await axios.patch<NoteResponse>(`${API_URL}/notes/${encodeURIComponent(id)}`, body, {
      headers: authHeaders(),
    })
    return { kind: 'saved', note: requireNote(response.data.data) }
  } catch (error) {
    const theirs = conflictFromError(error)
    if (theirs) return { kind: 'conflict', note: theirs }
    throw error
  }
}

/** Recoverable for DELETED_NOTE_RETENTION_DAYS unless `purge`, which removes it for good at once. */
export const deleteJournalEntry = async (id: string, options: { purge?: boolean } = {}): Promise<void> => {
  await axios.delete(`${API_URL}/notes/${encodeURIComponent(id)}`, {
    headers: authHeaders(),
    params: options.purge ? { purge: 'true' } : {},
  })
}

export const restoreJournalEntry = async (id: string): Promise<Note> => {
  const response = await axios.post<NoteResponse>(
    `${API_URL}/notes/${encodeURIComponent(id)}/restore`,
    {},
    { headers: authHeaders() },
  )
  return requireNote(response.data.data)
}

export const fetchDeletedEntries = async (): Promise<Note[]> => {
  const response = await axios.get<NotesResponse>(`${API_URL}/notes/deleted`, { headers: authHeaders() })
  return response.data.data ?? []
}

export const fetchNoteRevisions = async (id: string): Promise<NoteRevision[]> => {
  const response = await axios.get<NoteRevisionsResponse>(
    `${API_URL}/notes/${encodeURIComponent(id)}/revisions`,
    { headers: authHeaders() },
  )
  return response.data.data ?? []
}

const attachmentsUrl = (noteId: string) => `${API_URL}/notes/${encodeURIComponent(noteId)}/attachments`

export const attachmentContentUrl = (noteId: string, attachmentId: string, maxEdge?: '400' | '2000') =>
  `${attachmentsUrl(noteId)}/${encodeURIComponent(attachmentId)}${maxEdge ? `?max_edge=${maxEdge}` : ''}`

/** One file per request: the server numbers attachments in arrival order, which is page order. */
export const uploadNoteAttachment = async (
  noteId: string,
  file: Blob,
  name?: string,
): Promise<NoteAttachment> => {
  const formData = new FormData()
  formData.append('file', file, name ?? (file instanceof File ? file.name : 'recording'))
  const response = await axios.post<NoteAttachmentResponse>(attachmentsUrl(noteId), formData, {
    headers: authHeaders(),
  })
  if (!response.data.data) throw new Error(response.data.error ?? 'Could not add the file')
  return response.data.data
}

/** An `<img src>` cannot send the token, so the bytes are fetched here and shown through an object URL. */
export const fetchNoteAttachmentBlob = async (
  noteId: string,
  attachmentId: string,
  maxEdge?: '400' | '2000',
): Promise<Blob> => {
  const response = await axios.get<Blob>(attachmentContentUrl(noteId, attachmentId, maxEdge), {
    headers: authHeaders(),
    responseType: 'blob',
  })
  return response.data
}

export const deleteNoteAttachment = async (noteId: string, attachmentId: string): Promise<void> => {
  await axios.delete(`${attachmentsUrl(noteId)}/${encodeURIComponent(attachmentId)}`, {
    headers: authHeaders(),
  })
}

export const restoreNoteAttachment = async (
  noteId: string,
  attachmentId: string,
): Promise<NoteAttachment> => {
  const response = await axios.post<NoteAttachmentResponse>(
    `${attachmentsUrl(noteId)}/${encodeURIComponent(attachmentId)}/restore`,
    {},
    { headers: authHeaders() },
  )
  if (!response.data.data) throw new Error(response.data.error ?? 'Could not bring the file back')
  return response.data.data
}

export const fetchNoteTemplates = async (options: { deleted?: boolean } = {}): Promise<NoteTemplate[]> => {
  const response = await axios.get<NoteTemplatesResponse>(`${API_URL}/note-templates`, {
    headers: authHeaders(),
    params: options.deleted ? { deleted: 'true' } : {},
  })
  return response.data.data ?? []
}

const requireTemplate = (template: NoteTemplate | undefined): NoteTemplate => {
  if (!template) throw new Error('Template request returned no data')
  return template
}

export const addNoteTemplate = async (body: AddNoteTemplateBody): Promise<NoteTemplate> => {
  const response = await axios.post<NoteTemplateResponse>(`${API_URL}/note-templates`, body, {
    headers: authHeaders(),
  })
  return requireTemplate(response.data.data)
}

export const updateNoteTemplate = async (id: string, body: UpdateNoteTemplateBody): Promise<NoteTemplate> => {
  const response = await axios.patch<NoteTemplateResponse>(
    `${API_URL}/note-templates/${encodeURIComponent(id)}`,
    body,
    { headers: authHeaders() },
  )
  return requireTemplate(response.data.data)
}

export const deleteNoteTemplate = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/note-templates/${encodeURIComponent(id)}`, { headers: authHeaders() })
}

export const restoreNoteTemplate = async (id: string): Promise<NoteTemplate> => {
  const response = await axios.post<NoteTemplateResponse>(
    `${API_URL}/note-templates/${encodeURIComponent(id)}/restore`,
    {},
    { headers: authHeaders() },
  )
  return requireTemplate(response.data.data)
}
