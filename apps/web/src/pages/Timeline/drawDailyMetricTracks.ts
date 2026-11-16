import type { TimelineDailyMetric } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { format, startOfDay } from 'date-fns'

import type { MetricBucketParsed } from '../../utils/chart'

import { activityColors } from './colors'
import { HR_COLOR, HRV_COLOR, STEPS_COLOR } from './drawMetricsTrack'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgGroup = d3.Selection<any, unknown, null, undefined>

export interface DailyPoint {
  start: Date
  end: Date
  value: number
}

export interface DailySeries {
  metric: TimelineDailyMetric
  points: DailyPoint[]
}

export interface DailyRow {
  y: number
  height: number
}

type BucketedDailyMetric = Exclude<TimelineDailyMetric, 'sleep_duration'>

const formatMinutes = (minutes: number): string => {
  const rounded = Math.round(minutes)
  return `${Math.floor(rounded / 60)}h ${String(rounded % 60).padStart(2, '0')}m`
}

export const DAILY_METRIC_SPECS: Record<
  TimelineDailyMetric,
  { label: string; color: string; format: (value: number) => string }
> = {
  hrv_rmssd: { color: HRV_COLOR, format: (v) => `${Math.round(v)} ms`, label: 'HRV' },
  resting_heart_rate: { color: HR_COLOR, format: (v) => `${Math.round(v)} bpm`, label: 'Resting HR' },
  sleep_duration: { color: activityColors.sleep ?? '#6366f1', format: formatMinutes, label: 'Sleep' },
  steps: { color: STEPS_COLOR, format: (v) => Math.round(v).toLocaleString(), label: 'Steps' },
  weight: { color: '#0ea5e9', format: (v) => `${v.toFixed(1)} kg`, label: 'Weight' },
}

const SUMMED_METRICS: ReadonlySet<TimelineDailyMetric> = new Set(['steps'])

export const isBucketedDailyMetric = (metric: TimelineDailyMetric): metric is BucketedDailyMetric =>
  metric !== 'sleep_duration'

/** One point per daily bucket that holds the metric: the sum for steps, the mean for the rest. */
export const dailyPointsFromBuckets = (
  buckets: MetricBucketParsed[],
  metric: BucketedDailyMetric,
): DailyPoint[] =>
  buckets.flatMap((bucket) => {
    const stats = bucket.metrics[metric]
    if (!stats || stats.count === 0) return []
    const value = SUMMED_METRICS.has(metric) ? (stats.sum ?? stats.avg * stats.count) : stats.avg
    return [{ end: bucket.end, start: bucket.start, value }]
  })

interface SleepSpan {
  activity_type: string
  start_time: Date
  end_time?: Date | null
}

/**
 * Minutes asleep per local day, counting each sleep activity on the day it ends. Overlapping
 * sleeps (the same night from two sources) are merged first so a night is not counted twice.
 */
export const dailySleepPoints = (activities: SleepSpan[]): DailyPoint[] => {
  const spans = activities
    .filter((a): a is SleepSpan & { end_time: Date } => a.activity_type === 'sleep' && !!a.end_time)
    .map((a) => [a.start_time.getTime(), a.end_time.getTime()] as const)
    .filter(([start, end]) => end > start)
    .sort((a, b) => a[0] - b[0])

  const merged: [number, number][] = []
  for (const [start, end] of spans) {
    const last = merged.at(-1)
    if (last && start <= last[1]) last[1] = Math.max(last[1], end)
    else merged.push([start, end])
  }

  const minutesByDay = new Map<number, number>()
  for (const [start, end] of merged) {
    const day = startOfDay(new Date(end)).getTime()
    minutesByDay.set(day, (minutesByDay.get(day) ?? 0) + (end - start) / 60_000)
  }

  return [...minutesByDay.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([day, value]) => {
      const start = new Date(day)
      return { end: d3.timeDay.offset(start, 1), start, value }
    })
}

const ROW_HEIGHT = 28
const MIN_MAIN_HEIGHT = 40

