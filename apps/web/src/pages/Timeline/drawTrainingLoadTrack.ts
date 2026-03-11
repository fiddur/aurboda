/**
 * Draws the training load track in horizontal timeline mode.
 *
 * Renders:
 * - CTL (Chronic Training Load / fitness) as a blue area
 * - ATL (Acute Training Load / fatigue) as an orange area
 * - TSB (Training Stress Balance / form) as a green/red line
 * - TRIMP impulse bars for individual workouts
 * - Zero line for TSB reference
 */
import type { TrainingLoadPoint, WorkoutTrimp } from '@aurboda/api-spec'
import * as d3 from 'd3'
import { format } from 'date-fns'

// ── Colors ────────────────────────────────────────────────────────────────────

export const CTL_COLOR = '#3b82f6' // blue
export const ATL_COLOR = '#f97316' // orange
export const TSB_FRESH_COLOR = '#22c55e' // green (TSB > 0)
export const TSB_FATIGUED_COLOR = '#ef4444' // red (TSB < 0)
export const TRIMP_COLOR = '#8b5cf6' // purple

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
  /** Daily training load points. */
  points: TrainingLoadPoint[]
  /** Per-workout TRIMP scores. */
  workouts: WorkoutTrimp[]
  /** Whether data is in bootstrapping period (< 6 weeks). */
  bootstrapping: boolean
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
  /** Scale for TRIMP bars. */
  yTrimp: d3.ScaleLinear<number, number>
}

const computeYScales = (
  points: TrainingLoadPoint[],
  workouts: WorkoutTrimp[],
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

  // TRIMP bar scale
  let maxTrimp = 10
  for (const w of workouts) {
    if (w.trimp > maxTrimp) maxTrimp = w.trimp
  }

  const yTrimp = d3
    .scaleLinear()
    .domain([0, maxTrimp * 1.2])
    .range([trackBottom, trackY])

  return { yLoad, yTrimp, yTsb }
}

// ── Drawing ───────────────────────────────────────────────────────────────────

const parseDate = (dateStr: string): Date => new Date(dateStr + 'T12:00:00')

/** Draw CTL/ATL area charts. */
const drawLoadAreas = (
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
    .x((d) => xScale(parseDate(d.date)))
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
    .x((d) => xScale(parseDate(d.date)))
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
    .x((d) => xScale(parseDate(d.date)))
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
    .attr('x1', xScale(parseDate(points[0].date)))
    .attr('x2', xScale(parseDate(points[points.length - 1].date)))
    .attr('y1', zeroY)
    .attr('y2', zeroY)
    .attr('stroke', 'currentColor')
    .attr('stroke-opacity', 0.15)
    .attr('stroke-width', 1)
    .attr('stroke-dasharray', '3,3')
    .attr('pointer-events', 'none')

  // Split into positive (fresh) and negative (fatigued) segments
  // Draw as gradient line using segments
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]
    const curr = points[i]
    const color = curr.tsb >= 0 ? TSB_FRESH_COLOR : TSB_FATIGUED_COLOR

    group
      .append('line')
      .attr('x1', xScale(parseDate(prev.date)))
      .attr('y1', yScale(prev.tsb))
      .attr('x2', xScale(parseDate(curr.date)))
      .attr('y2', yScale(curr.tsb))
      .attr('stroke', color)
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.8)
      .attr('pointer-events', 'none')
  }
}

/** Draw TRIMP impulse bars for individual workouts. */
const drawTrimpBars = (
  group: SvgGroup,
  workouts: WorkoutTrimp[],
  xScale: d3.ScaleTime<number, number>,
  yScale: d3.ScaleLinear<number, number>,
  trackBottom: number,
): void => {
  for (const w of workouts) {
    const x = xScale(parseDate(w.date))
    const barTop = yScale(w.trimp)
    const barHeight = trackBottom - barTop

    if (barHeight <= 0) continue

    group
      .append('rect')
      .attr('x', x - 2)
      .attr('y', barTop)
      .attr('width', 4)
      .attr('height', barHeight)
      .attr('fill', TRIMP_COLOR)
      .attr('opacity', 0.4)
      .attr('rx', 1)
      .attr('pointer-events', 'none')
  }
}

