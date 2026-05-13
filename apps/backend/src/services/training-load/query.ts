/**
 * Read path for training load: combines pre-computed impulse buckets with the
 * current incomplete hour, runs the hourly Banister EMA, and aggregates into
 * the requested bucket size. Triggers a recompute if the impulse watermark is
 * dirty or no buckets exist (auto-bootstrap).
 */
import type { TrainingLoadResult, trainingLoadBucketSizes, WorkoutTrimp } from '@aurboda/api-spec'

import type { TrainingLoadDeps } from './deps.ts'

import { aggregateTrainingLoadPoints } from './aggregation.ts'
import {
  BOOTSTRAPPING_DAYS,
  computeHourlyImpulses,
  computeHourlyLoadSeries,
  computeRecoveryZones,
  floorToHour,
  getCurrentHourStart,
  getEffectiveSettings,
  HOURS_PER_DAY,
  MS_PER_HOUR,
  processExercise,
  resolveHrMax,
  resolveHrRest,
  type ResolvedTrainingLoadSettings,
} from './banister.ts'
import { getOrCacheMaxObservedHr } from './hr-cache.ts'
import { recomputeImpulseBuckets } from './recompute.ts'

type TrainingLoadBucketSize = (typeof trainingLoadBucketSizes)[number]

/**
 * Compute the current incomplete hour on-the-fly and merge into impulse maps.
 */
const mergeLiveHourImpulses = async (
  deps: TrainingLoadDeps,
  user: string,
  queryEnd: Date,
  currentHour: Date,
  hrMax: number,
  hrRest: number,
  settings: ResolvedTrainingLoadSettings,
  trainingImpulses: Map<string, number>,
  activityImpulses: Map<string, number>,
): Promise<void> => {
  const now = new Date()
  if (queryEnd < currentHour || now <= currentHour) return

  const nextHour = new Date(currentHour.getTime() + MS_PER_HOUR)
  const [exercises, hrSamples, calories] = await Promise.all([
    deps.getExercises(user, currentHour, nextHour),
    deps.getHrSamples(user, currentHour, nextHour),
    deps.getActiveCalories(user, currentHour, nextHour),
  ])

  const liveImpulses = computeHourlyImpulses(
    exercises,
    hrSamples,
    calories,
    hrMax,
    hrRest,
    settings.k_factor,
    settings.activity_impulse_scale,
    currentHour,
    nextHour,
  )

  for (const [hourIso, value] of liveImpulses.training) {
    trainingImpulses.set(hourIso, (trainingImpulses.get(hourIso) ?? 0) + value)
  }
  for (const [hourIso, value] of liveImpulses.activity) {
    activityImpulses.set(hourIso, (activityImpulses.get(hourIso) ?? 0) + value)
  }
}

/**
 * Build the workout list for the response (exercise sessions with TRIMP scores).
 */
const buildWorkoutList = async (
  deps: TrainingLoadDeps,
  user: string,
  start: Date,
  end: Date,
  hrMax: number,
  hrRest: number,
  kFactor: number,
): Promise<WorkoutTrimp[]> => {
  const exercises = await deps.getExercises(user, start, end)
  if (exercises.length === 0) return []

  // Fetch HR samples per exercise session in parallel (not the whole range)
  // — avoids pulling months of 5-minute HR data when only a few sessions need it
  const hrPerExercise = await Promise.all(
    exercises.map((ex) => {
      const sessionEnd = ex.end_time ?? new Date(ex.start_time.getTime() + MS_PER_HOUR)
      return deps.getHrSamples(user, ex.start_time, sessionEnd)
    }),
  )

  const training = new Map<string, number>() // throwaway, just for reusing processExercise
  const workoutList: WorkoutTrimp[] = []
  for (let i = 0; i < exercises.length; i++) {
    const workout = processExercise(exercises[i]!, hrPerExercise[i]!, hrMax, hrRest, kFactor, training)
    if (workout) workoutList.push(workout)
  }
  return workoutList
}

/**
 * Compute training load time series for a user and date range.
 *
 * 1. Check if impulse buckets need recomputation (watermark)
 * 2. Fetch pre-computed hourly impulse buckets
 * 3. Compute current incomplete hour from raw data
 * 4. Run hourly Banister EMA → ATL, CTL, TSB
 * 5. Optionally aggregate into larger buckets (daily/weekly)
 * 6. Compute recovery zones
 */
