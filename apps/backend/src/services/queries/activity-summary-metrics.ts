/**
 * Computes generic summary metrics for an activity.
 *
 * Generic over data source: any source that populates the underlying time-series
 * (Garmin, Strava, Health Connect, FIT upload, manual) produces these values.
 * Source-specific summary fields stored in `activity.data` (distance, calories,
 * vo2_max, etc.) are passed through, while computed averages and elevation
 * gain/loss are derived from per-second time-series.
 */

import type { ActivitySummaryMetrics } from '@aurboda/api-spec'

type TimeSeriesPoint = [Date, number]

/** Time-series metrics needed to compute summary fields. */
export const SUMMARY_METRICS = [
  'heart_rate',
  'speed',
  'run_cadence',
  'stride_length',
  'power',
  'ground_contact_time',
  'elevation',
  'body_battery',
] as const

export type SummaryMetric = (typeof SUMMARY_METRICS)[number]

export type SummaryMetricSeries = Partial<Record<SummaryMetric, TimeSeriesPoint[]>>

const round = (value: number, decimals: number): number => {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

const positiveValues = (points: TimeSeriesPoint[]): number[] => points.flatMap(([, v]) => (v > 0 ? [v] : []))

const mean = (values: number[]): number | undefined =>
  values.length === 0 ? undefined : values.reduce((s, v) => s + v, 0) / values.length

const inRange = (points: TimeSeriesPoint[], start: Date, end: Date): TimeSeriesPoint[] =>
  points.filter(([t]) => t >= start && t <= end)

/** Sum the positive deltas (gain) and negated negative deltas (loss). */
const elevationGainLoss = (points: TimeSeriesPoint[]): { gain: number; loss: number } => {
  let gain = 0
  let loss = 0
  for (let i = 1; i < points.length; i++) {
    const delta = points[i][1] - points[i - 1][1]
    if (delta > 0) gain += delta
    else if (delta < 0) loss -= delta
  }
  return { gain, loss }
}

const numericFromData = (data: Record<string, unknown> | undefined, key: string): number | undefined => {
  const v = data?.[key]
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/**
 * Mapping from source-data JSONB key → ActivitySummaryMetrics field.
 * These pass through unchanged (no decimal rounding) when present.
 */
const DATA_FIELD_MAP: Array<[string, keyof ActivitySummaryMetrics]> = [
  ['distance', 'distance'],
  ['steps', 'steps'],
  ['calories', 'calories'],
  ['vo2_max', 'vo2_max'],
  ['elevation_gain', 'elevation_gain'],
  ['average_hr', 'avg_hr'],
  ['max_hr', 'max_hr'],
]

const passthroughDataFields = (data: Record<string, unknown> | undefined): ActivitySummaryMetrics => {
  const out: ActivitySummaryMetrics = {}
  for (const [src, dst] of DATA_FIELD_MAP) {
    const v = numericFromData(data, src)
    if (v !== undefined) out[dst] = v
  }
  return out
}

const computePace = (
  speedAvg: number | undefined,
  distance: number | undefined,
  durationSec: number,
): { avg_speed?: number; avg_pace?: number } => {
  if (speedAvg !== undefined) return { avg_pace: round(1000 / speedAvg, 1), avg_speed: round(speedAvg, 3) }
  if (distance && distance > 0 && durationSec > 0) {
    return { avg_pace: round((durationSec / distance) * 1000, 1) }
  }
  return {}
}

const computeHrFromSeries = (
  current: { avg_hr?: number; max_hr?: number },
  hrValues: number[],
): { avg_hr?: number; max_hr?: number } => {
  if (hrValues.length === 0) return {}
  const out: { avg_hr?: number; max_hr?: number } = {}
  if (current.avg_hr === undefined) {
    out.avg_hr = Math.round(hrValues.reduce((s, v) => s + v, 0) / hrValues.length)
  }
  if (current.max_hr === undefined) out.max_hr = Math.max(...hrValues)
  return out
}

const computeElevationFromSeries = (
  points: TimeSeriesPoint[],
): { elevation_gain?: number; elevation_loss?: number } => {
  if (points.length < 2) return {}
  const { gain, loss } = elevationGainLoss(points)
  const out: { elevation_gain?: number; elevation_loss?: number } = {}
  if (gain > 0) out.elevation_gain = round(gain, 1)
  if (loss > 0) out.elevation_loss = round(loss, 1)
  return out
}

const computeBodyBatteryFromSeries = (
  points: TimeSeriesPoint[],
): { body_battery_before?: number; body_battery_after?: number } => {
  if (points.length === 0) return {}
  return { body_battery_after: points[points.length - 1][1], body_battery_before: points[0][1] }
}

/**
 * Compute summary metrics for an activity.
 *
 * @param activity Activity record (start_time required, end_time optional)
 * @param series   Per-metric time-series. Caller should pre-filter to the
 *                 activity's time window or pass full series — this function
 *                 trims to [start_time, end_time].
 */
export const computeActivitySummaryMetrics = (
  activity: { start_time: Date; end_time?: Date; data?: Record<string, unknown> },
  series: SummaryMetricSeries,
): ActivitySummaryMetrics => {
  const result = passthroughDataFields(activity.data)
  const end = activity.end_time
  if (!end) return result

  const window = (metric: SummaryMetric): TimeSeriesPoint[] =>
    inRange(series[metric] ?? [], activity.start_time, end)
  const avgPositive = (metric: SummaryMetric, decimals: number): number | undefined => {
    const v = mean(positiveValues(window(metric)))
    return v === undefined ? undefined : round(v, decimals)
  }

  const speedAvgRaw = mean(positiveValues(window('speed')))
  Object.assign(
    result,
    computePace(speedAvgRaw, result.distance, (end.getTime() - activity.start_time.getTime()) / 1000),
    computeHrFromSeries(result, positiveValues(window('heart_rate'))),
    computeElevationFromSeries(window('elevation')),
    computeBodyBatteryFromSeries(window('body_battery')),
  )
  result.avg_cadence = avgPositive('run_cadence', 1) ?? result.avg_cadence
  result.avg_stride_length = avgPositive('stride_length', 2) ?? result.avg_stride_length
  result.avg_power = avgPositive('power', 1) ?? result.avg_power
  result.avg_ground_contact_time = avgPositive('ground_contact_time', 1) ?? result.avg_ground_contact_time
  return result
}
