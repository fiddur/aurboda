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
