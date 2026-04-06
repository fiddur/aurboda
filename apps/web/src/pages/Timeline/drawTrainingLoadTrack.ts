/**
 * Draws the training load track in horizontal timeline mode.
 *
 * Polar Recovery Status-style visualization:
 * - Stacked bars per hour: training impulse (purple) + activity impulse (blue)
 * - CTL (fitness) curve as a filled area showing accumulated past load
 * - ATL (fatigue) line
 * - TSB (form) line: green when positive, red when negative
 * - Horizontal zone bands: Undertrained / Balanced / Strained / Very Strained
 * - Crosshair overlay for tooltips
 */
import type { RecoveryZones, TrainingLoadPoint, WorkoutTrimp } from '@aurboda/api-spec'

import * as d3 from 'd3'
import { format } from 'date-fns'

import type { BarLayoutResult } from './barLayout'

// ── Colors ────────────────────────────────────────────────────────────────────

export const CTL_COLOR = '#3b82f6' // blue (fitness)
export const ATL_COLOR = '#f97316' // orange (fatigue)
export const TSB_FRESH_COLOR = '#22c55e' // green (TSB > 0)
export const TSB_FATIGUED_COLOR = '#ef4444' // red (TSB < 0)
export const TRAINING_IMPULSE_COLOR = '#8b5cf6' // purple (exercise TRIMP)
export const ACTIVITY_IMPULSE_COLOR = '#60a5fa' // light blue (activity calories)

// ATL bar gradient: low → mid → high fatigue
const ATL_BAR_LOW_COLOR = '#93c5fd' // light blue (low fatigue)
const ATL_BAR_MID_COLOR = '#f97316' // orange (moderate fatigue)
const ATL_BAR_HIGH_COLOR = '#dc2626' // red (high fatigue)

// Zone band colors (semi-transparent)
const ZONE_UNDERTRAINED_COLOR = 'rgba(59, 130, 246, 0.06)' // light blue tint
const ZONE_BALANCED_COLOR = 'rgba(34, 197, 94, 0.06)' // light green tint
const ZONE_STRAINED_COLOR = 'rgba(249, 115, 22, 0.06)' // light orange tint
const ZONE_VERY_STRAINED_COLOR = 'rgba(239, 68, 68, 0.06)' // light red tint

// ── Types ─────────────────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SvgGroup = d3.Selection<any, unknown, null, undefined>

export interface TrainingLoadTrackConfig {
  /** The SVG group to draw into (already clipped). */
  chartGroup: SvgGroup
  /** Current x-scale (time -> pixels). */
  xScale: d3.ScaleTime<number, number>
  /** Hourly training load points. */
  points: TrainingLoadPoint[]
  /** Per-workout TRIMP scores. */
  workouts: WorkoutTrimp[]
  /** Whether data is in bootstrapping period (< 6 weeks). */
  bootstrapping: boolean
  /** Recovery zone thresholds (absent during bootstrapping). */
  zones?: RecoveryZones
  /** Y offset of the track (pixels from top of chart area). */
  trackY: number
  /** Height of the track in pixels. */
  trackHeight: number
  /** Bar layout for side-by-side rendering. */
  barLayout?: BarLayoutResult
  /** Slot IDs for the training load bars in the layout. */
  fatigueSlotId?: string
  impulseSlotId?: string
}

// ── Y-scale computation ───────────────────────────────────────────────────────

interface TrainingLoadYScales {
  /** Scale for ATL/CTL (always >= 0). Used for fatigue bars too. */
  yLoad: d3.ScaleLinear<number, number>
  /** Scale for TSB (can be negative). */
  yTsb: d3.ScaleLinear<number, number>
  /** Scale for impulse bars (stacked training + activity). */
  yImpulse: d3.ScaleLinear<number, number>
}

