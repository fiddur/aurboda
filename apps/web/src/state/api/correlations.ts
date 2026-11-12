import type {
  ActivityImpactData,
  ActivityImpactMatch,
  ActivityImpactQuery,
  ActivityImpactResponse,
  ActivityImpactType,
  BaselineData,
  BaselineResponse,
  ContinuousCorrelationBody,
  ContinuousCorrelationData,
  ContinuousCorrelationResponse,
  CorrelationSelectorsData,
  CorrelationSelectorsResponse,
  GenericCorrelationBody,
  GenericCorrelationData,
  GenericCorrelationResponse,
  HrvActivitiesData,
  HrvActivitiesResponse,
  HrvContextMetric,
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

export const fetchHrvActivitiesCorrelation = async (
  periodDays?: number,
  contextMetric?: HrvContextMetric,
  windowMinutes?: number,
): Promise<HrvActivitiesData> => {
  const { token } = auth.value
  const params: Record<string, string> = {}
  if (periodDays) params.period_days = String(periodDays)
  if (contextMetric) params.context_metric = contextMetric
  if (windowMinutes) params.window_minutes = String(windowMinutes)
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
  match?: ActivityImpactMatch,
): Promise<ActivityImpactData> => {
  const { token } = auth.value
  const params: ActivityImpactQuery = {
    activity_type: activityType,
    ...(match && { match }),
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

/** The impact of one exact activity over a fixed period (`start` inclusive, `end` exclusive), as an article block draws it. */
export const fetchActivityImpactOver = async ({
  activity,
  activityType,
  end,
  start,
  windowMinutes,
}: {
  activity: string
  activityType: ActivityImpactType
  start: string
  end: string
  windowMinutes: number
}): Promise<ActivityImpactData> => {
  const { token } = auth.value
  const params: ActivityImpactQuery = {
    activity_type: activityType,
    end,
    match: 'exact',
    start,
    window_minutes: String(windowMinutes),
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

// Fetch the data dimensions available to correlate (populates explore pickers)
export const fetchCorrelationSelectors = async (): Promise<CorrelationSelectorsData> => {
  const { token } = auth.value
  const response = await axios.get<CorrelationSelectorsResponse>(`${API_URL}/correlations/selectors`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}

// Run a generic correlation (supports the event-outcome exposure mode)
export const fetchGenericCorrelation = async (
  body: GenericCorrelationBody,
): Promise<GenericCorrelationData> => {
  const { token } = auth.value
  const response = await axios.post<GenericCorrelationResponse>(`${API_URL}/correlations/generic`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}

// Run a continuous daily correlation (Pearson/Spearman with optional lag)
export const fetchContinuousCorrelation = async (
  body: ContinuousCorrelationBody,
): Promise<ContinuousCorrelationData> => {
  const { token } = auth.value
  const response = await axios.post<ContinuousCorrelationResponse>(
    `${API_URL}/correlations/continuous`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data!
}
