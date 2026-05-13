/**
 * Write path: recompute hourly impulse buckets from raw exercise + calorie
 * data and persist them to time_series. Chunked for bounded memory usage.
 *
 * Buckets are read from time_series at query time (see `query.ts`); the
 * current incomplete hour is computed on-the-fly there.
 */
import type { TimeSeriesPoint } from '../../db/types.ts'
import type { ResolvedTrainingLoadSettings } from './banister.ts'
import type { TrainingLoadDeps } from './deps.ts'

import {
  floorToHour,
  getCurrentHourStart,
  getEffectiveSettings,
  MS_PER_HOUR,
  processExercise,
  resolveHrMax,
  resolveHrRest,
} from './banister.ts'
import { getOrCacheMaxObservedHr } from './hr-cache.ts'

/** Maximum chunk size for recomputation (7 days in ms). */
const RECOMPUTE_CHUNK_MS = 7 * 24 * MS_PER_HOUR

/**
 * Recompute one chunk of impulse buckets [chunkStart, chunkEnd).
 *
 * Fetches exercises for the chunk, then HR samples per-exercise (bounded),
 * and hourly calorie sums via DB-level aggregation. This keeps memory bounded
 * regardless of how much raw data exists.
 */
const recomputeChunk = async (
  deps: TrainingLoadDeps,
  user: string,
  chunkStart: Date,
  chunkEnd: Date,
  hrMax: number,
  hrRest: number,
  settings: ResolvedTrainingLoadSettings,
): Promise<TimeSeriesPoint[]> => {
  // Fetch exercises and hourly calorie sums for this chunk
  const [exercises, hourlyCalories] = await Promise.all([
    deps.getExercises(user, chunkStart, chunkEnd),
    deps.getHourlyCalorieSums(user, chunkStart, chunkEnd),
  ])

  // For each exercise, fetch HR samples just for that session window
  const training = new Map<string, number>()
  for (const ex of exercises) {
    const sessionEnd = ex.end_time ?? new Date(ex.start_time.getTime() + MS_PER_HOUR)
    const hrSamples = await deps.getHrSamples(user, ex.start_time, sessionEnd)
    processExercise(ex, hrSamples, hrMax, hrRest, settings.k_factor, training)
  }

  // Build activity impulse map from pre-bucketed hourly calorie sums
  const activity = new Map<string, number>()
  for (const [time, kcalSum] of hourlyCalories) {
    const hourIso = floorToHour(time).toISOString()
    activity.set(hourIso, (activity.get(hourIso) ?? 0) + kcalSum * settings.activity_impulse_scale)
  }

  // Build time series points
  const points: TimeSeriesPoint[] = []

  for (const [hourIso, value] of training) {
    const hourDate = new Date(hourIso)
    if (hourDate < chunkStart || hourDate >= chunkEnd) continue
    if (value > 0) {
      points.push({
        metric: 'training_impulse',
        source: 'aurboda',
        time: hourDate,
        unit: 'TRIMP',
        value: Math.round(value * 100) / 100,
      })
    }
  }

  for (const [hourIso, value] of activity) {
    const hourDate = new Date(hourIso)
    if (hourDate < chunkStart || hourDate >= chunkEnd) continue
    if (value > 0) {
      points.push({
        metric: 'activity_impulse',
        source: 'aurboda',
        time: hourDate,
        unit: 'impulse',
        value: Math.round(value * 100) / 100,
      })
    }
  }

  return points
}

/**
 * Recompute hourly impulse buckets for a user from `fromHour` to the last completed hour.
 *
 * Processes in chunks of RECOMPUTE_CHUNK_MS to keep memory bounded.
 * For each chunk: fetches exercises, HR per-exercise, hourly calorie sums.
 * Skips the current (incomplete) hour.
 */
export const recomputeImpulseBuckets = async (
  deps: TrainingLoadDeps,
  user: string,
  fromHour: Date,
): Promise<{ hours_computed: number }> => {
  const currentHour = getCurrentHourStart()

  // Don't recompute if fromHour is in the future or the current hour
  if (fromHour >= currentHour) return { hours_computed: 0 }

  // Fetch user settings and latest resting HR in parallel.
  // Use cached observed_hr_max to avoid the expensive 1-year scan.
  const [userSettings, latestRestingHr] = await Promise.all([
    deps.getUserSettings(user),
    deps.getLatestRestingHr(user),
  ])

  // Resolve max HR with caching (blocking write since recompute is already a write operation)
  const maxObservedHr = await getOrCacheMaxObservedHr(deps, user, userSettings.training_load, false)

  const settings = getEffectiveSettings(userSettings.training_load, userSettings.sex)
  const hrMax = resolveHrMax(settings.hr_max, maxObservedHr, userSettings.birth_date)
  const hrRest = resolveHrRest(settings.hr_rest, latestRestingHr)

  // Delete old buckets in the full range upfront
  await Promise.all([
    deps.deleteImpulseBuckets(user, 'training_impulse', 'aurboda', fromHour, currentHour),
    deps.deleteImpulseBuckets(user, 'activity_impulse', 'aurboda', fromHour, currentHour),
  ])

  // Process in chunks
  let allPoints: TimeSeriesPoint[] = []
  let chunkStart = fromHour

  while (chunkStart < currentHour) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + RECOMPUTE_CHUNK_MS, currentHour.getTime()))
    const chunkPoints = await recomputeChunk(deps, user, chunkStart, chunkEnd, hrMax, hrRest, settings)

    if (chunkPoints.length > 0) {
      // Write each chunk immediately to avoid accumulating in memory
      await deps.writeImpulseBuckets(user, chunkPoints)
      allPoints = allPoints.concat(chunkPoints)
    }

    chunkStart = chunkEnd
  }

  // Clear the watermark
  await deps.updateTrainingLoadSettings(user, { impulse_watermark: undefined })

  // Count distinct hours
  const hours = new Set(allPoints.map((p) => p.time.toISOString()))
  return { hours_computed: hours.size }
}
