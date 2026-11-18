/**
 * Write path: recompute hourly impulse buckets from raw exercise + calorie
 * data and persist them to time_series. Chunked for bounded memory usage.
 *
 * Buckets are read from time_series at query time (see `query.ts`); the
 * current incomplete hour is computed on-the-fly there.
 */
import type { Activity, TimeSeriesPoint } from '../../db/types.ts'
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

/** Version of the rules the stored impulse buckets follow; a user's buckets from a lower one are recomputed. */
export const IMPULSE_VERSION = 3

/**
 * Chunk size for recomputation (28 days in ms). A chunk holds its hourly calorie sums and the HR
 * samples of its workouts only, so memory stays small; progress is stored after each chunk.
 */
const RECOMPUTE_CHUNK_MS = 28 * 24 * MS_PER_HOUR

/** The HR window read for an exercise; one without an end counts as an hour long. */
export const exerciseWindow = (ex: Activity): { start: Date; end: Date } => ({
  end: ex.end_time ?? new Date(ex.start_time.getTime() + MS_PER_HOUR),
  start: ex.start_time,
})

/**
 * Recompute one chunk of impulse buckets [chunkStart, chunkEnd).
 *
 * Fetches exercises for the chunk, then HR samples for all their windows in one query (bounded),
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
  const [exercises, hourlyCalories] = await Promise.all([
    deps.getExercises(user, chunkStart, chunkEnd),
    deps.getHourlyCalorieSums(user, chunkStart, chunkEnd),
  ])

  const hrPerExercise =
    exercises.length > 0 ? await deps.getHrSamplesForWindows(user, exercises.map(exerciseWindow)) : []
  const training = new Map<string, number>()
  exercises.forEach((ex, i) => {
    processExercise(ex, hrPerExercise[i] ?? [], hrMax, hrRest, settings.k_factor, training)
  })

  const activity = new Map<string, number>()
  for (const [time, kcalSum] of hourlyCalories) {
    const hourIso = floorToHour(time).toISOString()
    activity.set(hourIso, (activity.get(hourIso) ?? 0) + kcalSum * settings.activity_impulse_scale)
  }

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
 * Stores that everything before `chunkEnd` is recomputed and returns where to continue. A watermark
 * earlier than `chunkStart` means older data was marked dirty during the run: it is kept and the run
 * continues from there.
 */
const advanceWatermark = async (
  deps: TrainingLoadDeps,
  user: string,
  chunkStart: Date,
  chunkEnd: Date,
  currentHour: Date,
): Promise<Date> => {
  const stored = (await deps.getUserSettings(user)).training_load?.impulse_watermark
  if (stored && new Date(stored) < chunkStart) return floorToHour(new Date(stored))
  await deps.updateTrainingLoadSettings(user, {
    impulse_watermark: chunkEnd >= currentHour ? undefined : chunkEnd.toISOString(),
  })
  return chunkEnd
}

/**
 * Recompute hourly impulse buckets for a user from `fromHour` to the last completed hour, one chunk
 * at a time: each chunk replaces its own buckets and then moves the watermark past it, so an
 * interrupted run resumes where it stopped and the other hours stay readable meanwhile.
 *
 * Skips the current (incomplete) hour.
 */
export const recomputeImpulseBuckets = async (
  deps: TrainingLoadDeps,
  user: string,
  fromHour: Date,
): Promise<{ hours_computed: number }> => {
  const currentHour = getCurrentHourStart()

  if (fromHour >= currentHour) {
    const { training_load } = await deps.getUserSettings(user)
    if (training_load?.impulse_watermark) {
      await deps.updateTrainingLoadSettings(user, { impulse_watermark: undefined })
    }
    return { hours_computed: 0 }
  }

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

  let hoursComputed = 0
  let chunkStart = fromHour

  while (chunkStart < currentHour) {
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + RECOMPUTE_CHUNK_MS, currentHour.getTime()))
    const chunkPoints = await recomputeChunk(deps, user, chunkStart, chunkEnd, hrMax, hrRest, settings)

    await Promise.all([
      deps.deleteImpulseBuckets(user, 'training_impulse', 'aurboda', chunkStart, chunkEnd),
      deps.deleteImpulseBuckets(user, 'activity_impulse', 'aurboda', chunkStart, chunkEnd),
    ])
    if (chunkPoints.length > 0) {
      await deps.writeImpulseBuckets(user, chunkPoints)
      hoursComputed += new Set(chunkPoints.map((p) => p.time.getTime())).size
    }

    chunkStart = await advanceWatermark(deps, user, chunkStart, chunkEnd, currentHour)
  }

  return { hours_computed: hoursComputed }
}
