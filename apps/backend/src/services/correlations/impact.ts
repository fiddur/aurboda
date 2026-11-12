import type { ImpactBucket, ImpactBucketPhase, TimeWindowStats, WindowEffect } from '@aurboda/api-spec'

import { studentTTwoSidedP } from './stats.ts'
import { mean, stddev } from './utils.ts'

export const BIN_MINUTES = 5
export const SESSION_GAP_MINUTES = 10
export const POINT_ACTIVITY_MINUTES = 5
export const DEFAULT_WINDOW_MINUTES = 30
export const MIN_WINDOW_MINUTES = 10
export const MAX_WINDOW_MINUTES = 1440

const MINUTE_MS = 60_000

export interface Interval {
  start: number
  end: number
}

export interface BinnedSeries {
  times: number[]
  values: number[]
}

export type MetricKey = 'hrv' | 'hr' | 'stress'
export type MetricSeries = Record<MetricKey, BinnedSeries>

export type TimelineBucket = 'before30min' | 'before15min' | 'during' | 'after15min' | 'after30min'
export type ImpactTimeline = Record<TimelineBucket, TimeWindowStats>

export interface BucketOffsets {
  phase: ImpactBucketPhase
  start_offset_minutes: number
  end_offset_minutes: number
}

export interface ImpactSummary {
  timeline: Record<MetricKey, ImpactTimeline>
  buckets: ImpactBucket[]
  effects: Record<MetricKey, WindowEffect>
}

const METRIC_KEYS: MetricKey[] = ['hrv', 'hr', 'stress']
const TIMELINE_BUCKETS: TimelineBucket[] = [
  'before30min',
  'before15min',
  'during',
  'after15min',
  'after30min',
]

const total = (values: number[]): number => values.reduce((a, b) => a + b, 0)

const round = (value: number | null, decimals: number): number | null => {
  if (value === null) return null
  const factor = 10 ** decimals
  return Math.round(value * factor) / factor
}

export const clampWindowMinutes = (value: number | undefined): number => {
  if (value === undefined || Number.isNaN(value)) return DEFAULT_WINDOW_MINUTES
  return Math.min(MAX_WINDOW_MINUTES, Math.max(MIN_WINDOW_MINUTES, value))
}

export const extendByWindow = (
  start: Date,
  end: Date,
  windowMinutes: number,
): { seriesStart: Date; seriesEnd: Date } => ({
  seriesEnd: new Date(end.getTime() + windowMinutes * MINUTE_MS),
  seriesStart: new Date(start.getTime() - windowMinutes * MINUTE_MS),
})

export const binSeries = (data: [Date, number][], binMinutes: number = BIN_MINUTES): BinnedSeries => {
  const binMs = binMinutes * MINUTE_MS
  const bins = new Map<number, { sum: number; count: number }>()
  for (const [time, value] of data) {
    const binStart = Math.floor(time.getTime() / binMs) * binMs
    const bin = bins.getOrInsertComputed(binStart, () => ({ count: 0, sum: 0 }))
    bin.sum += value
    bin.count++
  }
  const sorted = [...bins].toSorted(([a], [b]) => a - b)
  return { times: sorted.map(([t]) => t), values: sorted.map(([, { count, sum }]) => sum / count) }
}

const lowerBound = (times: number[], target: number): number => {
  let lo = 0
  let hi = times.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (times[mid] < target) lo = mid + 1
    else hi = mid
  }
  return lo
}

export const valuesBetween = (series: BinnedSeries, start: number, end: number): number[] => {
  if (end <= start) return []
  return series.values.slice(lowerBound(series.times, start), lowerBound(series.times, end))
}

export const mergeIntoSessions = (
  intervals: Interval[],
  gapMinutes: number = SESSION_GAP_MINUTES,
): Interval[] => {
  const gapMs = gapMinutes * MINUTE_MS
  const sorted = intervals.toSorted((a, b) => a.start - b.start)
  const sessions: Interval[] = []
  for (const { start, end } of sorted) {
    const last = sessions.at(-1)
    const atLeastOneBin = Math.max(end, start + POINT_ACTIVITY_MINUTES * MINUTE_MS)
    if (last && start <= last.end + gapMs) last.end = Math.max(last.end, atLeastOneBin)
    else sessions.push({ end: atLeastOneBin, start })
  }
  return sessions
}

export const windowStats = (perSession: number[][]): TimeWindowStats => {
  const withData = perSession.filter((values) => values.length > 0)
  const sessionMeans = withData.map((values) => total(values) / values.length)
  return {
    mean: round(mean(sessionMeans), 1),
    occurrences: sessionMeans.length,
    sample_count: total(withData.map((values) => values.length)),
    stddev: round(stddev(sessionMeans), 1),
  }
}

export const pairedEffect = (before: (number | null)[], after: (number | null)[]): WindowEffect => {
  const pairs = before.flatMap((b, i) => {
    const a = after[i]
    return b !== null && a !== undefined && a !== null ? [{ after: a, before: b }] : []
  })
  const diffs = pairs.map((p) => p.after - p.before)
  const meanDiff = mean(diffs)
  const sdDiff = stddev(diffs)
  const n = pairs.length
  const pValue =
    n >= 3 && meanDiff !== null && sdDiff !== null && sdDiff > 1e-9 * Math.max(1, Math.abs(meanDiff))
      ? studentTTwoSidedP(meanDiff / (sdDiff / Math.sqrt(n)), n - 1)
      : null
  return {
    after_mean: round(mean(pairs.map((p) => p.after)), 1),
    before_mean: round(mean(pairs.map((p) => p.before)), 1),
    change: round(meanDiff, 1),
    change_stddev: round(sdDiff, 1),
    p_value: round(pValue, 4),
    paired_occurrences: n,
  }
}

