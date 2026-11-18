/**
 * Write path: recompute hourly impulse buckets from raw exercise + calorie
 * data and persist them to time_series. Chunked for bounded memory usage.
 *
 * Buckets are read from time_series at query time (see `query.ts`); the
 * current incomplete hour is computed on-the-fly there.
 */
import type { ActivityTypeDefinition, TrainingLoadSettings } from '@aurboda/api-spec'

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
import { leaseAvailable, settleChunk, withComputedFrom, withLease } from './state.ts'

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

/** What a recompute run reads once and uses for every chunk. */
export interface RunContext {
  definitions: ActivityTypeDefinition[]
  hrMax: number
  hrRest: number
  settings: ResolvedTrainingLoadSettings
  trainingLoad: TrainingLoadSettings | undefined
}

export const prepareRun = async (deps: TrainingLoadDeps, user: string): Promise<RunContext> => {
  const [userSettings, latestRestingHr, definitions] = await Promise.all([
    deps.getUserSettings(user),
    deps.getLatestRestingHr(user),
    deps.getActivityTypeDefinitions(user),
  ])
  // A recompute is already a write, so the cache write is awaited.
  const maxObservedHr = await getOrCacheMaxObservedHr(deps, user, userSettings.training_load, false)
  const settings = getEffectiveSettings(userSettings.training_load, userSettings.sex)
  return {
    definitions,
    hrMax: resolveHrMax(settings.hr_max, maxObservedHr, userSettings.birth_date),
    hrRest: resolveHrRest(settings.hr_rest, latestRestingHr),
    settings,
    trainingLoad: userSettings.training_load,
  }
}

/**
 * The impulse buckets of [chunkStart, chunkEnd): the chunk's workouts with HR samples for all their
 * windows in one query, and hourly calorie sums aggregated in the DB, so memory stays bounded.
 */
