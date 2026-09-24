/**
 * DST-aware bucket aggregation for training load points. Pure utilities — no
 * I/O, no DB access. Uses Temporal for correct daily/weekly bucketing across
 * spring-forward (23h) and fall-back (25h) days.
 */
import type { TrainingLoadPoint, trainingLoadBucketSizes } from '@aurboda/api-spec'

type TrainingLoadBucketSize = (typeof trainingLoadBucketSizes)[number]

/**
 * Floor a UTC epoch millisecond to the start of the local day or local Monday
 * in the given IANA timezone. Uses Temporal for DST-correct bucketing
 * (spring-forward days = 23h, fall-back days = 25h).
 */
export const floorToLocalBucket = (ms: number, bucketSize: '1d' | '1w', tz: string): number => {
  const instant = Temporal.Instant.fromEpochMilliseconds(ms)
  const zoned = instant.toZonedDateTimeISO(tz)

  if (bucketSize === '1w') {
    // Floor to local Monday 00:00
    const dayOfWeek = zoned.dayOfWeek // 1=Mon, 7=Sun
    const daysBack = dayOfWeek - 1
    const monday = zoned.subtract({ days: daysBack }).startOfDay()
    return monday.epochMilliseconds
  }

  // Floor to local midnight
  return zoned.startOfDay().epochMilliseconds
}

/**
 * Aggregate hourly training load points into larger time buckets.
 *
 * For each bucket:
 * - training_impulse, activity_impulse: summed across all hours in the bucket
 * - atl: peak value within the bucket (shows worst-case fatigue)
 * - ctl, tsb: value from the last hour in the bucket (most recent EMA state)
 * - time: floored to bucket boundary
 */
export const aggregateTrainingLoadPoints = (
  points: TrainingLoadPoint[],
  bucketSize: TrainingLoadBucketSize,
  tz: string = 'UTC',
): TrainingLoadPoint[] => {
  if (bucketSize === '1h' || points.length === 0) return points

  const buckets = new Map<number, TrainingLoadPoint[]>()

  for (const p of points) {
    const t = new Date(p.time).getTime()
    const key = floorToLocalBucket(t, bucketSize, tz)
    let arr = buckets.get(key)
    if (!arr) {
      arr = []
      buckets.set(key, arr)
    }
    arr.push(p)
  }

  const result: TrainingLoadPoint[] = []
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b)

  for (const key of sortedKeys) {
    const group = buckets.get(key)!
    const last = group[group.length - 1]!
    let totalTrainingImpulse = 0
    let totalActivityImpulse = 0
    let peakAtl = 0

    for (const p of group) {
      totalTrainingImpulse += p.training_impulse
      totalActivityImpulse += p.activity_impulse
      if (p.atl > peakAtl) peakAtl = p.atl
    }

    result.push({
      activity_impulse: Math.round(totalActivityImpulse * 100) / 100,
      atl: Math.round(peakAtl * 100) / 100,
      ctl: last.ctl,
      time: new Date(key).toISOString(),
      training_impulse: Math.round(totalTrainingImpulse * 100) / 100,
      tsb: last.tsb,
    })
  }

  return result
}
