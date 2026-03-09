/**
 * Draws the metrics track in horizontal timeline mode.
 *
 * - HR and HRV as band/ribbon charts (smoothed avg line + min-max area)
 * - Steps and calories as bar charts behind the lines
 * - Crosshair tooltip on mouseover showing all metric values at that time
 */
import * as d3 from 'd3'
import { format } from 'date-fns'
import { type MetricBucketParsed, aggregateBuckets } from '../../utils/chart'

// ── Colors ────────────────────────────────────────────────────────────────────

export const HR_COLOR = '#ef4444'
export const HRV_COLOR = '#10b981'
export const STEPS_COLOR = '#9ca3af'
export const CALORIES_COLOR = '#f59e0b'

// ── Types ─────────────────────────────────────────────────────────────────────

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
  /** Visibility toggles. */
  showHR: boolean
  showHRV: boolean
  showSteps: boolean
  showCalories: boolean
  /** Tooltip callback — receives HTML content and mouse event. */
  showTooltipHtml: (event: MouseEvent, html: string) => void
  hideTooltip: () => void
}

// ── Bucket aggregation by zoom ────────────────────────────────────────────────

/** Pick an aggregation factor based on pixels-per-hour (zoom level). */
const getAggregationFactor = (pixelsPerHour: number): number => {
  if (pixelsPerHour > 100) return 1 // 5m buckets as-is
  if (pixelsPerHour > 20) return 3 // merge to ~15m
  return 6 // merge to ~30m
}

// ── Gap detection ─────────────────────────────────────────────────────────────

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

// ── Drawing ───────────────────────────────────────────────────────────────────