const recomputeChunk = async (
  deps: TrainingLoadDeps,
  user: string,
  chunkStart: Date,
  chunkEnd: Date,
  { definitions, hrMax, hrRest, settings }: RunContext,
): Promise<TimeSeriesPoint[]> => {
  const [exercises, hourlyCalories] = await Promise.all([
    deps.getExercises(user, chunkStart, chunkEnd, definitions),
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
  const collect = (values: Map<string, number>, metric: string, unit: string) => {
    for (const [hourIso, value] of values) {
      const hourDate = new Date(hourIso)
      if (hourDate < chunkStart || hourDate >= chunkEnd || value <= 0) continue
      points.push({ metric, source: 'aurboda', time: hourDate, unit, value: Math.round(value * 100) / 100 })
    }
  }
  collect(training, 'training_impulse', 'TRIMP')
  collect(activity, 'activity_impulse', 'impulse')
  return points
}

const replaceChunk = async (
  deps: TrainingLoadDeps,
  user: string,
  chunkStart: Date,
  chunkEnd: Date,
  context: RunContext,
  hours: Set<number>,
): Promise<void> => {
  const points = await recomputeChunk(deps, user, chunkStart, chunkEnd, context)
  await Promise.all([
    deps.deleteImpulseBuckets(user, 'training_impulse', 'aurboda', chunkStart, chunkEnd),
    deps.deleteImpulseBuckets(user, 'activity_impulse', 'aurboda', chunkStart, chunkEnd),
  ])
  if (points.length === 0) return
  await deps.writeImpulseBuckets(user, points)
  for (const point of points) hours.add(point.time.getTime())
}

/**
 * Stores `change` of the settings and, with a lease holder, renews its lease in the same write.
 * Returns false when another process took the lease over (this one's expired), which ends the run.
 */
const storeProgress = async (
  deps: TrainingLoadDeps,
  user: string,
  lease: string | undefined,
  change: (current: TrainingLoadSettings | undefined) => TrainingLoadSettings,
): Promise<boolean> => {
  let kept = true
  await deps.mutateTrainingLoadSettings(user, (current) => {
    const changed = change(current)
    if (lease === undefined) return changed
    const now = Date.now()
    kept = leaseAvailable(changed, lease, now)
    return kept ? withLease(changed, lease, now) : changed
  })
  return kept
}

export interface RecomputeOptions {
  /** Read once per run when not given. */
  context?: RunContext
  /** The holder whose recompute lease each chunk renews. */
  lease?: string
}

export interface RecomputeResult {
  hours_computed: number
  /** The earliest hour the run recomputed, when it recomputed any. */
  covered_from?: Date
  /** Another process took the lease over and the run stopped. */
  lease_lost?: boolean
}

/**
 * Recompute hourly impulse buckets for a user from `fromHour` to the last completed hour, one chunk
 * at a time: each chunk replaces its own buckets and then moves the watermark past it, so an
 * interrupted run resumes where it stopped and the other hours stay readable meanwhile. A dirty mark
 * made while a chunk is computed is never moved past (see `settleChunk`).
 *
 * Skips the current (incomplete) hour.
 */
export const recomputeImpulseBuckets = async (
  deps: TrainingLoadDeps,
  user: string,
  fromHour: Date,
  { context, lease }: RecomputeOptions = {},
): Promise<RecomputeResult> => {
  const currentHour = getCurrentHourStart()

  if (fromHour >= currentHour) {
    await deps.mutateTrainingLoadSettings(user, (current) => {
      const stored = current?.impulse_watermark
      return stored && floorToHour(new Date(stored)) >= currentHour
        ? { ...current, impulse_watermark: undefined }
        : current
    })
    return { hours_computed: 0 }
  }

  const run = context ?? (await prepareRun(deps, user))
  const hours = new Set<number>()
  let coveredFrom = fromHour
  let chunkStart = fromHour

  while (chunkStart < currentHour) {
    const revBefore = (await deps.getUserSettings(user)).training_load?.impulse_dirty_rev ?? 0
    const chunkEnd = new Date(Math.min(chunkStart.getTime() + RECOMPUTE_CHUNK_MS, currentHour.getTime()))
    await replaceChunk(deps, user, chunkStart, chunkEnd, run, hours)
    if (chunkStart < coveredFrom) coveredFrom = chunkStart

    let next = chunkEnd
    const kept = await storeProgress(deps, user, lease, (current) => {
      const settled = settleChunk(current, revBefore, chunkEnd, currentHour)
      next = settled.next
      return settled.settings
    })
    if (!kept) return { covered_from: coveredFrom, hours_computed: hours.size, lease_lost: true }
    chunkStart = next
  }

  return { covered_from: coveredFrom, hours_computed: hours.size }
}

/**
 * Fills [from, until) for a read of a range older than the stored buckets, newest chunk first,
 * lowering `impulse_computed_from` past each chunk so an interrupted fill resumes. The hours from
 * `until` on and the watermark are left alone.
 */
export const fillImpulseBuckets = async (
  deps: TrainingLoadDeps,
  user: string,
  from: Date,
  until: Date,
  { context, lease }: RecomputeOptions = {},
): Promise<RecomputeResult> => {
  const run = context ?? (await prepareRun(deps, user))
  const hours = new Set<number>()
  let chunkEnd = until

  while (chunkEnd > from) {
    const chunkStart = new Date(Math.max(from.getTime(), chunkEnd.getTime() - RECOMPUTE_CHUNK_MS))
    await replaceChunk(deps, user, chunkStart, chunkEnd, run, hours)
    const kept = await storeProgress(deps, user, lease, (current) => withComputedFrom(current, chunkStart))
    if (!kept) return { covered_from: chunkStart, hours_computed: hours.size, lease_lost: true }
    chunkEnd = chunkStart
  }

  return { covered_from: from < until ? from : undefined, hours_computed: hours.size }
}
