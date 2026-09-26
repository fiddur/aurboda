import type {
  ActivityNeighbors,
  ActivityNeighborsQuery,
  ActivityNeighborsResponse,
  ActivitySessions,
  ActivitySessionsQuery,
  ActivitySessionsResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchActivitySessions = async (
  activityType: string,
  query: ActivitySessionsQuery = {},
): Promise<ActivitySessions> => {
  const response = await axios.get<ActivitySessionsResponse>(
    `${API_URL}/activity-types/${encodeURIComponent(activityType)}/sessions`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: query },
  )
  return response.data.data ?? { activity_type: activityType, sessions: [] }
}

export const fetchActivityNeighbors = async (
  id: string,
  query: ActivityNeighborsQuery = {},
): Promise<ActivityNeighbors> => {
  const response = await axios.get<ActivityNeighborsResponse>(
    `${API_URL}/activities/${encodeURIComponent(id)}/neighbors`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: query },
  )
  return response.data.data ?? { activity_type: '' }
}
