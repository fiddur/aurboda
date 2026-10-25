import type { SleepStage } from './sleep-utils'

import { STAGE_LABELS } from './sleep-utils'

export const MAX_RIGHT_AXES = 2

export interface AxisAssignment {
  axisSide: 'left' | 'right'
  showAxis: boolean
  offset: number
}

/**
 * The first overlay takes the left axis (whether or not it shows one) unless a
 * hypnogram already holds it; later overlays go right, where only `showAxis`
 * overlays up to the cap draw an axis, each 45px further out.
 */
export const assignAxes = (hasHypnogram: boolean, overlays: { showAxis: boolean }[]): AxisAssignment[] => {
  let rightAxisCount = 0
  return overlays.map((overlay, i) => {
    if (i === 0 && !hasHypnogram) return { axisSide: 'left', offset: 0, showAxis: overlay.showAxis }
    const showAxis = overlay.showAxis && rightAxisCount < MAX_RIGHT_AXES
    const assignment: AxisAssignment = { axisSide: 'right', offset: rightAxisCount * 45, showAxis }
    if (showAxis) rightAxisCount++
    return assignment
  })
}

export const countRightAxes = (hasHypnogram: boolean, overlays: { showAxis: boolean }[]): number =>
  assignAxes(hasHypnogram, overlays).filter((a) => a.axisSide === 'right' && a.showAxis).length

/** Keep every k-th tick so at least `minPxPerTick` lies between labels — d3's `ticks(n)` is only a hint. */
export const fitTicks = <T>(ticks: T[], availableWidth: number, minPxPerTick: number): T[] => {
  const fits = Math.max(1, Math.floor(availableWidth / minPxPerTick))
  const step = Math.ceil(ticks.length / fits)
  return step <= 1 ? ticks : ticks.filter((_, i) => i % step === 0)
}

/**
 * The right chart margin for a given number of drawn right axes: axes sit
 * 45px apart, the outermost needs ~20px more for its tick + unit labels, and
 * an axis-less chart keeps only a small breathing edge. Reserving a fixed
 * maximum instead squeezed the plot to half a phone card's width when only
 * one metric was shown (the common feed-card case).
 */
export const chartRightMargin = (rightAxes: number): number => (rightAxes === 0 ? 14 : rightAxes * 45 + 20)

export const findNearest = (data: [Date, number][], targetTime: Date): [Date, number] | undefined => {
  if (data.length === 0) return undefined
  if (data.length === 1) return data[0]

  const t = targetTime.getTime()

  let lo = 0
  let hi = data.length - 1

  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (data[mid]![0].getTime() <= t) {
      lo = mid
    } else {
      hi = mid
    }
  }

  const dLo = Math.abs(data[lo]![0].getTime() - t)
  const dHi = Math.abs(data[hi]![0].getTime() - t)
  return dLo <= dHi ? data[lo] : data[hi]
}

/**
 * Interpolate a GPS position for a given time between sorted location points.
 */
export const interpolatePosition = (
  points: { lat: number; lon: number; time: Date }[],
  targetTime: Date,
): { lat: number; lon: number } | undefined => {
  if (points.length === 0) return undefined
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon }

  const t = targetTime.getTime()

  if (t <= points[0].time.getTime()) return { lat: points[0].lat, lon: points[0].lon }
  if (t >= points[points.length - 1].time.getTime()) {
    const last = points[points.length - 1]
    return { lat: last.lat, lon: last.lon }
  }

  let lo = 0
  let hi = points.length - 1
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1
    if (points[mid].time.getTime() <= t) lo = mid
    else hi = mid
  }

  const p0 = points[lo]
  const p1 = points[hi]
  const span = p1.time.getTime() - p0.time.getTime()
  if (span === 0) return { lat: p0.lat, lon: p0.lon }

  const ratio = (t - p0.time.getTime()) / span
  return {
    lat: p0.lat + (p1.lat - p0.lat) * ratio,
    lon: p0.lon + (p1.lon - p0.lon) * ratio,
  }
}

export const findStageAtTime = (stages: SleepStage[], time: Date): string | undefined => {
  const t = time.getTime()
  for (const stage of stages) {
    const start = new Date(stage.startTime).getTime()
    const end = new Date(stage.endTime).getTime()
    if (t >= start && t < end) {
      return STAGE_LABELS[stage.stage]
    }
  }
  return undefined
}
