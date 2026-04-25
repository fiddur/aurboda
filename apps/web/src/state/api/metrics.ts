import type {
  AddMetricBody,
  AddMetricResponse,
  PeriodSummaryQuery,
  PeriodSummaryResponse,
  QueryMetricsBucketedQuery,
  QueryMetricsBucketedResponse,
  QueryMetricsQuery,
  QueryMetricsResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { browserTz } from './client'

// Fetch heart rate data for the specified date range
export const fetchHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/heart_rate`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch HRV (RMSSD) data for the specified date range
export const fetchHrv = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/hrv_rmssd`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch stress level data for the specified date range
export const fetchStress = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/stress_level`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch HRV sleep (contextual: only during sleep) for the specified date range
export const fetchHrvSleep = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/hrv_sleep`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch period summary for specified metrics
export const fetchPeriodSummary = async (
  start: Date,
  end: Date,
  metrics: string[],
): Promise<PeriodSummaryResponse> => {
  const { token } = auth.value
  const params: PeriodSummaryQuery = {
    end: end.toISOString(),
    metrics: metrics.join(','),
    start: start.toISOString(),
  }
  const response = await axios.get<PeriodSummaryResponse>(`${API_URL}/period-summary`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data
}

// Fetch multiple metrics in time buckets (e.g. 1d for daily Oura scores)
export const fetchBucketedMetrics = async (
  start: Date,
  end: Date,
  metrics?: string[],
  bucket: string = '1d',
  exclude?: string[],
): Promise<QueryMetricsBucketedResponse> => {
  const { token } = auth.value
  const params: QueryMetricsBucketedQuery = {
    bucket: bucket as QueryMetricsBucketedQuery['bucket'],
    end: end.toISOString(),
    start: start.toISOString(),
    tz: browserTz,
    ...(metrics && { metrics: metrics.join(',') }),
    ...(exclude && { exclude: exclude.join(',') }),
  }
  const response = await axios.get<QueryMetricsBucketedResponse>(`${API_URL}/metrics/bucketed`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return response.data
}

// Fetch sleep metrics time series
export const fetchSleepScores = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/sleep_score`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch readiness scores time series
export const fetchReadinessScores = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/readiness_score`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch resting heart rate time series
export const fetchRestingHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/resting_heart_rate`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch steps time series
export const fetchSteps = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/steps`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch time series data for any metric (built-in or custom)
export const fetchMetricTimeSeries = async (
  metric: string,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

/** Metric data point with source info for linking to detail views. */
export interface MetricDataPointWithSource {
  time: Date
  value: number
  source: string
  metric: string
}

/** Fetch time series data for a metric including source (for entity linking). */
export const fetchMetricTimeSeriesWithSource = async (
  metric: string,
  start: Date,
  end: Date,
): Promise<MetricDataPointWithSource[]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((d) => ({
    metric,
    source: d.source ?? 'manual',
    time: new Date(d.time),
    value: d.value,
  }))
}

export const addMetric = async (body: AddMetricBody): Promise<AddMetricResponse> => {
  const { token } = auth.value
  const response = await axios.post<AddMetricResponse>(`${API_URL}/metrics`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

/** Delete a single metric measurement (soft delete). */
export const deleteMetricPoint = async (metric: string, time: string, source: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { source, time },
  })
}
