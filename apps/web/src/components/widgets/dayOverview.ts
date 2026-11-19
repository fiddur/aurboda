import type { DayOverviewConfig, DayOverviewWindow } from '@aurboda/api-spec'

import { dayOverviewDefaultMetrics } from '@aurboda/api-spec'
import { addDays, format, startOfDay } from 'date-fns'

import type { MetricBucketParsed } from '../../utils/chart'

import { CHART_PRIMARY } from '../../theme'
import { METRIC_CHART_STYLES } from '../charts/stress-bands'

const HOUR_MS = 3_600_000

export interface TimeRange {
  start: Date
  end: Date
}

export interface ResolvedDayOverviewConfig {
  window: DayOverviewWindow
  barMetric: string
  lineMetric: string | undefined
  title: string
}

const defaultTitles: Record<DayOverviewWindow, string> = {
  rolling_24h: 'Last 24 hours',
  today: 'Today',
  yesterday: 'Yesterday',
}

const emptyMessages: Record<DayOverviewWindow, string> = {
  rolling_24h: 'No data for the last 24 hours',
  today: 'No data for today yet',
  yesterday: 'No data for yesterday',
}

export const dayOverviewEmptyMessage = (window: DayOverviewWindow): string => emptyMessages[window]

/** The config with its defaults filled in; a stored config may predate a field or come raw from the API. */
export const resolveDayOverviewConfig = (config: Partial<DayOverviewConfig>): ResolvedDayOverviewConfig => {
  const window = config.window ?? 'rolling_24h'
  const metrics = config.metrics?.length ? config.metrics : [...dayOverviewDefaultMetrics]
  return {
    barMetric: metrics[0] ?? dayOverviewDefaultMetrics[0],
    lineMetric: metrics[1],
    title: config.title?.trim() || defaultTitles[window],
    window,
  }
}

/** The axis span in local time: 24 hours up to now, or a whole local day (today runs to midnight ahead). */
export const dayOverviewRange = (window: DayOverviewWindow, now: Date): TimeRange => {
  if (window === 'rolling_24h') return { end: now, start: new Date(now.getTime() - 24 * HOUR_MS) }
  const today = startOfDay(now)
  return window === 'today'
    ? { end: addDays(today, 1), start: today }
    : { end: today, start: addDays(today, -1) }
}

const zonedFormatters = new Map<string, Intl.DateTimeFormat>()

const zonedFormatter = (tz: string): Intl.DateTimeFormat => {
  const cached = zonedFormatters.get(tz)
  if (cached) return cached
  const formatter = new Intl.DateTimeFormat('en-US', {
    day: 'numeric',
    hour: '2-digit',
    hourCycle: 'h23',
    minute: '2-digit',
    month: 'long',
    timeZone: tz,
    weekday: 'long',
  })
  zonedFormatters.set(tz, formatter)
  return formatter
}

const zonedParts = (date: Date, tz: string): Record<string, string> =>
  Object.fromEntries(
    zonedFormatter(tz)
      .formatToParts(date)
      .map((part) => [part.type, part.value]),
  )

export type DayPattern = 'HH' | 'HH:mm' | 'EEE d MMM HH:mm' | 'EEEE d MMMM'

/** `date-fns` format in the browser's zone, or the same text in `tz` (a visitor reads the owner's day). */
export const formatAt = (date: Date, pattern: DayPattern, tz?: string): string => {
  if (!tz) return format(date, pattern)
  const p = zonedParts(date, tz)
  const time = `${p.hour}:${p.minute}`
  switch (pattern) {
    case 'HH':
      return p.hour ?? ''
    case 'HH:mm':
      return time
    case 'EEE d MMM HH:mm':
      return `${p.weekday?.slice(0, 3)} ${p.day} ${p.month?.slice(0, 3)} ${time}`
    case 'EEEE d MMMM':
      return `${p.weekday} ${p.day} ${p.month}`
  }
}

const localClock = (date: Date, tz?: string): { hour: number; minute: number } => {
  if (!tz) return { hour: date.getHours(), minute: date.getMinutes() }
  const p = zonedParts(date, tz)
  return { hour: Number(p.hour), minute: Number(p.minute) }
}

/** The window's dates for the header: one day, or the two days a rolling window touches. */
export const formatRangeLabel = (window: DayOverviewWindow, range: TimeRange, tz?: string): string =>
  window === 'rolling_24h'
    ? `${formatAt(range.start, 'EEE d MMM HH:mm', tz)} – ${formatAt(range.end, 'EEE d MMM HH:mm', tz)}`
    : formatAt(range.start, 'EEEE d MMMM', tz)

export interface BucketValue {
  start: Date
  end: Date
  value: number
}

