import type {
  MediaPlay as ApiMediaPlay,
  MediaPlayResponse,
  MediaPlaysQuery,
  MediaPlaysResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { MediaPlay } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

const toMediaPlay = (play: ApiMediaPlay): MediaPlay => ({
  ...play,
  ended_at: play.ended_at ? new Date(play.ended_at) : undefined,
  started_at: new Date(play.started_at),
})

export const fetchMediaPlays = async (start: Date, end: Date): Promise<MediaPlay[]> => {
  const { token } = auth.value
  const params: MediaPlaysQuery = { end: end.toISOString(), start: start.toISOString() }
  const response = await axios.get<MediaPlaysResponse>(`${API_URL}/media/plays`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return (response.data.data ?? []).map(toMediaPlay)
}

/** One play by id, or null when there is none. */
export const fetchMediaPlay = async (id: string): Promise<MediaPlay | null> => {
  const { token } = auth.value
  try {
    const response = await axios.get<MediaPlayResponse>(`${API_URL}/media/plays/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.data.data ? toMediaPlay(response.data.data) : null
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null
    throw error
  }
}