export const computeTrainingLoad = async (
  deps: TrainingLoadDeps,
  user: string,
  start: Date,
  end: Date,
  bucketSize: TrainingLoadBucketSize = '1h',
  tz: string = 'UTC',
): Promise<TrainingLoadResult> => {
  // Gather settings and latest resting HR in parallel.
  const [userSettings, latestRestingHr] = await Promise.all([
    deps.getUserSettings(user),
    deps.getLatestRestingHr(user),
  ])

  const maxObservedHr = await getOrCacheMaxObservedHr(deps, user, userSettings.training_load)

  const settings = getEffectiveSettings(userSettings.training_load, userSettings.sex)
  const hrMax = resolveHrMax(settings.hr_max, maxObservedHr, userSettings.birth_date)
  const hrRest = resolveHrRest(settings.hr_rest, latestRestingHr)

  // Start building the workout list early — it only needs settings, not impulse buckets.
  // Runs in parallel with watermark recompute + impulse fetch + EMA.
  const workoutListPromise = buildWorkoutList(deps, user, start, end, hrMax, hrRest, settings.k_factor)

  // Extended range for EMA bootstrapping (3 × tau_chronic in hours)
  const lookbackHours = Math.ceil(settings.tau_chronic * 3 * HOURS_PER_DAY)
  const extendedStart = new Date(start.getTime() - lookbackHours * MS_PER_HOUR)
  const extendedStartHour = floorToHour(extendedStart)

  const currentHour = getCurrentHourStart()
  const effectiveEnd = end > currentHour ? currentHour : floorToHour(end)

  // Check watermark — if dirty, recompute before querying
  const watermark = userSettings.training_load?.impulse_watermark
  if (watermark) {
    const fromHour = floorToHour(new Date(watermark))
    await recomputeImpulseBuckets(deps, user, fromHour)
  }

  // Fetch pre-computed impulse buckets for the extended range
  let [trainingBuckets, activityBuckets] = await Promise.all([
    deps.getImpulseBuckets(user, 'training_impulse', extendedStartHour, effectiveEnd),
    deps.getImpulseBuckets(user, 'activity_impulse', extendedStartHour, effectiveEnd),
  ])

  // Auto-bootstrap: if no watermark was set and no impulse buckets exist,
  // trigger a full recompute from the extended start range
  if (!watermark && trainingBuckets.length === 0 && activityBuckets.length === 0) {
    await recomputeImpulseBuckets(deps, user, extendedStartHour)
    ;[trainingBuckets, activityBuckets] = await Promise.all([
      deps.getImpulseBuckets(user, 'training_impulse', extendedStartHour, effectiveEnd),
      deps.getImpulseBuckets(user, 'activity_impulse', extendedStartHour, effectiveEnd),
    ])
  }

  // Build maps from stored buckets
  const trainingImpulses = new Map<string, number>()
  for (const [time, value] of trainingBuckets) {
    trainingImpulses.set(floorToHour(time).toISOString(), value)
  }

  const activityImpulses = new Map<string, number>()
  for (const [time, value] of activityBuckets) {
    activityImpulses.set(floorToHour(time).toISOString(), value)
  }

  // Compute current incomplete hour on-the-fly
  await mergeLiveHourImpulses(
    deps,
    user,
    end,
    currentHour,
    hrMax,
    hrRest,
    settings,
    trainingImpulses,
    activityImpulses,
  )

  // Run hourly Banister EMA
  const allPoints = computeHourlyLoadSeries({
    activityImpulses,
    end: effectiveEnd,
    start: extendedStartHour,
    tauAcuteDays: settings.tau_acute,
    tauChronicDays: settings.tau_chronic,
    trainingImpulses,
  })

  // Filter to requested range, then aggregate if needed
  const startIso = floorToHour(start).toISOString()
  const endIso = effectiveEnd.toISOString()
  const hourlyPoints = allPoints.filter((p) => p.time >= startIso && p.time <= endIso)
  const points = aggregateTrainingLoadPoints(hourlyPoints, bucketSize, tz)

  // Await the workout list (started earlier, runs in parallel)
  const workoutList = await workoutListPromise

  // Determine bootstrapping status
  const totalHours = allPoints.length
  const bootstrapping = totalHours < BOOTSTRAPPING_DAYS * HOURS_PER_DAY

  // Compute recovery zones from the full extended series
  const zones = computeRecoveryZones(allPoints)

  return {
    bootstrapping,
    points,
    settings: {
      ...settings,
      hr_max: hrMax,
      hr_rest: hrRest,
    },
    workouts: workoutList,
    zones,
  }
}