/** One metric's average per bucket; buckets without a value are left out. */
export const metricSeries = (buckets: MetricBucketParsed[], metric: string): BucketValue[] =>
  buckets.flatMap((b) => {
    const stats = b.metrics[metric]
    return stats ? [{ end: b.end, start: b.start, value: stats.avg }] : []
  })

/** A bar's colour: the value's band for a banded metric (stress), else the accent colour. */
export const barColor = (metric: string, value: number): string => {
  const style = METRIC_CHART_STYLES[metric]
  return style ? style.color(value) : CHART_PRIMARY
}

const fixedDomains: Record<string, [number, number]> = {
  body_battery: [0, 100],
  stress_level: [0, 100],
}

/** A metric's value scale: fixed 0–100 for stress and Body Battery, else zero (or the minimum when negative) to the maximum. */
export const valueDomain = (metric: string, values: number[]): [number, number] => {
  const fixed = fixedDomains[metric] ?? METRIC_CHART_STYLES[metric]?.domain
  if (fixed) return fixed
  if (values.length === 0) return [0, 1]
  const max = Math.max(...values)
  const min = Math.min(0, ...values)
  return max > min ? [min, max] : [min, min + 1]
}

/** Consecutive runs of buckets with no gap between them, so a line breaks where data stops. */
export const contiguousRuns = (series: BucketValue[]): BucketValue[][] =>
  series.reduce<BucketValue[][]>((runs, point) => {
    const run = runs[runs.length - 1]
    const last = run?.[run.length - 1]
    if (run && last && point.start.getTime() <= last.end.getTime()) run.push(point)
    else runs.push([point])
    return runs
  }, [])

export const latestValue = (series: BucketValue[]): number | undefined => series[series.length - 1]?.value

export const averageValue = (series: BucketValue[]): number | undefined =>
  series.length === 0 ? undefined : series.reduce((sum, p) => sum + p.value, 0) / series.length

interface Span {
  start_time: Date
  end_time?: Date
}

/** The spans clipped to the range; those wholly outside or without an end are dropped. */
export const clipSpans = <T extends Span>(
  spans: T[],
  range: TimeRange,
): (T & { start_time: Date; end_time: Date })[] =>
  spans.flatMap((span) => {
    if (!span.end_time) return []
    const start = Math.max(span.start_time.getTime(), range.start.getTime())
    const end = Math.min(span.end_time.getTime(), range.end.getTime())
    return end > start ? [{ ...span, end_time: new Date(end), start_time: new Date(start) }] : []
  })

export interface PlacedIcon<T> {
  x: number
  items: T[]
}

/**
 * Icons placed left to right; one that would overlap the group before it joins that group, which
 * is drawn at its first icon's position as one "+N" bubble.
 */
export const collapseIcons = <T extends { x: number }>(items: T[], minGap: number): PlacedIcon<T>[] =>
  items
    .toSorted((a, b) => a.x - b.x)
    .reduce<PlacedIcon<T>[]>((groups, item) => {
      const last = groups[groups.length - 1]
      if (last && item.x - last.x < minGap) last.items.push(item)
      else groups.push({ items: [item], x: item.x })
      return groups
    }, [])

const QUARTER_MS = 15 * 60_000

/**
 * Hour ticks on whole local hours (in `tz` when given): every 3 hours, every 6 on a narrow card.
 * Every zone offset is a whole number of quarter hours, so each local hour starts on a quarter.
 */
export const hourTicks = (range: TimeRange, width: number, tz?: string): Date[] => {
  const step = width < 420 ? 6 : 3
  const ticks: Date[] = []
  const first = Math.ceil(range.start.getTime() / QUARTER_MS) * QUARTER_MS
  for (let t = first; t <= range.end.getTime(); t += QUARTER_MS) {
    const { hour, minute } = localClock(new Date(t), tz)
    if (minute === 0 && hour % step === 0) ticks.push(new Date(t))
  }
  return ticks
}

export type DayStatus = 'loading' | 'failed' | 'empty' | 'ready'

export interface DayStatusResult {
  status: DayStatus
  hint?: string
}

/** Both queries failed is a failure; one failed shows what the other loaded with a hint about the missing part. */
export const dayStatus = (
  loading: boolean,
  failed: { metrics: boolean; activities: boolean },
  parts: Record<string, readonly unknown[]>,
): DayStatusResult => {
  if (loading) return { status: 'loading' }
  if (failed.metrics && failed.activities) return { status: 'failed' }
  const status = Object.values(parts).every((part) => part.length === 0) ? 'empty' : 'ready'
  if (failed.metrics) return { hint: 'The metrics could not be loaded', status }
  if (failed.activities) return { hint: 'The activities could not be loaded', status }
  return { status }
}
