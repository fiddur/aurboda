import type { MediaPlaysQuery, MediaPlaysResponse } from '@aurboda/api-spec'

import axios from 'axios'

import type { MediaPlay } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchMediaPlays = async (start: Date, end: Date): Promise<MediaPlay[]> => {
  const { token } = auth.value
  const params: MediaPlaysQuery = { end: end.toISOString(), start: start.toISOString() }
  const response = await axios.get<MediaPlaysResponse>(`${API_URL}/media/plays`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return (response.data.data ?? []).map((play) => ({
    ...play,
    ended_at: play.ended_at ? new Date(play.ended_at) : undefined,
    started_at: new Date(play.started_at),
  }))
}