// ── Tooltip ───────────────────────────────────────────────────────────────────

const buildTrainingLoadTooltipHtml = (point: TrainingLoadPoint, workoutsOnDay: WorkoutTrimp[]): string => {
  const dateStr = format(parseDate(point.date), 'EEE, MMM d')

  let html = `<div class="tooltip-title">Training Load</div>`
  html += `<div class="tooltip-time">${dateStr}</div>`
  html += `<div class="tooltip-detail" style="color:${CTL_COLOR}">Fitness (CTL): ${point.ctl.toFixed(1)}</div>`
  html += `<div class="tooltip-detail" style="color:${ATL_COLOR}">Fatigue (ATL): ${point.atl.toFixed(1)}</div>`

  const tsbColor = point.tsb >= 0 ? TSB_FRESH_COLOR : TSB_FATIGUED_COLOR
  const tsbLabel = point.tsb >= 0 ? 'Fresh' : 'Fatigued'
  html += `<div class="tooltip-detail" style="color:${tsbColor}">Form (TSB): ${point.tsb >= 0 ? '+' : ''}${point.tsb.toFixed(1)} — ${tsbLabel}</div>`

  if (point.daily_trimp > 0) {
    html += `<div class="tooltip-detail" style="color:${TRIMP_COLOR}">TRIMP: ${point.daily_trimp.toFixed(0)}</div>`
  }

  for (const w of workoutsOnDay) {
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

      // Find nearest daily point
      let nearest: TrainingLoadPoint | null = null
      let bestDist = Infinity
      for (const p of points) {
        const dist = Math.abs(hoverTime.getTime() - parseDate(p.date).getTime())
        if (dist < bestDist) {
          bestDist = dist
          nearest = p
        }
      }

      if (!nearest || bestDist > 2 * 24 * 60 * 60 * 1000) {
        hairline.style('display', 'none')
        hideTooltip()
        return
      }

      hairline.attr('x1', mx!).attr('x2', mx!).style('display', null)
      const dayWorkouts = workouts.filter((w) => w.date === nearest!.date)
      const html = buildTrainingLoadTooltipHtml(nearest, dayWorkouts)
      showTooltipHtml(event, html)
    })
    .on('mouseleave', () => {
      hairline.style('display', 'none')
      hideTooltip()
    })
}

// ── Main draw function ────────────────────────────────────────────────────────

/**
 * Draw the training load track: TRIMP bars, CTL/ATL areas, TSB line,
 * and an interactive crosshair overlay for tooltips.
 */
export const drawTrainingLoadTrack = (config: TrainingLoadTrackConfig): void => {
  const {
    chartGroup,
    outerG,
    xScale,
    points,
    workouts,
    bootstrapping,
    trackY,
    trackHeight,
    chartWidth,
    showTooltipHtml,
    hideTooltip,
  } = config

  if (points.length === 0) return

  const trackBottom = trackY + trackHeight
  const yScales = computeYScales(points, workouts, trackY, trackBottom)

  // Draw TRIMP bars first (behind lines)
  drawTrimpBars(chartGroup, workouts, xScale, yScales.yTrimp, trackBottom)

  // Draw CTL/ATL areas
  drawLoadAreas(chartGroup, points, xScale, yScales.yLoad, trackBottom, bootstrapping)

  // Draw TSB line on top
  drawTsbLine(chartGroup, points, xScale, yScales.yTsb)

  // Crosshair tooltip overlay
  drawCrosshairOverlay(
    outerG,
    xScale,
    points,
    workouts,
    trackY,
    trackHeight,
    chartWidth,
    showTooltipHtml,
    hideTooltip,
  )
}
