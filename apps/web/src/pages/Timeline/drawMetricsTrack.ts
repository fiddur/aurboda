import type { RecoveryZones, ScreentimeCategory, TrainingLoadPoint, WorkoutTrimp } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { format } from 'date-fns'

import type { ScreentimeBucketParsed } from '../../state/api'

import { stressBandColor } from '../../components/charts/stress-bands'
import { type MetricBucketParsed, aggregateBuckets, aggregateBucketsAligned } from '../../utils/chart'
import { type BarLayoutResult, slotPixels } from './barLayout'
import { buildScreentimeTooltipHtml, findScreentimeBucket } from './drawScreentimeTrack'
import {
  ACTIVITY_IMPULSE_COLOR,
  ATL_COLOR,
  CTL_COLOR,
  findNearbyWorkouts,
  findTrainingLoadPoint,
  inferBucketDuration,
  TRAINING_IMPULSE_COLOR,
  TSB_FATIGUED_COLOR,
  TSB_FRESH_COLOR,
} from './drawTrainingLoadTrack'

export const HR_COLOR = '#ef4444'
export const HRV_COLOR = '#10b981'
export const STEPS_COLOR = '#9ca3af'
export const CALORIES_COLOR = '#f59e0b'
export const STRESS_COLOR = '#f97316'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgGroup = d3.Selection<any, unknown, null, undefined>

export interface MetricsTrackConfig {
  /** The SVG group to draw into (already clipped). */
  chartGroup: SvgGroup
  /** The outer (static) group for axes and crosshair overlay. */
  outerG: SvgGroup
  /** Current x-scale (time → pixels). */
  xScale: d3.ScaleTime<number, number>
  /** Parsed 5m metric buckets. */
  buckets: MetricBucketParsed[]
  /** Y offset of the metrics track (pixels from top of chart area). */
  trackY: number
  /** Height of the metrics track in pixels. */
  trackHeight: number
  /** Chart width in pixels. */
  chartWidth: number
  /** Pixels per hour at current zoom level. */
  pixelsPerHour: number
  /** Pre-computed Y-scales for the metrics track. */
  yScales: MetricsYScales
  showHR: boolean
  showHRV: boolean
  showStress: boolean
  showSteps: boolean
  showCalories: boolean
  showTooltipHtml: (event: MouseEvent, html: string) => void
  hideTooltip: () => void
  /** Optional: training load points for combined tooltip. */
  trainingLoadPoints?: TrainingLoadPoint[]
  /** Optional: per-workout TRIMP scores for combined tooltip. */
  trainingLoadWorkouts?: WorkoutTrimp[]
  /** Optional: recovery zone thresholds for combined tooltip. */
  trainingLoadZones?: RecoveryZones
  /** Bar layout for side-by-side rendering. */
  barLayout?: BarLayoutResult
  stepsSlotId?: string
  caloriesSlotId?: string
  /** Screentime bucketed data for combined tooltip. */
  screentimeBuckets?: ScreentimeBucketParsed[]
  /** Screentime categories for tooltip rendering. */
  screentimeCategories?: ScreentimeCategory[]
  /**
   * Target bar bucket size in ms. When set, steps/calories bars are re-aggregated
   * to this bucket size so they align with training load and screentime bars.
   * Defaults to native bucket size (no forced aggregation).
   */
  barBucketMs?: number
}

/** Only merges small (5m/15m) buckets — if buckets are already >= 1h, skip. */
const getAggregationFactor = (pixelsPerHour: number, buckets: MetricBucketParsed[]): number => {
  if (buckets.length >= 2) {
    const bucketMs = buckets[1]!.start.getTime() - buckets[0]!.start.getTime()
    if (bucketMs >= 3600_000) return 1
  }
  if (pixelsPerHour > 100) return 1 // 5m buckets as-is
  if (pixelsPerHour > 20) return 3 // merge to ~15m
  return 6 // merge to ~30m
}

const needsBarAggregation = (buckets: MetricBucketParsed[], barBucketMs?: number): boolean => {
  if (!barBucketMs || buckets.length < 2) return false
  const bucketMs = buckets[1]!.start.getTime() - buckets[0]!.start.getTime()
  return bucketMs < barBucketMs
}

interface BandPoint {
  time: Date
  avg: number
  min: number
  max: number
}

/**
 * Extract a metric's band data from buckets, inserting nulls at gaps.
 * A gap is where the time distance between bucket midpoints exceeds
 * 2× the expected bucket duration.
 */
