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

// ── Colors ────────────────────────────────────────────────────────────────────

export const CTL_COLOR = '#3b82f6' // blue (fitness)
export const ATL_COLOR = '#f97316' // orange (fatigue)
export const TSB_FRESH_COLOR = '#22c55e' // green (TSB > 0)
export const TSB_FATIGUED_COLOR = '#ef4444' // red (TSB < 0)
export const TRAINING_IMPULSE_COLOR = '#8b5cf6' // purple (exercise TRIMP)
export const ACTIVITY_IMPULSE_COLOR = '#60a5fa' // light blue (activity calories)

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
  /** The outer (static) group for crosshair overlay. */
  outerG: SvgGroup
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
  /** Chart width in pixels. */
  chartWidth: number
  /** Tooltip callback. */
  showTooltipHtml: (event: MouseEvent, html: string) => void
  hideTooltip: () => void
}

// ── Y-scale computation ───────────────────────────────────────────────────────

interface TrainingLoadYScales {
  /** Scale for ATL/CTL (always >= 0). */
  yLoad: d3.ScaleLinear<number, number>
  /** Scale for TSB (can be negative). */
  yTsb: d3.ScaleLinear<number, number>
  /** Scale for impulse bars. */
  yImpulse: d3.ScaleLinear<number, number>
}

const computeYScales = (
  points: TrainingLoadPoint[],
  trackY: number,
  trackBottom: number,
): TrainingLoadYScales => {
  // Load scale: 0 to max(ATL, CTL)
  let maxLoad = 10
  for (const p of points) {
    if (p.atl > maxLoad) maxLoad = p.atl
    if (p.ctl > maxLoad) maxLoad = p.ctl
  }

  const yLoad = d3
    .scaleLinear()
    .domain([0, maxLoad * 1.15])
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
  let maxImpulse = 10
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

const MS_PER_HOUR = 3600_000

const parseTime = (timeStr: string): Date => new Date(timeStr)

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

/** Draw stacked impulse bars (training + activity) per hour. */
const drawImpulseBars = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
): void => {
  // Compute bar width from x-scale (one hour)
  const sampleTime = points[0] ? parseTime(points[0].time) : new Date()
  const nextHour = new Date(sampleTime.getTime() + MS_PER_HOUR)
  const barWidth = Math.max(1, Math.abs(xScale(nextHour) - xScale(sampleTime)) - 1)

  for (const p of points) {
    const total = p.training_impulse + p.activity_impulse
    if (total <= 0) continue

    const x = xScale(parseTime(p.time))

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

/** Draw CTL (fitness) area and ATL (fatigue) line. */
const drawLoadCurves = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
  bootstrapping: boolean,
): void => {
  if (points.length < 2) return

  // CTL area (fitness) - filled below the line
  const ctlArea = d3
    .area<TrainingLoadPoint>()
    .x((d) => xScale(parseTime(d.time)))
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
    .x((d) => xScale(parseTime(d.time)))
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

  // ATL line (fatigue) - just a line, no area fill
  const atlLine = d3
    .line<TrainingLoadPoint>()
    .x((d) => xScale(parseTime(d.time)))
    .y((d) => yScale(d.atl))
    .curve(d3.curveMonotoneX)

  group
    .append('path')
    .datum(points)
    .attr('d', atlLine)
    .attr('fill', 'none')
    .attr('stroke', ATL_COLOR)
    .attr('stroke-width', 1.5)
    .attr('stroke-opacity', bootstrapping ? 0.4 : 0.8)
    .attr('pointer-events', 'none')
    .attr('stroke-dasharray', bootstrapping ? '4,3' : 'none')
}

/** Draw TSB (form) as a color-coded line. */
const drawTsbLine = (
  group: SvgGroup,
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
): void => {
  if (points.length < 2) return

  // Zero reference line
  const zeroY = yScale(0)
  group
    .append('line')
    .attr('x1', xScale(parseTime(points[0]!.time)))
    .attr('x2', xScale(parseTime(points[points.length - 1]!.time)))
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
      .attr('x1', xScale(parseTime(prev.time)))
      .attr('y1', yScale(prev.tsb))
      .attr('x2', xScale(parseTime(curr.time)))
      .attr('y2', yScale(curr.tsb))
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8)
      .attr('pointer-events', 'none')
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const buildTrainingLoadTooltipHtml = (
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

// ── Crosshair overlay ─────────────────────────────────────────────────────────

const drawCrosshairOverlay = (
  outerG: SvgGroup,
  xScale: d3.ScaleTime<number, number>,
  points: TrainingLoadPoint[],
  workouts: WorkoutTrimp[],
  zones: RecoveryZones | undefined,
  trackY: number,
  trackHeight: number,
  chartWidth: number,
  showTooltipHtml: (event: MouseEvent, html: string) => void,
  hideTooltip: () => void,
): void => {
  outerG.selectAll('.training-load-crosshair').remove()

  const crosshairGroup = outerG.append('g').attr('class', 'training-load-crosshair')
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

      // Find nearest hourly point
      let nearest: TrainingLoadPoint | null = null
      let bestDist = Infinity
      for (const p of points) {
        const dist = Math.abs(hoverTime.getTime() - parseTime(p.time).getTime())
        if (dist < bestDist) {
          bestDist = dist
          nearest = p
        }
      }

      if (!nearest || bestDist > 2 * MS_PER_HOUR) {
        hairline.style('display', 'none')
        hideTooltip()
        return
      }

      hairline.attr('x1', mx!).attr('x2', mx!).style('display', null)

      // Find workouts near this hour (within 1 hour)
      const nearestTime = parseTime(nearest.time).getTime()
      const nearbyWorkouts = workouts.filter((w) => {
        const wStart = new Date(w.start_time).getTime()
        const wEnd = new Date(w.end_time).getTime()
        return wStart <= nearestTime + MS_PER_HOUR && wEnd >= nearestTime
      })

      const html = buildTrainingLoadTooltipHtml(nearest, nearbyWorkouts, zones)
      showTooltipHtml(event, html)
    })
    .on('mouseleave', () => {
      hairline.style('display', 'none')
      hideTooltip()
    })
}

