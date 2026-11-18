/**
 * Read path for training load: combines pre-computed impulse buckets with the
 * current incomplete hour, runs the hourly Banister EMA, and aggregates into
 * the requested bucket size. Triggers a recompute if the impulse watermark is
 * dirty or no buckets exist (auto-bootstrap), and waits for it only briefly.
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
  summarizeImpulseBasis,
} from './banister.ts'
import { getOrCacheMaxObservedHr } from './hr-cache.ts'
import { finishedWithin, startOrJoinRecompute } from './recompute-run.ts'
import { exerciseWindow, IMPULSE_VERSION } from './recompute.ts'

type TrainingLoadBucketSize = (typeof trainingLoadBucketSizes)[number]

const BOOTSTRAP_MEMO_MS = 60 * 60 * 1000

/** Also drops expired entries, which keeps the process-global memo bounded. */
const rememberBootstrap = (
  memo: TrainingLoadDeps['bootstrappedFrom'],
  user: string,
  now: number,
  fromHour: number,
) => {
  for (const [memoUser, entry] of memo) {
    if (now - entry.at >= BOOTSTRAP_MEMO_MS) memo.delete(memoUser)
  }
  memo.set(user, { at: now, fromHour })
}

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

  // Only the sessions' own windows, not the whole range: months of 5-minute HR data would be wasted
  const [hrPerExercise, displayNames] = await Promise.all([
    deps.getHrSamplesForWindows(user, exercises.map(exerciseWindow)),
    deps.getActivityTypeDisplayNames(user),
  ])

  const training = new Map<string, number>() // throwaway, just for reusing processExercise
  const workoutList: WorkoutTrimp[] = []
  for (let i = 0; i < exercises.length; i++) {
    const workout = processExercise(exercises[i]!, hrPerExercise[i]!, hrMax, hrRest, kFactor, training)
    if (workout) workoutList.push(withTypeTitle(workout, displayNames))
  }
  return workoutList
}

/** An untitled workout is named after its type, except the generic `exercise`, which the web shows as "Workout". */
const withTypeTitle = (workout: WorkoutTrimp, displayNames: Map<string, string>): WorkoutTrimp => {
  if (workout.title || workout.activity_type === 'exercise') return workout
  const title = displayNames.get(workout.activity_type)
  return title ? { ...workout, title } : workout
}

const earlierIso = (a: string | undefined, b: Date | undefined): string | undefined => {
  if (!b) return a
  if (!a) return b.toISOString()
  return new Date(a) <= b ? a : b.toISOString()
}

/**
 * Buckets stored under an older IMPULSE_VERSION are marked dirty from the first workout. Version and
 * watermark are persisted before the recompute, so an interrupted one resumes on the next read.
 * Returns the watermark to recompute from.
 */
const markOutdatedImpulses = async (
  deps: TrainingLoadDeps,
  user: string,
  watermark: string | undefined,
  version: number | undefined,
): Promise<string | undefined> => {
  if ((version ?? 0) >= IMPULSE_VERSION) return watermark
  const dirtyFrom = earlierIso(watermark, await deps.getEarliestExerciseStart(user))
  await deps.updateTrainingLoadSettings(user, {
    impulse_version: IMPULSE_VERSION,
    ...(dirtyFrom ? { impulse_watermark: dirtyFrom } : {}),
  })
  return dirtyFrom
}

type ImpulseBuckets = [Date, number][]

/**
 * The stored training and activity buckets in [from, to], after a recompute that the watermark, a
 * run in flight or an auto-bootstrap asks for; undefined while that recompute outlasts the wait.
 */
const readStoredImpulses = async (
  deps: TrainingLoadDeps,
  user: string,
  watermark: string | undefined,
  from: Date,
  to: Date,
): Promise<[ImpulseBuckets, ImpulseBuckets] | undefined> => {
  const recomputeInTime = (fromHour: Date) =>
    finishedWithin(startOrJoinRecompute(deps, user, fromHour), deps.recomputeWaitMs)
  const read = () =>
    Promise.all([
      deps.getImpulseBuckets(user, 'training_impulse', from, to),
      deps.getImpulseBuckets(user, 'activity_impulse', from, to),
    ])

  if (watermark || deps.recomputing.has(user)) {
    const fromHour = watermark ? floorToHour(new Date(watermark)) : from
    if (!(await recomputeInTime(fromHour))) return undefined
  }

  const buckets = await read()

  // Auto-bootstrap: if no watermark was set and no impulse buckets exist,
  // trigger a full recompute from the extended start range. A user without data
  // gets nothing written, so a bootstrap that already covered this range is not
  // repeated — for an hour, since not every ingestion path sets the watermark.
  const covered = deps.bootstrappedFrom.get(user)
  const now = Date.now()
  const alreadyCovered =
    covered !== undefined && now - covered.at < BOOTSTRAP_MEMO_MS && from.getTime() >= covered.fromHour
  if (watermark || buckets[0].length > 0 || buckets[1].length > 0 || alreadyCovered) return buckets

  if (!(await recomputeInTime(from))) return undefined
  rememberBootstrap(deps.bootstrappedFrom, user, now, from.getTime())
  return read()
}

export const computeTrainingLoad = async (
  deps: TrainingLoadDeps,
  user: string,
  start: Date,
  end: Date,
  bucketSize: TrainingLoadBucketSize = '1h',
  tz: string = 'UTC',
): Promise<TrainingLoadResult> => {
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

  const watermark = await markOutdatedImpulses(
    deps,
    user,
    userSettings.training_load?.impulse_watermark,
    userSettings.training_load?.impulse_version,
  )
  const resolvedSettings = { ...settings, hr_max: hrMax, hr_rest: hrRest }
  const stored = await readStoredImpulses(deps, user, watermark, extendedStartHour, effectiveEnd)
  if (!stored) {
    const workoutList = await workoutListPromise
    return {
      bootstrapping: false,
      estimated_impulse: summarizeImpulseBasis(workoutList),
      points: [],
      recomputing: true,
      settings: resolvedSettings,
      workouts: workoutList,
    }
  }
  const [trainingBuckets, activityBuckets] = stored

  const trainingImpulses = new Map<string, number>()
  for (const [time, value] of trainingBuckets) {
    trainingImpulses.set(floorToHour(time).toISOString(), value)
  }

  const activityImpulses = new Map<string, number>()
  for (const [time, value] of activityBuckets) {
    activityImpulses.set(floorToHour(time).toISOString(), value)
  }

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

  const allPoints = computeHourlyLoadSeries({
    activityImpulses,
    end: effectiveEnd,
    start: extendedStartHour,
    tauAcuteDays: settings.tau_acute,
    tauChronicDays: settings.tau_chronic,
    trainingImpulses,
  })

  const startIso = floorToHour(start).toISOString()
  const endIso = effectiveEnd.toISOString()
  const hourlyPoints = allPoints.filter((p) => p.time >= startIso && p.time <= endIso)
  const points = aggregateTrainingLoadPoints(hourlyPoints, bucketSize, tz)

  const workoutList = await workoutListPromise

  const totalHours = allPoints.length
  const bootstrapping = totalHours < BOOTSTRAPPING_DAYS * HOURS_PER_DAY

  // Compute recovery zones from the full extended series
  const zones = computeRecoveryZones(allPoints)

  return {
    bootstrapping,
    estimated_impulse: summarizeImpulseBasis(workoutList),
    points,
    settings: resolvedSettings,
    workouts: workoutList,
    zones,
  }
}
