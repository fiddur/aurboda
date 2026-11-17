import type {
  MuscleGroupHistory,
  MuscleGroupHistoryQuery,
  MuscleGroupHistoryResponse,
  MuscleGroupOverview,
  MuscleGroupsResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const muscleGroupsUrl = (activityType: string): string =>
  `${API_URL}/activity-types/${encodeURIComponent(activityType)}/muscle-groups`

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchMuscleGroups = async (
  activityType: string,
  field: string,
): Promise<MuscleGroupOverview> => {
  const response = await axios.get<MuscleGroupsResponse>(muscleGroupsUrl(activityType), {
    headers: authHeaders(),
    params: { field },
  })
  return response.data.data ?? { field, groups: [] }
}

export const fetchMuscleGroupHistory = async (
  activityType: string,
  group: string,
  query: MuscleGroupHistoryQuery,
): Promise<MuscleGroupHistory | null> => {
  const response = await axios.get<MuscleGroupHistoryResponse>(
    `${muscleGroupsUrl(activityType)}/${encodeURIComponent(group)}`,
    { headers: authHeaders(), params: query },
  )
  return response.data.data ?? null
}
