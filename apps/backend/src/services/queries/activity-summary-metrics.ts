/**
 * Computes generic summary metrics for an activity.
 *
 * Generic over data source: any source that populates the underlying time-series
 * (Garmin, Strava, Health Connect, FIT upload, manual) produces these values.
 * Source-specific summary fields stored in `activity.data` (distance, calories,
 * vo2_max, etc.) are passed through, while computed averages and elevation
 * gain/loss are derived from per-second time-series.
 */

import type { ActivitySummaryMetrics, MetricType } from '@aurboda/api-spec'

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
] as const satisfies readonly MetricType[]

export type SummaryMetric = (typeof SUMMARY_METRICS)[number]

/**
 * Per-metric time-series fetched in bulk for an activity time range. Matches
 * the shape returned by `getTimeSeriesMultiMetric` — only metrics with data
 * are present.
 */
export type SummaryMetricSeries = Partial<Record<MetricType, TimeSeriesPoint[]>>

const round = (value: number, decimals: number): number => {
  const f = 10 ** decimals
  return Math.round(value * f) / f
}

/**
 * Index of the first point at or after `time`. Valid because
 * `getTimeSeriesMultiMetric` orders by `(metric, time)`.
 */
const lowerBound = (points: TimeSeriesPoint[], time: number): number => {
  let lo = 0
  let hi = points.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (points[mid][0].getTime() < time) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Half-open index range `[lo, hi)` covering `[start, end]` inclusive.
 *
 * Replaces a `filter` over the whole series. The caller fetches one series for
 * the entire requested span and asks for a window per activity per metric, so a
 * scan made the enrichment `O(activities × metrics × series)` — a wide timeline
 * range over per-second data blocked the event loop long enough to stop the
 * process answering anything. Binary search makes it `O(log series + window)`.
 */
export const windowBounds = (points: TimeSeriesPoint[], start: Date, end: Date): [number, number] => [
  lowerBound(points, start.getTime()),
  // end is inclusive; +1ms finds the first point strictly after it
  lowerBound(points, end.getTime() + 1),
]

/** Mean of the positive values in `[lo, hi)`, or undefined when there are none. */
const meanPositive = (points: TimeSeriesPoint[], lo: number, hi: number): number | undefined => {
  let sum = 0
  let count = 0
  for (let i = lo; i < hi; i++) {
    const value = points[i][1]
    if (value > 0) {
      sum += value
      count++
    }
  }
  return count === 0 ? undefined : sum / count
}

/** Largest positive value in `[lo, hi)`, or undefined when there is none. */
const maxPositive = (points: TimeSeriesPoint[], lo: number, hi: number): number | undefined => {
  let max: number | undefined
  for (let i = lo; i < hi; i++) {
    const value = points[i][1]
    if (value > 0 && (max === undefined || value > max)) max = value
  }
  return max
}

/** Sum the positive deltas (gain) and negated negative deltas (loss) in `[lo, hi)`. */
const elevationGainLoss = (
  points: TimeSeriesPoint[],
  lo: number,
  hi: number,
): { gain: number; loss: number } => {
  let gain = 0
  let loss = 0
  for (let i = lo + 1; i < hi; i++) {
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
  avg: number | undefined,
  max: number | undefined,
): { avg_hr?: number; max_hr?: number } => {
  const out: { avg_hr?: number; max_hr?: number } = {}
  if (current.avg_hr === undefined && avg !== undefined) out.avg_hr = Math.round(avg)
  if (current.max_hr === undefined && max !== undefined) out.max_hr = max
  return out
}

const computeElevationFromSeries = (
  points: TimeSeriesPoint[],
  lo: number,
  hi: number,
): { elevation_gain?: number; elevation_loss?: number } => {
  if (hi - lo < 2) return {}
  const { gain, loss } = elevationGainLoss(points, lo, hi)
  const out: { elevation_gain?: number; elevation_loss?: number } = {}
  if (gain > 0) out.elevation_gain = round(gain, 1)
  if (loss > 0) out.elevation_loss = round(loss, 1)
  return out
}

const computeBodyBatteryFromSeries = (
  points: TimeSeriesPoint[],
  lo: number,
  hi: number,
): { body_battery_before?: number; body_battery_after?: number } => {
  if (hi === lo) return {}
  return { body_battery_after: points[hi - 1][1], body_battery_before: points[lo][1] }
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

  /** Series for `metric` plus the index range covering this activity. */
  const window = (metric: SummaryMetric) => {
    const points = series[metric] ?? []
    const [lo, hi] = windowBounds(points, activity.start_time, end)
    return { hi, lo, points }
  }
  const avgPositive = (metric: SummaryMetric, decimals: number): number | undefined => {
    const { hi, lo, points } = window(metric)
    const v = meanPositive(points, lo, hi)
    return v === undefined ? undefined : round(v, decimals)
  }

  const speed = window('speed')
  const hr = window('heart_rate')
  const elevation = window('elevation')
  const bodyBattery = window('body_battery')

  Object.assign(
    result,
    computePace(
      meanPositive(speed.points, speed.lo, speed.hi),
      result.distance,
      (end.getTime() - activity.start_time.getTime()) / 1000,
    ),
    computeHrFromSeries(result, meanPositive(hr.points, hr.lo, hr.hi), maxPositive(hr.points, hr.lo, hr.hi)),
    computeElevationFromSeries(elevation.points, elevation.lo, elevation.hi),
    computeBodyBatteryFromSeries(bodyBattery.points, bodyBattery.lo, bodyBattery.hi),
  )
  result.avg_cadence = avgPositive('run_cadence', 1) ?? result.avg_cadence
  result.avg_stride_length = avgPositive('stride_length', 2) ?? result.avg_stride_length
  result.avg_power = avgPositive('power', 1) ?? result.avg_power
  result.avg_ground_contact_time = avgPositive('ground_contact_time', 1) ?? result.avg_ground_contact_time
  return result
}