// ── Downsampling ──────────────────────────────────────────────────────────────

/**
 * Downsample hourly points for rendering when zoomed out far.
 * Groups consecutive hours and picks the one with highest combined impulse
 * from each group, preserving the ATL/CTL/TSB curves at reduced resolution.
 */
const downsamplePoints = (
  points: TrainingLoadPoint[],
  xScale: d3.ScaleTime<number, number>,
  minPixelGap: number,
): TrainingLoadPoint[] => {
  if (points.length <= 2) return points

  const result: TrainingLoadPoint[] = []
  let groupStart = 0

  for (let i = 1; i <= points.length; i++) {
    const atEnd = i === points.length
    const gapPx =
      atEnd ? Infinity : (
        Math.abs(xScale(parseTime(points[i]!.time)) - xScale(parseTime(points[groupStart]!.time)))
      )

    if (gapPx >= minPixelGap || atEnd) {
      // Pick the point in [groupStart, i) with highest total impulse
      let best = points[groupStart]!
      let bestImpulse = best.training_impulse + best.activity_impulse
      for (let j = groupStart + 1; j < i; j++) {
        const total = points[j]!.training_impulse + points[j]!.activity_impulse
        if (total > bestImpulse) {
          bestImpulse = total
          best = points[j]!
        }
      }
      result.push(best)
      groupStart = i
    }
  }

  return result
}

// ── Main draw function ────────────────────────────────────────────────────────

/**
 * Draw the training load track: hourly stacked impulse bars, CTL/ATL curves,
 * TSB line, zone bands, and an interactive crosshair overlay for tooltips.
 */
export const drawTrainingLoadTrack = (config: TrainingLoadTrackConfig): void => {
  const {
    chartGroup,
    outerG,
    xScale,
    points,
    workouts,
    bootstrapping,
    zones,
    trackY,
    trackHeight,
    chartWidth,
    showTooltipHtml,
    hideTooltip,
  } = config

  if (points.length === 0) return

  const trackBottom = trackY + trackHeight

  // Filter to visible range
  const domain = xScale.domain()
  const domainStartMs = domain[0]!.getTime() - MS_PER_HOUR
  const domainEndMs = domain[1]!.getTime() + MS_PER_HOUR
  const visiblePoints = points.filter((p) => {
    const t = parseTime(p.time).getTime()
    return t >= domainStartMs && t <= domainEndMs
  })

  if (visiblePoints.length === 0) return

  // Downsample when zoomed out far (more than ~2000 visible points)
  const displayPoints = downsamplePoints(visiblePoints, xScale, 2)

  const yScales = computeYScales(displayPoints, trackY, trackBottom)

  // Draw zone bands first (behind everything)
  if (zones) {
    const xStart = xScale(domain[0]!)
    const xEnd = xScale(domain[1]!)
    drawZoneBands(chartGroup, zones, yScales.yLoad, xStart, xEnd, trackY, trackBottom)
  }

  // Draw impulse bars (behind curves)
  drawImpulseBars(chartGroup, displayPoints, xScale, yScales.yImpulse, trackBottom)

  // Draw CTL/ATL curves
  drawLoadCurves(chartGroup, displayPoints, xScale, yScales.yLoad, trackBottom, bootstrapping)

  // Draw TSB line on top
  drawTsbLine(chartGroup, displayPoints, xScale, yScales.yTsb)

  // Crosshair tooltip overlay (uses full points for accurate snapping)
  drawCrosshairOverlay(
    outerG,
    xScale,
    visiblePoints,
    workouts,
    zones,
    trackY,
    trackHeight,
    chartWidth,
    showTooltipHtml,
    hideTooltip,
  )
}