interface SessionWindows {
  before: Interval
  after: Interval
  buckets: Record<TimelineBucket, Interval>
  clip: (bucket: BucketOffsets) => Interval
}

export const bucketsPerSide = (windowMinutes: number): number => (windowMinutes < 60 ? 2 : 4)

const sideBuckets = (phase: 'before' | 'after', windowMinutes: number, count: number): BucketOffsets[] => {
  const size = windowMinutes / count
  const origin = phase === 'before' ? -windowMinutes : 0
  return Array.from({ length: count }, (_, i) => ({
    end_offset_minutes: origin + (i + 1) * size,
    phase,
    start_offset_minutes: origin + i * size,
  }))
}

const DURING: BucketOffsets = { end_offset_minutes: 0, phase: 'during', start_offset_minutes: 0 }

export const timelineBuckets = (windowMinutes: number): BucketOffsets[] => {
  const count = bucketsPerSide(windowMinutes)
  return [
    ...sideBuckets('before', windowMinutes, count),
    DURING,
    ...sideBuckets('after', windowMinutes, count),
  ]
}

const legacyBuckets = (windowMinutes: number): Record<TimelineBucket, BucketOffsets> => {
  const [before30min, before15min] = sideBuckets('before', windowMinutes, 2)
  const [after15min, after30min] = sideBuckets('after', windowMinutes, 2)
  return { after15min, after30min, before15min, before30min, during: DURING }
}

interface ClippedSession {
  session: Interval
  before: Interval
  after: Interval
}

const clipBucket = ({ after, before, session }: ClippedSession, bucket: BucketOffsets): Interval => {
  const startMs = bucket.start_offset_minutes * MINUTE_MS
  const endMs = bucket.end_offset_minutes * MINUTE_MS
  if (bucket.phase === 'before') {
    return {
      end: Math.min(session.start + endMs, before.end),
      start: Math.max(session.start + startMs, before.start),
    }
  }
  if (bucket.phase === 'after') {
    return { end: Math.min(session.end + endMs, after.end), start: session.end + startMs }
  }
  return session
}

const sessionWindows = (sessions: Interval[], windowMinutes: number): SessionWindows[] => {
  const windowMs = windowMinutes * MINUTE_MS
  const legacy = Object.entries(legacyBuckets(windowMinutes)) as [TimelineBucket, BucketOffsets][]
  return sessions.map((session, i) => {
    const { end, start } = session
    // A bin is picked by its start time, so a window that ends where a session begins stops one
    // bin early: the bin straddling the session's start holds the session's own samples.
    const next = sessions[i + 1]
    const before = {
      end: start - BIN_MINUTES * MINUTE_MS + 1,
      start: Math.max(start - windowMs, sessions[i - 1]?.end ?? -Infinity),
    }
    const after = {
      end: Math.min(end + windowMs, next ? next.start - BIN_MINUTES * MINUTE_MS + 1 : Infinity),
      start: end,
    }
    const clipped = { after, before, session }
    return {
      after,
      before,
      buckets: Object.fromEntries(
        legacy.map(([key, offsets]) => [key, clipBucket(clipped, offsets)]),
      ) as Record<TimelineBucket, Interval>,
      clip: (bucket: BucketOffsets) => clipBucket(clipped, bucket),
    }
  })
}

const meanOrNull = (values: number[]): number | null => (values.length > 0 ? mean(values) : null)

export const summarizeImpact = (
  sessions: Interval[],
  series: MetricSeries,
  windowMinutes: number,
): ImpactSummary => {
  const windows = sessionWindows(sessions, windowMinutes)
  const between = (metric: MetricKey, { end, start }: Interval) => valuesBetween(series[metric], start, end)

  const summarizeMetric = (metric: MetricKey) => ({
    effect: pairedEffect(
      windows.map((w) => meanOrNull(between(metric, w.before))),
      windows.map((w) => meanOrNull(between(metric, w.after))),
    ),
    timeline: Object.fromEntries(
      TIMELINE_BUCKETS.map((bucket) => [
        bucket,
        windowStats(windows.map((w) => between(metric, w.buckets[bucket]))),
      ]),
    ) as ImpactTimeline,
  })

  const summaries = Object.fromEntries(METRIC_KEYS.map((m) => [m, summarizeMetric(m)])) as Record<
    MetricKey,
    ReturnType<typeof summarizeMetric>
  >
  const bucketStats = (metric: MetricKey, bucket: BucketOffsets) =>
    windowStats(windows.map((w) => between(metric, w.clip(bucket))))
  const buckets = timelineBuckets(windowMinutes).map((bucket) => ({
    ...bucket,
    hr: bucketStats('hr', bucket),
    hrv: bucketStats('hrv', bucket),
    stress: bucketStats('stress', bucket),
  }))
  return {
    buckets,
    effects: { hr: summaries.hr.effect, hrv: summaries.hrv.effect, stress: summaries.stress.effect },
    timeline: { hr: summaries.hr.timeline, hrv: summaries.hrv.timeline, stress: summaries.stress.timeline },
  }
}

export const binMetricSeries = (
  hrvData: [Date, number][],
  hrData: [Date, number][],
  stressData: [Date, number][],
): MetricSeries => ({ hr: binSeries(hrData), hrv: binSeries(hrvData), stress: binSeries(stressData) })

export const activityInterval = (activity: { start_time: Date; end_time?: Date | null }): Interval => {
  const start = activity.start_time.getTime()
  return { end: activity.end_time?.getTime() ?? start, start }
}

export const productivityCategoryKey = (record: {
  resolved_category?: string[] | null
  category?: string | null
}): string => record.resolved_category?.join(' > ') || record.category || 'Uncategorized'

export const locationKey = (visit: { name?: string | null }): string => visit.name || 'Unknown'