/** Rows of about 28 px under the Metrics lane's own content, which shrinks to make room. */
export const layoutDailyTracks = (
  trackY: number,
  trackHeight: number,
  count: number,
): { mainHeight: number; rows: DailyRow[] } => {
  if (count === 0) return { mainHeight: trackHeight, rows: [] }
  const rowHeight = Math.max(0, Math.min(ROW_HEIGHT, (trackHeight - MIN_MAIN_HEIGHT) / count))
  const mainHeight = trackHeight - rowHeight * count
  return {
    mainHeight,
    rows: Array.from({ length: count }, (_, i) => ({
      height: rowHeight,
      y: trackY + mainHeight + i * rowHeight,
    })),
  }
}

/** A row's own min/max scale, inset so the dots and their labels stay inside the row. */
export const dailyValueScale = (points: DailyPoint[], row: DailyRow): d3.ScaleLinear<number, number> => {
  const values = points.map((p) => p.value)
  const min = values.length > 0 ? Math.min(...values) : 0
  const max = values.length > 0 ? Math.max(...values) : 1
  const domain: [number, number] = min === max ? [min - 1, max + 1] : [min, max]
  const top = row.y + Math.min(11, row.height / 2)
  const bottom = row.y + row.height - Math.min(5, row.height / 4)
  return d3.scaleLinear().domain(domain).range([bottom, top])
}

const LABEL_MIN_DAY_PX = 40

export interface DailyTracksConfig {
  chartGroup: SvgGroup
  /** Holds the metric names, in the left margin. */
  labelGroup: SvgGroup
  labelX: number
  xScale: d3.ScaleTime<number, number>
  chartWidth: number
  series: DailySeries[]
  rows: DailyRow[]
  showTooltipHtml: (event: MouseEvent, html: string) => void
  hideTooltip: () => void
}

export const drawDailyMetricTracks = (config: DailyTracksConfig): void => {
  const { chartGroup, labelGroup, xScale, series, rows } = config
  labelGroup.selectAll('*').remove()

  series.forEach(({ metric, points }, i) => {
    const row = rows[i]
    if (!row || row.height <= 0) return
    const spec = DAILY_METRIC_SPECS[metric]
    const y = dailyValueScale(points, row)
    const xOf = (p: DailyPoint) => (xScale(p.start) + xScale(p.end)) / 2
    const g = chartGroup.append('g').attr('class', 'daily-metric-track')

    g.append('line')
      .attr('x1', 0)
      .attr('x2', config.chartWidth)
      .attr('y1', row.y)
      .attr('y2', row.y)
      .attr('stroke', 'currentColor')
      .attr('stroke-opacity', 0.12)

    labelGroup
      .append('text')
      .attr('x', config.labelX)
      .attr('y', row.y + row.height / 2)
      .attr('dy', '0.35em')
      .attr('fill', spec.color)
      .attr('font-size', '0.6rem')
      .attr('font-weight', 600)
      .text(spec.label)

    if (points.length === 0) return

    g.append('path')
      .datum(points)
      .attr('fill', 'none')
      .attr('stroke', spec.color)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', 0.7)
      .attr(
        'd',
        d3
          .line<DailyPoint>()
          .x(xOf)
          .y((p) => y(p.value)),
      )

    for (const p of points) {
      const cx = xOf(p)
      const cy = y(p.value)
      const dayWidth = xScale(p.end) - xScale(p.start)
      g.append('circle').attr('cx', cx).attr('cy', cy).attr('r', 2.5).attr('fill', spec.color)
      if (dayWidth > LABEL_MIN_DAY_PX) {
        const anchor = cx < 24 ? 'start' : cx > config.chartWidth - 24 ? 'end' : 'middle'
        g.append('text')
          .attr('x', cx)
          .attr('y', cy - 4)
          .attr('text-anchor', anchor)
          .attr('fill', 'currentColor')
          .attr('fill-opacity', 0.75)
          .attr('font-size', '0.55rem')
          .attr('pointer-events', 'none')
          .text(spec.format(p.value))
      }
      g.append('rect')
        .attr('x', xScale(p.start))
        .attr('y', row.y)
        .attr('width', Math.max(1, dayWidth))
        .attr('height', row.height)
        .attr('fill', 'transparent')
        .on('mouseenter', (event: MouseEvent) =>
          config.showTooltipHtml(
            event,
            `<strong>${spec.label}</strong><br>${format(p.start, 'EEE MMM d')}: ${spec.format(p.value)}`,
          ),
        )
        .on('mouseleave', config.hideTooltip)
    }
  })
}
