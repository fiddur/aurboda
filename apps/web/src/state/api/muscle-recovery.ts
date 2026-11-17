import type {
  MuscleRecovery,
  MuscleRecoveryHistory,
  MuscleRecoveryHistoryQuery,
  MuscleRecoveryHistoryResponse,
  MuscleRecoveryResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const muscleRecoveryUrl = (activityType: string): string =>
  `${API_URL}/activity-types/${encodeURIComponent(activityType)}/muscle-groups/recovery`

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchMuscleRecovery = async (
  activityType: string,
  field: string,
  at?: string,
): Promise<MuscleRecovery | null> => {
  const response = await axios.get<MuscleRecoveryResponse>(muscleRecoveryUrl(activityType), {
    headers: authHeaders(),
    params: at === undefined ? { field } : { at, field },
  })
  return response.data.data ?? null
}

export const fetchMuscleRecoveryHistory = async (
  activityType: string,
  query: MuscleRecoveryHistoryQuery,
): Promise<MuscleRecoveryHistory | null> => {
  const response = await axios.get<MuscleRecoveryHistoryResponse>(
    `${muscleRecoveryUrl(activityType)}/history`,
    {
      headers: authHeaders(),
      params: query,
    },
  )
  return response.data.data ?? null
}
