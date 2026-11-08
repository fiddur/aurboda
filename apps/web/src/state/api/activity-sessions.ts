import type {
  ActivityFieldValues,
  ActivityFieldValuesResponse,
  ActivityItemHistory,
  ActivityItemHistoryResponse,
  ActivityNeighbors,
  ActivityNeighborsQuery,
  ActivityNeighborsResponse,
  ActivityRecords,
  ActivityRecordsQuery,
  ActivityRecordsResponse,
  ActivitySessions,
  ActivitySessionsQuery,
  ActivitySessionsResponse,
  ActivityTypeSummary,
  ActivityTypeSummaryQuery,
  ActivityTypeSummaryResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'
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

export const fetchActivityRecords = async (
  activityType: string,
  query: ActivityRecordsQuery = {},
): Promise<ActivityRecords> => {
  const response = await axios.get<ActivityRecordsResponse>(
    `${API_URL}/activity-types/${encodeURIComponent(activityType)}/records`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: query },
  )
  return response.data.data ?? { activity_type: activityType, records: [] }
}

export const fetchActivityTypeSummary = async (
  activityType: string,
  query: ActivityTypeSummaryQuery,
): Promise<ActivityTypeSummary | null> => {
  const response = await axios.get<ActivityTypeSummaryResponse>(
    `${API_URL}/activity-types/${encodeURIComponent(activityType)}/summary`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: query },
  )
  return response.data.data ?? null
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

export const fetchActivityItemHistory = async (id: string, field: string): Promise<ActivityItemHistory> => {
  const response = await axios.get<ActivityItemHistoryResponse>(
    `${API_URL}/activities/${encodeURIComponent(id)}/item-history`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: { field } },
  )
  return (
    response.data.data ?? {
      activity_id: id,
      field,
      groups: [],
      totals: {},
      trend_half_life_days: MEASURE_HALF_LIFE_DEFAULT,
    }
  )
}

export const fetchActivityFieldValues = async (
  activityType: string,
  field: string,
): Promise<ActivityFieldValues> => {
  const response = await axios.get<ActivityFieldValuesResponse>(
    `${API_URL}/activity-types/${encodeURIComponent(activityType)}/field-values`,
    { headers: { Authorization: `Bearer ${auth.value.token}` }, params: { field } },
  )
  return response.data.data ?? { activity_type: activityType, field, values: [] }
}