const computeYScales = (
  points: TrainingLoadPoint[],
  trackY: number,
  trackBottom: number,
  zones?: RecoveryZones,
): TrainingLoadYScales => {
  // Load scale: tight domain around actual ATL/CTL range for better visual resolution.
  // With a zero-anchored domain the curves compress into ~10% of the track when values
  // are close (e.g. CTL 5.9–6.8).  A tight domain lets small variations fill the track.
  // Zone thresholds are also included so zone bands are always visible, not squished.
  let minLoad = Infinity
  let maxLoad = -Infinity
  for (const p of points) {
    if (p.atl < minLoad) minLoad = p.atl
    if (p.ctl < minLoad) minLoad = p.ctl
    if (p.atl > maxLoad) maxLoad = p.atl
    if (p.ctl > maxLoad) maxLoad = p.ctl
  }
  // Include zone thresholds in domain so zone bands are always visible
  if (zones) {
    if (zones.balanced_min < minLoad) minLoad = zones.balanced_min
    if (zones.strained_max > maxLoad) maxLoad = zones.strained_max
  }
  if (minLoad === Infinity) minLoad = 0
  if (maxLoad === -Infinity) maxLoad = 10
  const loadPadding = Math.max((maxLoad - minLoad) * 0.25, 1)

  const yLoad = d3
    .scaleLinear()
    .domain([Math.max(0, minLoad - loadPadding), maxLoad + loadPadding])
    .range([trackBottom, trackY])

  // TSB scale: symmetric around 0
  let maxTsbAbs = 10
  for (const p of points) {
    const abs = Math.abs(p.tsb)
    if (abs > maxTsbAbs) maxTsbAbs = abs
  }

  const yTsb = d3
    .scaleLinear()
    .domain([-maxTsbAbs * 1.2, maxTsbAbs * 1.2])
    .range([trackBottom, trackY])

  // Impulse bar scale: max of stacked (training + activity) impulse
  let maxImpulse = 1
  for (const p of points) {
    const total = p.training_impulse + p.activity_impulse
    if (total > maxImpulse) maxImpulse = total
  }

  const yImpulse = d3
    .scaleLinear()
    .domain([0, maxImpulse * 1.2])
    .range([trackBottom, trackY])

  return { yImpulse, yLoad, yTsb }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

export const MS_PER_HOUR = 3600_000

const parseTime = (timeStr: string): Date => new Date(timeStr)

/**
 * Find the training load point nearest to the given time.
 * Tries exact hour match first, then falls back to nearest within tolerance.
 * Default tolerance is 2 hours; pass a larger value for weekly/daily bucketed data.
 */
export const findTrainingLoadPoint = (
  points: TrainingLoadPoint[],
  time: Date,
  maxDistanceMs: number = 2 * MS_PER_HOUR,
): TrainingLoadPoint | null => {
  const timeMs = time.getTime()
  const flooredHour = new Date(timeMs - (timeMs % MS_PER_HOUR))
  const flooredIso = flooredHour.toISOString()

  // Exact match first
  for (const p of points) {
    if (p.time === flooredIso) return p
  }

  // Fall back to nearest within tolerance
  let nearest: TrainingLoadPoint | null = null
  let bestDist = Infinity
  for (const p of points) {
    const dist = Math.abs(timeMs - parseTime(p.time).getTime())
    if (dist < bestDist) {
      bestDist = dist
      nearest = p
    }
  }

  return nearest && bestDist <= maxDistanceMs ? nearest : null
}

/**
 * Find workouts that overlap with a given hour.
 */
export const findNearbyWorkouts = (workouts: WorkoutTrimp[], hourTime: Date): WorkoutTrimp[] => {
  const hourMs = hourTime.getTime()
  return workouts.filter((w) => {
    const wStart = new Date(w.start_time).getTime()
    const wEnd = new Date(w.end_time).getTime()
    return wStart <= hourMs + MS_PER_HOUR && wEnd >= hourMs
  })
}

/** Draw recovery zone bands (horizontal stripes). */
const drawZoneBands = (
  group: SvgGroup,
  zones: RecoveryZones,
  yLoad: d3.ScaleLinear<number, number>,
  xStart: number,
  xEnd: number,
  trackY: number,
  trackBottom: number,
): void => {
  const bandWidth = xEnd - xStart

  // Undertrained: 0 to balanced_min
  const undertrainedTop = Math.max(yLoad(zones.balanced_min), trackY)
  group
    .append('rect')
    .attr('x', xStart)
    .attr('y', undertrainedTop)
    .attr('width', bandWidth)
    .attr('height', trackBottom - undertrainedTop)
    .attr('fill', ZONE_UNDERTRAINED_COLOR)
    .attr('pointer-events', 'none')

  // Balanced: balanced_min to balanced_max
  const balancedTop = Math.max(yLoad(zones.balanced_max), trackY)
  const balancedBottom = Math.min(yLoad(zones.balanced_min), trackBottom)
  group
    .append('rect')
    .attr('x', xStart)
    .attr('y', balancedTop)
    .attr('width', bandWidth)
    .attr('height', balancedBottom - balancedTop)
    .attr('fill', ZONE_BALANCED_COLOR)
    .attr('pointer-events', 'none')

  // Strained: balanced_max to strained_max
  const strainedTop = Math.max(yLoad(zones.strained_max), trackY)
  const strainedBottom = Math.min(yLoad(zones.balanced_max), trackBottom)
  group
    .append('rect')
    .attr('x', xStart)
    .attr('y', strainedTop)
    .attr('width', bandWidth)
    .attr('height', strainedBottom - strainedTop)
    .attr('fill', ZONE_STRAINED_COLOR)
    .attr('pointer-events', 'none')

  // Very Strained: above strained_max
  const veryStrainedBottom = Math.min(yLoad(zones.strained_max), trackBottom)
  group
    .append('rect')
    .attr('x', xStart)
    .attr('y', trackY)
    .attr('width', bandWidth)
    .attr('height', veryStrainedBottom - trackY)
    .attr('fill', ZONE_VERY_STRAINED_COLOR)
    .attr('pointer-events', 'none')

  // Zone labels on right edge
  const labelX = xEnd - 4
  const fontSize = '0.55rem'
  const labelOpacity = 0.35

  group
    .append('text')
    .attr('x', labelX)
    .attr('y', (undertrainedTop + trackBottom) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('fill', 'currentColor')
    .attr('font-size', fontSize)
    .attr('opacity', labelOpacity)
    .attr('pointer-events', 'none')
    .text('Undertrained')

  group
    .append('text')
    .attr('x', labelX)
    .attr('y', (balancedTop + balancedBottom) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('fill', 'currentColor')
    .attr('font-size', fontSize)
    .attr('opacity', labelOpacity)
    .attr('pointer-events', 'none')
    .text('Balanced')

  group
    .append('text')
    .attr('x', labelX)
    .attr('y', (strainedTop + strainedBottom) / 2)
    .attr('dy', '0.35em')
    .attr('text-anchor', 'end')
    .attr('fill', 'currentColor')
    .attr('font-size', fontSize)
    .attr('opacity', labelOpacity)
    .attr('pointer-events', 'none')
    .text('Strained')
}

/**
 * Draw ATL (fatigue) as filled bars per hour — Polar Recovery Status style.
 * Bar height = ATL value. Color shifts from blue (low) to orange/red (high).
 */
const drawFatigueBars = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  barDurationMs: number = MS_PER_HOUR,
  barLayout?: BarLayoutResult,
  slotId?: string,
): void => {
  // Compute bar width from x-scale and bucket duration
  const sampleTime = points[0] ? parseTime(points[0].time) : new Date()
  const nextTime = new Date(sampleTime.getTime() + barDurationMs)
  const fullBarWidth = Math.max(1, Math.abs(xScale(nextTime) - xScale(sampleTime)) - 1)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- barLayout could be missing
  const barWidth = barLayout && slotId ? fullBarWidth * barLayout.slotWidth : fullBarWidth

  // Find max ATL for color scaling
  let maxAtl = 1
  for (const p of points) {
    if (p.atl > maxAtl) maxAtl = p.atl
  }

  // Color interpolation: low fatigue (blue) → high fatigue (orange-red)
  const colorScale = d3
    .scaleLinear<string>()
    .domain([0, maxAtl * 0.5, maxAtl])
    .range([ATL_BAR_LOW_COLOR, ATL_BAR_MID_COLOR, ATL_BAR_HIGH_COLOR])
    .clamp(true)

  for (const p of points) {
    if (p.atl <= 0) continue

    const baseX = xScale(parseTime(p.time))
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- barLayout could be missing
    const x = barLayout && slotId ? baseX + fullBarWidth * barLayout.getOffset(slotId) : baseX
    const barTop = yScale(p.atl)
    const barHeight = trackBottom - barTop
    if (barHeight <= 0) continue

    group
      .append('rect')
      .attr('x', x)
      .attr('y', barTop)
      .attr('width', barWidth)
      .attr('height', barHeight)
      .attr('fill', colorScale(p.atl))
      .attr('opacity', 0.4)
      .attr('pointer-events', 'none')
  }
}

/** Draw stacked impulse bars (training + activity) per bucket. */
const drawImpulseBars = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  barDurationMs: number = MS_PER_HOUR,
  barLayout?: BarLayoutResult,
  slotId?: string,
): void => {
  // Compute bar width from x-scale and bucket duration
  const sampleTime = points[0] ? parseTime(points[0].time) : new Date()
  const nextTime = new Date(sampleTime.getTime() + barDurationMs)
  const fullBarWidth = Math.max(1, Math.abs(xScale(nextTime) - xScale(sampleTime)) - 1)
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- barLayout could be missing
  const barWidth = barLayout && slotId ? fullBarWidth * barLayout.slotWidth : fullBarWidth

  for (const p of points) {
    const total = p.training_impulse + p.activity_impulse
    if (total <= 0) continue

    const baseX = xScale(parseTime(p.time))
    // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- barLayout could be missing
    const x = barLayout && slotId ? baseX + fullBarWidth * barLayout.getOffset(slotId) : baseX

    // Activity impulse bar (bottom of stack)
    if (p.activity_impulse > 0) {
      const barTop = yScale(p.activity_impulse)
      const barHeight = trackBottom - barTop
      if (barHeight > 0) {
        group
          .append('rect')
          .attr('x', x)
          .attr('y', barTop)
          .attr('width', barWidth)
          .attr('height', barHeight)
          .attr('fill', ACTIVITY_IMPULSE_COLOR)
          .attr('opacity', 0.5)
          .attr('pointer-events', 'none')
      }
    }

    // Training impulse bar (top of stack, offset upward from activity)
    if (p.training_impulse > 0) {
      const stackBase = yScale(p.activity_impulse)
      const barTop = yScale(total)
      const barHeight = stackBase - barTop
      if (barHeight > 0) {
        group
          .append('rect')
          .attr('x', x)
          .attr('y', barTop)
          .attr('width', barWidth)
          .attr('height', barHeight)
          .attr('fill', TRAINING_IMPULSE_COLOR)
          .attr('opacity', 0.5)
          .attr('pointer-events', 'none')
      }
    }
  }
}

/** Draw CTL (fitness) area and ATL (fatigue) line.
 *  Points are anchored at the bucket midpoint for correct visual alignment. */
const drawLoadCurves = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  bootstrapping: boolean,
  barDurationMs: number,
): void => {
  if (points.length < 2) return

  const halfBucket = barDurationMs / 2
  const midX = (d: TrainingLoadPoint) => xScale(new Date(parseTime(d.time).getTime() + halfBucket))

  // CTL area (fitness) - filled below the line
  const ctlArea = d3
    .area<TrainingLoadPoint>()
    .x(midX)
    .y0(trackBottom)
    .y1((d) => yScale(d.ctl))
    .curve(d3.curveMonotoneX)

  group
    .append('path')
    .datum(points)
    .attr('d', ctlArea)
    .attr('fill', CTL_COLOR)
    .attr('fill-opacity', bootstrapping ? 0.06 : 0.12)
    .attr('pointer-events', 'none')

  // CTL line
  const ctlLine = d3
    .line<TrainingLoadPoint>()
    .x(midX)
    .y((d) => yScale(d.ctl))
    .curve(d3.curveMonotoneX)

  group
    .append('path')
    .datum(points)
    .attr('d', ctlLine)
    .attr('fill', 'none')
    .attr('stroke', CTL_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', bootstrapping ? 0.4 : 0.8)
    .attr('pointer-events', 'none')
    .attr('stroke-dasharray', bootstrapping ? '4,3' : 'none')
}

/** Draw TSB (form) as a color-coded line.
 *  Points are anchored at the bucket midpoint for correct visual alignment. */
const drawTsbLine = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  barDurationMs: number,
): void => {
  if (points.length < 2) return

  const halfBucket = barDurationMs / 2
  const midTime = (p: TrainingLoadPoint) => new Date(parseTime(p.time).getTime() + halfBucket)

  // Zero reference line
  const zeroY = yScale(0)
  group
    .append('line')
    .attr('x1', xScale(midTime(points[0]!)))
    .attr('x2', xScale(midTime(points[points.length - 1]!)))
    .attr('y1', zeroY)
    .attr('y2', zeroY)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.15)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3')
    .attr('pointer-events', 'none')

  // Draw TSB as colored line segments
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!
    const curr = points[i]!
    const color = curr.tsb >= 0 ? TSB_FRESH_COLOR : TSB_FATIGUED_COLOR

    group
      .append('line')
      .attr('x1', xScale(midTime(prev)))
      .attr('y1', yScale(prev.tsb))
      .attr('x2', xScale(midTime(curr)))
      .attr('y2', yScale(curr.tsb))
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8)
      .attr('pointer-events', 'none')
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

