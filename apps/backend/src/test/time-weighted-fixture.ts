import type { TimeSeriesPoint } from '../db/types.ts'

export const FIXTURE_DAY = '2026-01-10'

const MINUTE_MS = 60_000
const dayStart = Date.parse(`${FIXTURE_DAY}T00:00:00Z`)
const sessionStart = dayStart + 10 * 60 * MINUTE_MS
const sessionEnd = sessionStart + 60 * MINUTE_MS

export const at = (time: string): Date => new Date(`${FIXTURE_DAY}T${time}Z`)

/**
 * One day of `metric` at one sample per 3 minutes (value 20), except 10:00–11:00, a recorded hour at
 * 1 Hz (value 80): 460 sparse samples and 3600 dense ones.
 */
export const unevenlySampledDay = (metric: string): TimeSeriesPoint[] => {
  const points: TimeSeriesPoint[] = []
  for (let t = dayStart; t < dayStart + 24 * 60 * MINUTE_MS; t += 3 * MINUTE_MS) {
    if (t >= sessionStart && t < sessionEnd) continue
    points.push({ metric, source: 'garmin', time: new Date(t), value: 20 })
  }
  for (let t = sessionStart; t < sessionEnd; t += 1000) {
    points.push({ metric, source: 'garmin', time: new Date(t), value: 80 })
  }
  return points
}

export const FIXTURE_COUNT = 4060
export const FIXTURE_SUM = 460 * 20 + 3600 * 80
/** Pooled over samples the day reads ~73.2; the recorded hour is 12 of the day's 288 bins. */
export const FIXTURE_POOLED_MEAN = FIXTURE_SUM / FIXTURE_COUNT
export const FIXTURE_TIME_WEIGHTED_MEAN = (12 * 80 + 276 * 20) / 288
export const FIXTURE_TIME_WEIGHTED_STDDEV = Math.sqrt((1 / 24) * (23 / 24) * 60 ** 2)
