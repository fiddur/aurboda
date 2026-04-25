import type {
  ActivityImpactData,
  ActivityImpactQuery,
  ActivityImpactResponse,
  ActivityImpactType,
  BaselineData,
  BaselineResponse,
  HrvActivitiesData,
  HrvActivitiesResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch HRV/HR baseline (7-day and 30-day averages with trends)
export const fetchBaseline = async (referenceDate?: string): Promise<BaselineData> => {
  const { token } = auth.value
  const params = referenceDate ? { reference_date: referenceDate } : {}
  const response = await axios.get<BaselineResponse>(`${API_URL}/correlations/baseline`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data.data!
}

// Fetch HRV-activities correlations
export const fetchHrvActivitiesCorrelation = async (periodDays?: number): Promise<HrvActivitiesData> => {
  const { token } = auth.value
  const params = periodDays ? { period_days: String(periodDays) } : {}
  const response = await axios.get<HrvActivitiesResponse>(`${API_URL}/correlations/hrv-activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data.data!
}

// Fetch activity impact timeline (HRV/HR before/during/after an activity)
export const fetchActivityImpact = async (
  activity: string,
  activityType: ActivityImpactType,
  periodDays?: number,
  windowMinutes?: number,
): Promise<ActivityImpactData> => {
  const { token } = auth.value
  const params: ActivityImpactQuery = {
    activity_type: activityType,
    ...(periodDays && { period_days: String(periodDays) }),
    ...(windowMinutes && { window_minutes: String(windowMinutes) }),
  }
  const response = await axios.get<ActivityImpactResponse>(
    `${API_URL}/correlations/activity-impact/${encodeURIComponent(activity)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params,
    },
  )

  return response.data.data!
}
