import type {
  StrengthScore,
  StrengthScoreHistory,
  StrengthScoreHistoryQuery,
  StrengthScoreHistoryResponse,
  StrengthScoreResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const strengthScoreUrl = (activityType: string): string =>
  `${API_URL}/activity-types/${encodeURIComponent(activityType)}/strength-score`

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchStrengthScore = async (
  activityType: string,
  field: string,
  at?: string,
): Promise<StrengthScore | null> => {
  const response = await axios.get<StrengthScoreResponse>(strengthScoreUrl(activityType), {
    headers: authHeaders(),
    params: at === undefined ? { field } : { at, field },
  })
  return response.data.data ?? null
}

export const fetchStrengthScoreHistory = async (
  activityType: string,
  query: StrengthScoreHistoryQuery,
): Promise<StrengthScoreHistory | null> => {
  const response = await axios.get<StrengthScoreHistoryResponse>(
    `${strengthScoreUrl(activityType)}/history`,
    {
      headers: authHeaders(),
      params: query,
    },
  )
  return response.data.data ?? null
}
