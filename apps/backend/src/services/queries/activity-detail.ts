/**
 * Activity detail enrichment — for the single-activity detail endpoint.
 *
 * Computes HR zone seconds, average HRV, and the generic summary metrics
 * (distance, avg pace/cadence/power, body battery before/after, etc.) by
 * fetching the relevant time-series for the activity's time window.
 */

import type { ActivitySummaryMetrics, HrZoneSecs } from '@aurboda/api-spec'

import { getDistinctMetrics, getLocations, getTimeSeries, getTimeSeriesMultiMetric } from '../../db/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../settings.ts'
import {
  computeActivitySummaryMetrics,
  SUMMARY_METRICS,
  type SummaryMetricSeries,
} from './activity-summary-metrics.ts'

/** Sentinel used to opt into "every metric with data in the activity range". */
export const ALL_METRICS_SENTINEL = 'all'

/**
 * Parse the `metrics` query/MCP parameter to a list of metric names.
 *
 * - `undefined` / empty → return undefined (caller should skip time-series)
 * - `'all'` → return undefined here; resolveMetrics() will discover them
 * - comma-separated → split and trim
 */
export const parseMetricsParam = (raw: string | undefined): string[] | undefined => {
  if (!raw) return undefined
  if (raw === ALL_METRICS_SENTINEL) return [ALL_METRICS_SENTINEL]
  const list = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  return list.length > 0 ? list : undefined
}

export interface ActivityDetailMetrics extends ActivitySummaryMetrics {
  hr_zone_secs?: HrZoneSecs
  avg_hrv?: number
}

/**
 * Compute hr_zone_secs, avg_hrv, and the generic summary metrics for an
 * activity's time range. Pulls all required time-series in parallel.
 */
export const computeActivityDetailMetrics = async (
  user: string,
  activity: { start_time: Date; end_time?: Date; data?: Record<string, unknown> },
): Promise<ActivityDetailMetrics> => {
  const end = activity.end_time
  if (!end) return {}

  const [{ zones: hrZones }, summarySeriesByMetric, hrvData] = await Promise.all([
    getEffectiveHrZones(user),
    getTimeSeriesMultiMetric(user, [...SUMMARY_METRICS], activity.start_time, end),
    getTimeSeries(user, 'hrv_rmssd', activity.start_time, end),
  ])

  const summarySeries = summarySeriesByMetric as SummaryMetricSeries
  const summary = computeActivitySummaryMetrics(activity, summarySeries)

  const hrData = summarySeries.heart_rate ?? []
  const hr_zone_secs = hrData.length > 0 ? computeHrZoneSecs(hrData, hrZones) : undefined
  const avg_hrv =
    hrvData.length > 0 ? Math.round(hrvData.reduce((sum, [, v]) => sum + v, 0) / hrvData.length) : undefined

  return { ...summary, avg_hrv, hr_zone_secs }
}

export interface ActivityFullDetailOptions {
  /** Optional list of metric names to include time-series for. Empty array = none. */
  metrics?: string[]
  /** Include GPS trace if locations are available in the activity range. */
  includeGps?: boolean
}

export interface ActivityFullDetail {
  gps?: Array<{ time: string; lat: number; lon: number }>
  metric_series?: Array<{ metric: string; unit: string; count: number; data: Array<[string, number]> }>
}

/**
 * Fetch deep-dive detail for an activity: GPS trace + per-metric time-series.
 *
 * Source-agnostic: works for any activity that has time-series and/or GPS
 * locations populated within its time range, regardless of which integration
 * produced them (Garmin, Strava, FIT upload, manual).
 */
export const getActivityFullDetail = async (
  user: string,
  activity: { start_time: Date; end_time?: Date },
  options: ActivityFullDetailOptions,
): Promise<ActivityFullDetail> => {
  const end = activity.end_time
  if (!end) return {}
  const { includeGps = true, metrics } = options

  const result: ActivityFullDetail = {}

  // GPS trace from any source covering this activity time range.
  if (includeGps) {
    const { locations } = await getLocations(user, activity.start_time, end)
    if (locations.length > 0) {
      result.gps = locations.map((l) => ({
        lat: l.coordinates[1],
        lon: l.coordinates[0],
        time: l.time.toISOString(),
      }))
    }
  }

  // Time-series — when no metrics requested, omit the series array entirely.
  if (metrics && metrics.length > 0) {
    const resolvedMetrics =
      metrics.length === 1 && metrics[0] === ALL_METRICS_SENTINEL
        ? await getDistinctMetrics(user, activity.start_time, end)
        : metrics
    const { metricUnits } = await import('@aurboda/api-spec')
    const series = await Promise.all(
      resolvedMetrics.map(async (metric) => ({
        data: (await getTimeSeries(user, metric, activity.start_time, end)).map(
          ([time, value]) => [time.toISOString(), value] as [string, number],
        ),
        metric,
        unit: (metricUnits as Record<string, string>)[metric] ?? '',
      })),
    )
    result.metric_series = series.map((s) => ({ ...s, count: s.data.length }))
  }

  return result
}