export const buildTrainingLoadTooltipHtml = (
  point: TrainingLoadPoint,
  workoutsNearby: WorkoutTrimp[],
  zones?: RecoveryZones,
): string => {
  const time = parseTime(point.time)
  const dateStr = format(time, 'EEE, MMM d HH:mm')

  let html = `<div class="tooltip-title">Training Load</div>`
  html += `<div class="tooltip-time">${dateStr}</div>`
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

  // Show zone if zones are available
  if (zones) {
    let zoneName: string
    if (point.atl < zones.balanced_min) zoneName = 'Undertrained'
    else if (point.atl <= zones.balanced_max) zoneName = 'Balanced'
    else if (point.atl <= zones.strained_max) zoneName = 'Strained'
    else zoneName = 'Very Strained'
    html += `<div class="tooltip-detail" style="opacity:0.7">Zone: ${zoneName}</div>`
  }

  for (const w of workoutsNearby) {
    const title = w.title ?? 'Workout'
    const hrStr = w.avg_hr ? ` (${Math.round(w.avg_hr)} bpm avg)` : ''
    html += `<div class="tooltip-detail" style="opacity:0.7">${title}: ${w.duration_minutes.toFixed(0)}min, TRIMP ${w.trimp.toFixed(0)}${hrStr}</div>`
  }

  return html
}