const extractBandData = (buckets: MetricBucketParsed[], metricName: string): (BandPoint | null)[] => {
  const result: (BandPoint | null)[] = []
  let prevTime: number | null = null

  for (const bucket of buckets) {
    const stats = bucket.metrics[metricName]
    if (!stats) continue

    const midTime = new Date((bucket.start.getTime() + bucket.end.getTime()) / 2)
    const bucketDuration = bucket.end.getTime() - bucket.start.getTime()

    if (prevTime !== null && midTime.getTime() - prevTime > bucketDuration * 2.5) {
      result.push(null) // gap marker
    }

    result.push({ avg: stats.avg, max: stats.max, min: stats.min, time: midTime })
    prevTime = midTime.getTime()
  }

  return result
}

const drawBandChart = (
  group: SvgGroup,
  data: (BandPoint | null)[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  color: string,
): void => {
  const area = d3
    .area<BandPoint | null>()
    .defined((d) => d !== null)
    .x((d) => xScale(d!.time))
    .y0((d) => yScale(d!.min))
    .y1((d) => yScale(d!.max))
    .curve(d3.curveMonotoneX)

  group
    .append('path')
    .datum(data)
    .attr('d', area as never)
    .attr('fill', color)
    .attr('fill-opacity', 0.15)
    .attr('pointer-events', 'none')

  const line = d3
    .line<BandPoint | null>()
    .defined((d) => d !== null)
    .x((d) => xScale(d!.time))
    .y((d) => yScale(d!.avg))
    .curve(d3.curveMonotoneX)

  group
    .append('path')
    .datum(data)
    .attr('d', line as never)
    .attr('fill', 'none')
    .attr('stroke', color)
    .attr('stroke-width', 1.5)
    .attr('pointer-events', 'none')
}

const drawBarChart = (
  group: SvgGroup,
  buckets: MetricBucketParsed[],
  metricName: string,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  color: string | ((avg: number) => string),
  opacity: number,
  barLayout?: BarLayoutResult,
  slotId?: string,
): void => {
  for (const bucket of buckets) {
    const stats = bucket.metrics[metricName]
    if (!stats) continue

    const bucketX = xScale(bucket.start)
    const bucketEnd = xScale(bucket.end)
    const bucketWidth = Math.abs(bucketEnd - bucketX)

    let x: number
    let barWidth: number
    if (barLayout && slotId) {
      const slot = slotPixels(bucketX, bucketWidth, barLayout.getOffset(slotId), barLayout.slotWidth)
      x = slot.x
      barWidth = slot.width
    } else {
      x = bucketX
      barWidth = Math.max(1, bucketWidth - 0.5)
    }

    const barTop = yScale(stats.avg)
    const barHeight = trackBottom - barTop

    if (barHeight <= 0) continue

    group
      .append('rect')
      .attr('x', x)
      .attr('y', barTop)
      .attr('width', barWidth)
      .attr('height', barHeight)
      .attr('fill', typeof color === 'function' ? color(stats.avg) : color)
      .attr('opacity', opacity)
      .attr('pointer-events', 'none')
  }
}

const formatTime = (date: Date): string => format(date, 'HH:mm')

const buildTrainingLoadSection = (
  bucketMid: Date,
  points: TrainingLoadPoint[],
  workouts?: WorkoutTrimp[],
  zones?: RecoveryZones,
  toleranceMs?: number,
): string => {
  const point = findTrainingLoadPoint(points, bucketMid, toleranceMs)
  if (!point) return ''

  let html = `<div class="tooltip-separator" style="border-top:1px solid rgba(128,128,128,0.3);margin:4px 0"></div>`
  html += `<div class="tooltip-detail" style="color:${CTL_COLOR}">Fitness (CTL): ${point.ctl.toFixed(1)}</div>`
  html += `<div class="tooltip-detail" style="color:${ATL_COLOR}">Fatigue (ATL): ${point.atl.toFixed(1)}</div>`

  const tsbColor = point.tsb >= 0 ? TSB_FRESH_COLOR : TSB_FATIGUED_COLOR
  const tsbLabel = point.tsb >= 0 ? 'Fresh' : 'Fatigued'
  html += `<div class="tooltip-detail" style="color:${tsbColor}">Form (TSB): ${point.tsb >= 0 ? '+' : ''}${point.tsb.toFixed(1)} — ${tsbLabel}</div>`

  if (point.training_impulse > 0) {
    html += `<div class="tooltip-detail" style="color:${TRAINING_IMPULSE_COLOR}">Training: ${point.training_impulse.toFixed(1)}</div>`
  }
  if (point.activity_impulse > 0) {
    html += `<div class="tooltip-detail" style="color:${ACTIVITY_IMPULSE_COLOR}">Activity: ${point.activity_impulse.toFixed(1)}</div>`
  }

  if (zones) {
    let zoneName: string
    if (point.atl < zones.balanced_min) zoneName = 'Undertrained'
    else if (point.atl <= zones.balanced_max) zoneName = 'Balanced'
    else if (point.atl <= zones.strained_max) zoneName = 'Strained'
    else zoneName = 'Very Strained'
    html += `<div class="tooltip-detail" style="opacity:0.7">Zone: ${zoneName}</div>`
  }

  if (workouts) {
    const hourTime = new Date(point.time)
    const nearbyWorkouts = findNearbyWorkouts(workouts, hourTime)
    for (const w of nearbyWorkouts) {
      const title = w.title ?? 'Workout'
      const hrStr = w.avg_hr ? ` (${Math.round(w.avg_hr)} bpm avg)` : ''
      html += `<div class="tooltip-detail" style="opacity:0.7">${title}: ${w.duration_minutes.toFixed(0)}min, TRIMP ${w.trimp.toFixed(0)}${hrStr}</div>`
    }
  }

  return html
}

const buildMetricsTooltipHtml = (
  bucket: MetricBucketParsed,
  showHR: boolean,
  showHRV: boolean,
  showStress: boolean,
  showSteps: boolean,
  showCalories: boolean,
  trainingLoadPoints?: TrainingLoadPoint[],
  trainingLoadWorkouts?: WorkoutTrimp[],
  trainingLoadZones?: RecoveryZones,
  trainingLoadToleranceMs?: number,
): string | null => {
  const startStr = formatTime(bucket.start)
  const endStr = formatTime(bucket.end)
  const dateStr = format(bucket.start, 'EEE, MMM d')
  const isSameDay = format(bucket.start, 'yyyy-MM-dd') === format(bucket.end, 'yyyy-MM-dd')
  const timeRange = isSameDay
    ? `${dateStr} ${startStr} – ${endStr}`
    : `${dateStr} ${startStr} – ${format(bucket.end, 'EEE, MMM d')} ${endStr}`
  let html = `<div class="tooltip-title">Metrics</div>`
  html += `<div class="tooltip-time">${timeRange}</div>`
  let hasContent = false

  const tooltipMetrics: {
    show: boolean
    key: string
    icon: string
    label: string
    color: string
    fmt: (m: { avg: number; min: number; max: number }) => string
  }[] = [
    {
      show: showHR,
      key: 'heart_rate',
      icon: '❤',
      label: 'HR',
      color: HR_COLOR,
      fmt: (m) => `${Math.round(m.avg)} bpm (${Math.round(m.min)}–${Math.round(m.max)})`,
    },
    {
      show: showHRV,
      key: 'hrv_rmssd',
      icon: '♥',
      label: 'HRV',
      color: HRV_COLOR,
      fmt: (m) => `${Math.round(m.avg)} ms (${Math.round(m.min)}–${Math.round(m.max)})`,
    },
    {
      show: showStress,
      key: 'stress_level',
      icon: '😰',
      label: 'Stress',
      color: STRESS_COLOR,
      fmt: (m) => `${Math.round(m.avg)} (${Math.round(m.min)}–${Math.round(m.max)})`,
    },
    {
      show: showSteps,
      key: 'steps',
      icon: '🚶',
      label: 'Steps',
      color: STEPS_COLOR,
      fmt: (m) => `${m.avg.toFixed(1)}/min`,
    },
    {
      show: showCalories,
      key: 'calories_active',
      icon: '🔥',
      label: 'Calories',
      color: CALORIES_COLOR,
      fmt: (m) => `${m.avg.toFixed(1)} kcal/min`,
    },
  ]

  for (const { show, key, icon, label, color, fmt } of tooltipMetrics) {
    if (!show) continue
    const m = bucket.metrics[key]
    if (m) {
      html += `<div class="tooltip-detail" style="color:${color}">${icon} ${label}: ${fmt(m)}</div>`
      hasContent = true
    }
  }

  if (trainingLoadPoints && trainingLoadPoints.length > 0) {
    const bucketMid = new Date((bucket.start.getTime() + bucket.end.getTime()) / 2)
    const section = buildTrainingLoadSection(
      bucketMid,
      trainingLoadPoints,
      trainingLoadWorkouts,
      trainingLoadZones,
      trainingLoadToleranceMs,
    )
    if (section) {
      html += section
      hasContent = true
    }
  }

  return hasContent ? html : null
}

/** Used when metric buckets are empty but training load points exist. */
const buildTrainingLoadOnlyTooltipHtml = (
  hoverTime: Date,
  trainingLoadPoints: TrainingLoadPoint[],
  trainingLoadWorkouts?: WorkoutTrimp[],
  trainingLoadZones?: RecoveryZones,
  toleranceMs?: number,
): string | null => {
  const point = findTrainingLoadPoint(trainingLoadPoints, hoverTime, toleranceMs)
  if (!point) return null

  const pointTime = new Date(point.time)
  const bucketDuration = inferBucketDuration(trainingLoadPoints)
  const bucketEnd = new Date(pointTime.getTime() + bucketDuration)
  const dateStr = format(pointTime, 'EEE, MMM d')
  const isSameDay = format(pointTime, 'yyyy-MM-dd') === format(bucketEnd, 'yyyy-MM-dd')
  const timeRange = isSameDay
    ? `${dateStr} ${formatTime(pointTime)} – ${formatTime(bucketEnd)}`
    : `${dateStr} – ${format(bucketEnd, 'EEE, MMM d')}`

  let html = `<div class="tooltip-title">Training Load</div>`
  html += `<div class="tooltip-time">${timeRange}</div>`

  const section = buildTrainingLoadSection(
    hoverTime,
    trainingLoadPoints,
    trainingLoadWorkouts,
    trainingLoadZones,
    toleranceMs,
  )
  return section ? html + section : null
}

const getMetricMax = (buckets: MetricBucketParsed[], metricName: string, fallback: number): number => {
  let max = -Infinity
  for (const b of buckets) {
    const s = b.metrics[metricName]
    if (s && s.avg > max) max = s.avg
  }
  return max === -Infinity ? fallback : max
}

export interface MetricsYScales {
  yHr: d3.ScaleLinear<number, number>
  yHrv: d3.ScaleLinear<number, number>
  yStress: d3.ScaleLinear<number, number>
  ySteps: d3.ScaleLinear<number, number>
  yCal: d3.ScaleLinear<number, number>
}

export const computeYScales = (
  buckets: MetricBucketParsed[],
  trackY: number,
  trackBottom: number,
  barBuckets?: MetricBucketParsed[],
): MetricsYScales => {
  const yHr = d3.scaleLinear().domain([40, 200]).range([trackBottom, trackY])

  const yStress = d3.scaleLinear().domain([0, 100]).range([trackBottom, trackY])

  // HRV: dynamic domain based on data
  let hrvMin = Infinity
  let hrvMax = -Infinity
  for (const b of buckets) {
    const s = b.metrics.hrv_rmssd
    if (!s) continue
    if (s.min < hrvMin) hrvMin = s.min
    if (s.max > hrvMax) hrvMax = s.max
  }
  if (hrvMin === Infinity) hrvMin = 0
  if (hrvMax === -Infinity) hrvMax = 150
  const hrvPadding = Math.max((hrvMax - hrvMin) * 0.2, 5)
  const yHrv = d3
    .scaleLinear()
    .domain([Math.max(0, hrvMin - hrvPadding), hrvMax + hrvPadding])
    .nice()
    .range([trackBottom, trackY])

  // Steps: dynamic domain (use bar-aggregated data for correct scale)
  const barData = barBuckets ?? buckets
  const stepsMax = getMetricMax(barData, 'steps', 1000)
  const ySteps = d3
    .scaleLinear()
    .domain([0, stepsMax * 1.1])
    .range([trackBottom, trackY])

  // Calories: dynamic domain (use bar-aggregated data for correct scale)
  const calMax = getMetricMax(barData, 'calories_active', 100)
  const yCal = d3
    .scaleLinear()
    .domain([0, calMax * 1.1])
    .range([trackBottom, trackY])

  return { yCal, yHr, yHrv, ySteps, yStress }
}

/** Binary search for the bucket containing the given timestamp. */
const findBucketAt = (bs: MetricBucketParsed[], timeMs: number): MetricBucketParsed | null => {
  let lo = 0
  let hi = bs.length - 1
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1
    const b = bs[mid]!
    if (timeMs < b.start.getTime()) hi = mid - 1
    else if (timeMs >= b.end.getTime()) lo = mid + 1
    else return b
  }
  return null
}

