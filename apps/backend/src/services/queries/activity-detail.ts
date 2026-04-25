/**
 * Activity detail enrichment — computes the per-activity fields that aren't
 * stored on the activities row (HR-zone seconds, average HRV, generic summary
 * metrics) and assembles the deep-dive payload (GPS trace + per-metric
 * time-series) for the full-detail endpoint and MCP tool.
 */

import {
  type ActivityComputedMetrics,
  type ActivityFullDetail,
  ALL_METRICS_SENTINEL,
  getMetricUnit,
} from '@aurboda/api-spec'

import type { Activity as ActivityRow } from '../../db/types.ts'

import {
  getDistinctMetrics,
  getLocations,
  getOverlappingActivities,
  getTimeSeries,
  getTimeSeriesMultiMetric,
} from '../../db/index.ts'
import { computeHrZoneSecs, getEffectiveHrZones } from '../settings.ts'
import { computeActivitySummaryMetrics, SUMMARY_METRICS } from './activity-summary-metrics.ts'

/**
 * Parse the `metrics` query/MCP parameter into a list of metric names.
 *
 * - `undefined` / empty → `undefined` (caller skips time-series fetch)
 * - the `'all'` sentinel → `[ALL_METRICS_SENTINEL]` (resolved later by db lookup)
 * - comma-separated → trimmed list
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

/**
 * Compute hr_zone_secs, avg_hrv, and the generic summary metrics for an
 * activity's time range. Pulls all required time-series in parallel.
 */
export const computeActivityDetailMetrics = async (
  user: string,
  activity: { start_time: Date; end_time?: Date; data?: Record<string, unknown> },
): Promise<ActivityComputedMetrics> => {
  const end = activity.end_time
  if (!end) return {}

  const [{ zones: hrZones }, summarySeries, hrvData] = await Promise.all([
    getEffectiveHrZones(user),
    getTimeSeriesMultiMetric(user, [...SUMMARY_METRICS], activity.start_time, end),
    getTimeSeries(user, 'hrv_rmssd', activity.start_time, end),
  ])

  const summary = computeActivitySummaryMetrics(activity, summarySeries)

  const hrData = summarySeries.heart_rate ?? []
  const hr_zone_secs = hrData.length > 0 ? computeHrZoneSecs(hrData, hrZones) : undefined
  const avg_hrv =
    hrvData.length > 0 ? Math.round(hrvData.reduce((sum, [, v]) => sum + v, 0) / hrvData.length) : undefined

  return { ...summary, avg_hrv, hr_zone_secs }
}

export interface ActivityFullDetailOptions {
  /** Metric names to include time-series for. The single-element [ALL_METRICS_SENTINEL] expands to all available. */
  metrics?: string[]
  /** Include GPS trace if locations are available in the activity range. */
  includeGps?: boolean
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
): Promise<Pick<ActivityFullDetail, 'gps' | 'metric_series'>> => {
  const end = activity.end_time
  if (!end) return {}
  const { includeGps = true, metrics } = options

  const result: Pick<ActivityFullDetail, 'gps' | 'metric_series'> = {}

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

  if (metrics && metrics.length > 0) {
    const resolvedMetrics =
      metrics.length === 1 && metrics[0] === ALL_METRICS_SENTINEL
        ? await getDistinctMetrics(user, activity.start_time, end)
        : metrics
    result.metric_series = await Promise.all(
      resolvedMetrics.map(async (metric) => {
        const data = await getTimeSeries(user, metric, activity.start_time, end)
        return {
          count: data.length,
          data: data.map(([time, value]): [string, number] => [time.toISOString(), value]),
          metric,
          unit: getMetricUnit(metric) ?? '',
        }
      }),
    )
  }

  return result
}

/**
 * Resolved time range and merged data JSONB for an activity, expanded across
 * its overlapping cross-source records when the caller passed a `merged:` id.
 */
export interface ResolvedActivityWindow {
  start_time: Date
  end_time?: Date
  data?: Record<string, unknown>
}

/**
 * For activities fetched via a `merged:` id prefix, expand the time window to
 * cover all overlapping cross-source records and merge their `data` JSONB.
 * Plain (non-merged) activities pass through unchanged.
 */
export const resolveActivityWindow = async (
  user: string,
  activity: ActivityRow,
  isMerged: boolean,
): Promise<ResolvedActivityWindow> => {
  if (!isMerged || activity.deleted_at) {
    return { data: activity.data, end_time: activity.end_time, start_time: activity.start_time }
  }

  const overlapping = await getOverlappingActivities(user, activity)
  if (overlapping.length <= 1) {
    return { data: activity.data, end_time: activity.end_time, start_time: activity.start_time }
  }

  const start_time = new Date(Math.min(...overlapping.map((a) => a.start_time.getTime())))
  const end_time = new Date(Math.max(...overlapping.map((a) => (a.end_time ?? a.start_time).getTime())))
  const data = overlapping
    .toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
    .reduce<Record<string, unknown>>((acc, a) => (a.data ? { ...acc, ...a.data } : acc), {})

  return { data: Object.keys(data).length > 0 ? data : activity.data, end_time, start_time }
}

/**
 * Strip the optional `merged:` id prefix and report whether it was present.
 */
export const parseActivityId = (rawId: string): { id: string; isMerged: boolean } => {
  const isMerged = rawId.startsWith('merged:')
  return { id: isMerged ? rawId.slice('merged:'.length) : rawId, isMerged }
}