// ── Main draw function ────────────────────────────────────────────────────────

/**
 * Infer bucket duration from consecutive points.
 * If points are pre-bucketed (daily/weekly), the gap between them reveals the bucket size.
 * Falls back to 1 hour for hourly or single-point data.
 */
export const inferBucketDuration = (points: TrainingLoadPoint[]): number => {
  if (points.length < 2) return MS_PER_HOUR
  const t0 = parseTime(points[0]!.time).getTime()
  const t1 = parseTime(points[1]!.time).getTime()
  const gap = Math.abs(t1 - t0)
  // Snap to nearest standard bucket: 1h, 1d, 1w
  if (gap >= 6 * 24 * MS_PER_HOUR) return 7 * 24 * MS_PER_HOUR // weekly
  if (gap >= 12 * MS_PER_HOUR) return 24 * MS_PER_HOUR // daily
  return MS_PER_HOUR
}

/**
 * Draw the training load track: stacked impulse bars, CTL/ATL curves,
 * TSB line, zone bands, and an interactive crosshair overlay for tooltips.
 * Points may be hourly, daily, or weekly (pre-bucketed by backend).
 */
export const drawTrainingLoadTrack = (config: TrainingLoadTrackConfig): void => {
  const { chartGroup, xScale, points, bootstrapping, zones, trackY, trackHeight } = config

  if (points.length === 0) return

  const trackBottom = trackY + trackHeight

  // Filter to visible range (with one bucket of padding)
  const domain = xScale.domain()
  const barDurationMs = inferBucketDuration(points)
  const domainStartMs = domain[0]!.getTime() - barDurationMs
  const domainEndMs = domain[1]!.getTime() + barDurationMs
  const displayPoints = points.filter((p) => {
    const t = parseTime(p.time).getTime()
    return t >= domainStartMs && t <= domainEndMs
  })

  if (displayPoints.length === 0) return

  const yScales = computeYScales(displayPoints, trackY, trackBottom, zones)

  // Draw zone bands first (behind everything)
  if (zones) {
    const xStart = xScale(domain[0]!)
    const xEnd = xScale(domain[1]!)
    drawZoneBands(chartGroup, zones, yScales.yLoad, xStart, xEnd, trackY, trackBottom)
  }

  // Draw ATL fatigue bars (behind everything else)
  drawFatigueBars(
    chartGroup,
    displayPoints,
    xScale,
    yScales.yLoad,
    trackBottom,
    barDurationMs,
    config.barLayout,
    config.fatigueSlotId,
  )

  // Draw impulse bars (training + activity) on top of fatigue bars
  drawImpulseBars(
    chartGroup,
    displayPoints,
    xScale,
    yScales.yImpulse,
    trackBottom,
    barDurationMs,
    config.barLayout,
    config.impulseSlotId,
  )

  // Draw CTL/ATL curves (anchored at bucket midpoints)
  drawLoadCurves(chartGroup, displayPoints, xScale, yScales.yLoad, trackBottom, bootstrapping, barDurationMs)

  // Draw TSB line on top (anchored at bucket midpoints)
  drawTsbLine(chartGroup, displayPoints, xScale, yScales.yTsb, barDurationMs)
}