/**
 * Build a tooltip bucket by merging bar-aligned data (for calories/steps time range)
 * with fine-grained line data (for precise HR/HRV values).
 */
const buildTooltipBucket = (
  barBucket: MetricBucketParsed | null,
  lineBucket: MetricBucketParsed | null,
): MetricBucketParsed | null => {
  const base = barBucket ?? lineBucket
  if (!base) return null
  if (!barBucket || !lineBucket || barBucket === lineBucket) return base
  return {
    ...barBucket,
    metrics: {
      ...barBucket.metrics,
      ...(lineBucket.metrics.heart_rate && { heart_rate: lineBucket.metrics.heart_rate }),
      ...(lineBucket.metrics.hrv_rmssd && { hrv_rmssd: lineBucket.metrics.hrv_rmssd }),
      ...(lineBucket.metrics.stress_level && { stress_level: lineBucket.metrics.stress_level }),
    },
  }
}

const drawCrosshairOverlay = (
  outerG: SvgGroup,
  xScale: d3.ScaleTime<number, number>,
  buckets: MetricBucketParsed[],
  barBuckets: MetricBucketParsed[],
  trackY: number,
  trackHeight: number,
  chartWidth: number,
  showHR: boolean,
  showHRV: boolean,
  showStress: boolean,
  showSteps: boolean,
  showCalories: boolean,
  showTooltipHtml: (event: MouseEvent, html: string) => void,
  hideTooltip: () => void,
  trainingLoadPoints?: TrainingLoadPoint[],
  trainingLoadWorkouts?: WorkoutTrimp[],
  trainingLoadZones?: RecoveryZones,
  screentimeBuckets?: ScreentimeBucketParsed[],
  screentimeCategories?: ScreentimeCategory[],
): void => {
  outerG.selectAll('.metrics-crosshair').remove()

  const crosshairGroup = outerG.append('g').attr('class', 'metrics-crosshair')
  const trackBottom = trackY + trackHeight

  const hairline = crosshairGroup
    .append('line')
    .attr('y1', trackY)
    .attr('y2', trackBottom)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.4)
    .attr('stroke-width', 0.75)
    .attr('stroke-dasharray', '3,2')
    .attr('pointer-events', 'none')
    .style('display', 'none')

  crosshairGroup
    .append('rect')
    .attr('x', 0)
    .attr('y', trackY)
    .attr('width', chartWidth)
    .attr('height', trackHeight)
    .attr('fill', 'transparent')
    .attr('cursor', 'crosshair')
    .on('mousemove', (event: MouseEvent) => {
      const [mx] = d3.pointer(event)
      const hoverTime = xScale.invert(mx!)
      const hoverMs = hoverTime.getTime()

      const barBucket = barBuckets.length > 0 ? findBucketAt(barBuckets, hoverMs) : null
      const lineBucket = buckets.length > 0 ? findBucketAt(buckets, hoverMs) : null
      const tooltipBucket = buildTooltipBucket(barBucket, lineBucket)

      let html: string | null = null
      if (tooltipBucket) {
        const bucketDuration = tooltipBucket.end.getTime() - tooltipBucket.start.getTime()
        const tolerance = Math.max(2 * 3600_000, bucketDuration)
        html = buildMetricsTooltipHtml(
          tooltipBucket,
          showHR,
          showHRV,
          showStress,
          showSteps,
          showCalories,
          trainingLoadPoints,
          trainingLoadWorkouts,
          trainingLoadZones,
          tolerance,
        )
      } else if (trainingLoadPoints && trainingLoadPoints.length > 0) {
        const tlBucketDuration = inferBucketDuration(trainingLoadPoints)
        const tolerance = Math.max(2 * 3600_000, tlBucketDuration)
        html = buildTrainingLoadOnlyTooltipHtml(
          hoverTime,
          trainingLoadPoints,
          trainingLoadWorkouts,
          trainingLoadZones,
          tolerance,
        )
      }

      if (screentimeBuckets && screentimeCategories) {
        const stBucket = findScreentimeBucket(screentimeBuckets, hoverTime)
        if (stBucket) {
          const stHtml = buildScreentimeTooltipHtml(stBucket, screentimeCategories)
          if (stHtml) {
            html = (html ?? '') + stHtml
          }
        }
      }

      if (!html) {
        hairline.style('display', 'none')
        hideTooltip()
        return
      }
      hairline.attr('x1', mx!).attr('x2', mx!).style('display', null)
      showTooltipHtml(event, html)
    })
    .on('mouseleave', () => {
      hairline.style('display', 'none')
      hideTooltip()
    })
}

