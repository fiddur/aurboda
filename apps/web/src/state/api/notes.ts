import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export interface NoteData {
  id: string
  entity_type: string
  entity_id: string
  content: string
  created_at: string
  updated_at: string
}

export const fetchNotes = async (entityType: string, entityId: string): Promise<NoteData[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/notes`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { entity_id: entityId, entity_type: entityType },
  })

  return response.data.data ?? []
}

export const addNote = async (entityType: string, entityId: string, content: string): Promise<NoteData> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/notes`,
    { content, entity_id: entityId, entity_type: entityType },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data
}

export const updateNote = async (id: string, content: string): Promise<NoteData> => {
  const { token } = auth.value
  const response = await axios.patch(
    `${API_URL}/notes/${id}`,
    { content },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data
}

export const deleteNote = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/notes/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}
