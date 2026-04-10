/**
 * Pure utility functions for chart tooltip interactions.
 */
import type { SleepStage } from './sleep-utils'

import { STAGE_LABELS } from './sleep-utils'

/**
 * Find the nearest data point to a given time using binary search.
 * Returns the [Date, number] tuple closest to `targetTime`, or undefined if data is empty.
 */
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
 * Uses binary search + linear interpolation between bracketing points.
 */
export const interpolatePosition = (
  points: { lat: number; lon: number; time: Date }[],
  targetTime: Date,
): { lat: number; lon: number } | undefined => {
  if (points.length === 0) return undefined
  if (points.length === 1) return { lat: points[0].lat, lon: points[0].lon }

  const t = targetTime.getTime()

  // Clamp to first/last point
  if (t <= points[0].time.getTime()) return { lat: points[0].lat, lon: points[0].lon }
  if (t >= points[points.length - 1].time.getTime()) {
    const last = points[points.length - 1]
    return { lat: last.lat, lon: last.lon }
  }

  // Binary search for bracketing interval
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

/**
 * Find the sleep stage active at a given time.
 * Returns the stage label string, or undefined if no stage covers that time.
 */
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