const drawBarAndBandCharts = (
  chartGroup: SvgGroup,
  barBuckets: MetricBucketParsed[],
  lineBuckets: MetricBucketParsed[],
  xScale: d3.ScaleTime<number, number>,
  yScales: MetricsYScales,
  trackBottom: number,
  showSteps: boolean,
  showCalories: boolean,
  showHR: boolean,
  showHRV: boolean,
  showStress: boolean,
  barLayout?: BarLayoutResult,
  stepsSlotId?: string,
  caloriesSlotId?: string,
): void => {
  const { yCal, yHr, yHrv, ySteps, yStress } = yScales

  // Draw bars first (behind lines), using coarser bar buckets
  if (showSteps) {
    drawBarChart(
      chartGroup,
      barBuckets,
      'steps',
      xScale,
      ySteps,
      trackBottom,
      STEPS_COLOR,
      0.25,
      barLayout,
      stepsSlotId,
    )
  }
  if (showCalories) {
    drawBarChart(
      chartGroup,
      barBuckets,
      'calories_active',
      xScale,
      yCal,
      trackBottom,
      CALORIES_COLOR,
      0.2,
      barLayout,
      caloriesSlotId,
    )
  }

  if (showStress) {
    drawBarChart(chartGroup, lineBuckets, 'stress_level', xScale, yStress, trackBottom, stressBandColor, 0.7)
  }

  if (showHR) {
    const hrBand = extractBandData(lineBuckets, 'heart_rate')
    if (hrBand.length > 1) drawBandChart(chartGroup, hrBand, xScale, yHr, HR_COLOR)
  }
  if (showHRV) {
    const hrvBand = extractBandData(lineBuckets, 'hrv_rmssd')
    if (hrvBand.length > 1) drawBandChart(chartGroup, hrvBand, xScale, yHrv, HRV_COLOR)
  }
}