/** Draw a band/ribbon chart: semi-transparent min-max area + smooth avg line. */
const drawBandChart = (
  group: SvgGroup,
  data: (BandPoint | null)[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  color: string,
): void => {
  // Area fill between min and max
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

  // Average line
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

/** Draw bar charts for steps or calories. */
const drawBarChart = (
  group: SvgGroup,
  buckets: MetricBucketParsed[],
  metricName: string,
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  color: string,
  opacity: number,
): void => {
  for (const bucket of buckets) {
    const stats = bucket.metrics[metricName]
    if (!stats) continue

    const x = xScale(bucket.start)
    const xEnd = xScale(bucket.end)
    const barWidth = Math.max(1, xEnd - x - 0.5)
    const barTop = yScale(stats.avg)
    const barHeight = trackBottom - barTop

    if (barHeight <= 0) continue

    group
      .append('rect')
      .attr('x', x)
      .attr('y', barTop)
      .attr('width', barWidth)
      .attr('height', barHeight)
      .attr('fill', color)
      .attr('opacity', opacity)
      .attr('pointer-events', 'none')
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const formatTime = (date: Date): string => format(date, 'HH:mm')

const buildMetricsTooltipHtml = (
  bucket: MetricBucketParsed,
  showHR: boolean,
  showHRV: boolean,
  showSteps: boolean,
  showCalories: boolean,
): string => {
  const startStr = formatTime(bucket.start)
  const endStr = formatTime(bucket.end)

  let html = `<div class="tooltip-title">Metrics</div>`
  html += `<div class="tooltip-time">${startStr} – ${endStr}</div>`

  if (showHR) {
    const hr = bucket.metrics.heart_rate
    if (hr) {
      html += `<div class="tooltip-detail" style="color:${HR_COLOR}">❤ HR: ${Math.round(hr.avg)} bpm (${Math.round(hr.min)}–${Math.round(hr.max)})</div>`
    }
  }
  if (showHRV) {
    const hrv = bucket.metrics.hrv_rmssd
    if (hrv) {
      html += `<div class="tooltip-detail" style="color:${HRV_COLOR}">♥ HRV: ${Math.round(hrv.avg)} ms (${Math.round(hrv.min)}–${Math.round(hrv.max)})</div>`
    }
  }
  if (showSteps) {
    const steps = bucket.metrics.steps
    if (steps) {
      html += `<div class="tooltip-detail" style="color:${STEPS_COLOR}">🚶 Steps: ${Math.round(steps.avg)}/bucket</div>`
    }
  }
  if (showCalories) {
    const cal = bucket.metrics.calories_active
    if (cal) {
      html += `<div class="tooltip-detail" style="color:${CALORIES_COLOR}">🔥 Calories: ${Math.round(cal.avg)} kcal/bucket</div>`
    }
  }

  return html
}

// ── Y-scale computation ───────────────────────────────────────────────────────

/** Extract maximum avg value from buckets for a given metric. */
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
  ySteps: d3.ScaleLinear<number, number>
  yCal: d3.ScaleLinear<number, number>
}

export const computeYScales = (
  buckets: MetricBucketParsed[],
  trackY: number,
  trackBottom: number,
): MetricsYScales => {
  // HR: fixed domain
  const yHr = d3.scaleLinear().domain([40, 200]).range([trackBottom, trackY])

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

  // Steps: dynamic domain
  const stepsMax = getMetricMax(buckets, 'steps', 1000)
  const ySteps = d3
    .scaleLinear()
    .domain([0, stepsMax * 1.1])
    .range([trackBottom, trackY])

  // Calories: dynamic domain
  const calMax = getMetricMax(buckets, 'calories_active', 100)
  const yCal = d3
    .scaleLinear()
    .domain([0, calMax * 1.1])
    .range([trackBottom, trackY])

  return { yCal, yHr, yHrv, ySteps }
}

// ── Crosshair overlay ─────────────────────────────────────────────────────────

const drawCrosshairOverlay = (
  outerG: SvgGroup,
  xScale: d3.ScaleTime<number, number>,
  buckets: MetricBucketParsed[],
  trackY: number,
  trackHeight: number,
  chartWidth: number,
  showHR: boolean,
  showHRV: boolean,
  showSteps: boolean,
  showCalories: boolean,
  showTooltipHtml: (event: MouseEvent, html: string) => void,
  hideTooltip: () => void,
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

      let nearest: MetricBucketParsed | null = null
      let bestDist = Infinity
      for (const b of buckets) {
        const mid = (b.start.getTime() + b.end.getTime()) / 2
        const dist = Math.abs(hoverTime.getTime() - mid)
        if (dist < bestDist) {
          bestDist = dist
          nearest = b
        }
      }

      if (!nearest) {
        hairline.style('display', 'none')
        hideTooltip()
        return
      }

      const bucketDuration = nearest.end.getTime() - nearest.start.getTime()
      if (bestDist > bucketDuration * 2) {
        hairline.style('display', 'none')
        hideTooltip()
        return
      }

      hairline.attr('x1', mx!).attr('x2', mx!).style('display', null)
      const html = buildMetricsTooltipHtml(nearest, showHR, showHRV, showSteps, showCalories)
      showTooltipHtml(event, html)
    })
    .on('mouseleave', () => {
      hairline.style('display', 'none')
      hideTooltip()
    })
}

// ── Main draw function ────────────────────────────────────────────────────────

/**
 * Draw the metrics track: bars for steps/calories, then band charts for HR/HRV,
 * and an interactive crosshair overlay for tooltips.
 *
 * Y-scales are pre-computed via `computeYScales` and passed in via config.
 */
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
    showSteps,
    showCalories,
    showTooltipHtml,
    hideTooltip,
  } = config

  if (rawBuckets.length === 0) return
  if (!showHR && !showHRV && !showSteps && !showCalories) return

  const factor = getAggregationFactor(pixelsPerHour)
  const buckets = aggregateBuckets(rawBuckets, factor)
  const trackBottom = trackY + trackHeight

  const { yCal, yHr, yHrv, ySteps } = yScales

  // Draw bars first (behind lines)
  if (showSteps) {
    drawBarChart(chartGroup, buckets, 'steps', xScale, ySteps, trackBottom, STEPS_COLOR, 0.25)
  }
  if (showCalories) {
    drawBarChart(chartGroup, buckets, 'calories_active', xScale, yCal, trackBottom, CALORIES_COLOR, 0.2)
  }

  // Draw band charts
  if (showHR) {
    const hrBand = extractBandData(buckets, 'heart_rate')
    if (hrBand.length > 1) drawBandChart(chartGroup, hrBand, xScale, yHr, HR_COLOR)
  }
  if (showHRV) {
    const hrvBand = extractBandData(buckets, 'hrv_rmssd')
    if (hrvBand.length > 1) drawBandChart(chartGroup, hrvBand, xScale, yHrv, HRV_COLOR)
  }

  // Crosshair tooltip overlay
  drawCrosshairOverlay(
    outerG,
    xScale,
    buckets,
    trackY,
    trackHeight,
    chartWidth,
    showHR,
    showHRV,
    showSteps,
    showCalories,
    showTooltipHtml,
    hideTooltip,
  )
}