/** Y-scales are pre-computed via `computeYScales` and passed in via config. */
export const drawMetricsTrack = (config: MetricsTrackConfig): void => {
  const {
    chartGroup,
    outerG,
    xScale,
    buckets: rawBuckets,
    trackY,
    trackHeight,
    chartWidth,
    pixelsPerHour,
    yScales,
    showHR,
    showHRV,
    showStress,
    showSteps,
    showCalories,
    showTooltipHtml,
    hideTooltip,
  } = config

  const hasMetrics = showHR || showHRV || showStress || showSteps || showCalories
  const hasTrainingLoad = config.trainingLoadPoints && config.trainingLoadPoints.length > 0
  const hasScreentime = config.screentimeBuckets && config.screentimeBuckets.length > 0
  if (rawBuckets.length === 0 && !hasTrainingLoad && !hasScreentime) return
  if (!hasMetrics && !hasTrainingLoad && !hasScreentime) return

  // Aggregate for line charts (HR/HRV) — finer granularity
  const lineFactor = getAggregationFactor(pixelsPerHour, rawBuckets)
  const buckets = aggregateBuckets(rawBuckets, lineFactor)

  // Aggregate for bar charts (steps/calories) — time-aligned to match screentime/training load
  const barBuckets = needsBarAggregation(rawBuckets, config.barBucketMs)
    ? aggregateBucketsAligned(rawBuckets, config.barBucketMs!)
    : buckets

  const trackBottom = trackY + trackHeight

  drawBarAndBandCharts(
    chartGroup,
    barBuckets,
    buckets,
    xScale,
    yScales,
    trackBottom,
    showSteps,
    showCalories,
    showHR,
    showHRV,
    showStress,
    config.barLayout,
    config.stepsSlotId,
    config.caloriesSlotId,
  )

  drawCrosshairOverlay(
    outerG,
    xScale,
    buckets,
    barBuckets,
    trackY,
    trackHeight,
    chartWidth,
    showHR,
    showHRV,
    showStress,
    showSteps,
    showCalories,
    showTooltipHtml,
    hideTooltip,
    config.trainingLoadPoints,
    config.trainingLoadWorkouts,
    config.trainingLoadZones,
    config.screentimeBuckets,
    config.screentimeCategories,
  )
}
