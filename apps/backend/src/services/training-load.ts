/* eslint-disable max-lines -- complex domain logic needs to stay in one file for cohesion */
/**
 * Training load calculation using the Banister impulse-response model.
 *
 * Architecture:
 *  - Hourly impulse buckets are stored in time_series (training_impulse, activity_impulse).
 *  - After sync, affected completed hours are recomputed and upserted.
 *  - At query time, impulse buckets are fetched and the Banister EMA is run per-hour.
 *  - The current (incomplete) hour is computed on-the-fly from raw data.
 *
 * Computes:
 *  - TRIMP (Training Impulse) for each workout from HR data
 *  - ATL (Acute Training Load / fatigue) — 7-day hourly EMA
 *  - CTL (Chronic Training Load / fitness) — 42-day hourly EMA
 *  - TSB (Training Stress Balance / form) = CTL - ATL
 */

import {
  type BiologicalSex,
  type RecoveryZones,
  trainingLoadBucketSizes,
  type TrainingLoadPoint,
  type TrainingLoadResult,
  type TrainingLoadSettings,
  type WorkoutTrimp,
} from '@aurboda/api-spec'
import { Temporal } from '@js-temporal/polyfill'
import type { Activity, TimeSeriesPoint } from '../db/types'

type TrainingLoadBucketSize = (typeof trainingLoadBucketSizes)[number]

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TAU_ACUTE_DAYS = 7
const DEFAULT_TAU_CHRONIC_DAYS = 42
const DEFAULT_K_MALE = 1.92
const DEFAULT_K_FEMALE = 1.67
const DEFAULT_ACTIVITY_IMPULSE_SCALE = 0.1 // 100 kcal active → 10 impulse
const HOURS_PER_DAY = 24
const BOOTSTRAPPING_DAYS = 42 // CTL needs ~6 weeks to be meaningful
const MS_PER_HOUR = 60 * 60 * 1000

/** Settings after resolving defaults — k_factor, tau_acute, tau_chronic are always set. */
export interface ResolvedTrainingLoadSettings extends TrainingLoadSettings {
  activity_impulse_scale: number
  k_factor: number
  tau_acute: number
  tau_chronic: number
}

// ============================================================================
// TRIMP Calculation
// ============================================================================

export interface TrimpCalcParams {
  /** Duration of workout in minutes */
  duration_minutes: number
  /** Average HR during workout (bpm) */
  avg_hr: number
  /** Resting HR (bpm) */
  hr_rest: number
  /** Maximum HR (bpm) */
  hr_max: number
  /** Sex-dependent constant (1.92 male, 1.67 female) */
  k_factor: number
}

/**
 * Calculate TRIMP (Training Impulse) for a single workout.
 *
 * Formula: TRIMP = duration_minutes × ΔHR_ratio × e^(k × ΔHR_ratio)
 * where ΔHR_ratio = (HR_avg - HR_rest) / (HR_max - HR_rest)
 */
export const calculateTrimp = (params: TrimpCalcParams): number => {
  const { duration_minutes, avg_hr, hr_rest, hr_max, k_factor } = params

  // Guard against division by zero or invalid inputs
  if (hr_max <= hr_rest || avg_hr <= hr_rest || duration_minutes <= 0) return 0

  const deltaHrRatio = (avg_hr - hr_rest) / (hr_max - hr_rest)
  // Clamp ratio to [0, 1] to avoid extreme values from bad data
  const clampedRatio = Math.min(Math.max(deltaHrRatio, 0), 1)

  return duration_minutes * clampedRatio * Math.exp(k_factor * clampedRatio)
}

// ============================================================================
// Hourly Impulse Bucket Computation
// ============================================================================

/**
 * Floor a date to the start of its hour.
 */
export const floorToHour = (date: Date): Date => {
  const d = new Date(date)
  d.setUTCMinutes(0, 0, 0)
  return d
}

/**
 * Get the start of the current (incomplete) hour.
 */
export const getCurrentHourStart = (): Date => floorToHour(new Date())

/**
 * Compute TRIMP contribution of a workout to a specific hour.
 *
 * If a workout spans multiple hours, the TRIMP is split proportionally by
 * the fraction of the workout's duration that falls in each hour.
 */
export const getWorkoutTrimpForHour = (
  workoutStart: Date,
  workoutEnd: Date,
  totalTrimp: number,
  hourStart: Date,
): number => {
  const hourEnd = new Date(hourStart.getTime() + MS_PER_HOUR)
  const overlapStart = Math.max(workoutStart.getTime(), hourStart.getTime())
  const overlapEnd = Math.min(workoutEnd.getTime(), hourEnd.getTime())
  const overlapMs = overlapEnd - overlapStart

  if (overlapMs <= 0) return 0

  const totalMs = workoutEnd.getTime() - workoutStart.getTime()
  if (totalMs <= 0) return 0

  return totalTrimp * (overlapMs / totalMs)
}

/**
 * Extract average HR from HR time-series data for an exercise session.
 * Returns null if no HR samples are available during the session window.
 */
export const getAverageHrForSession = (
  sessionStart: Date,
  sessionEnd: Date,
  hrSamples: [Date, number][],
): number | null => {
  const sessionHr = hrSamples.filter(([t]) => t >= sessionStart && t <= sessionEnd)
  if (sessionHr.length === 0) return null
  const sum = sessionHr.reduce((acc, [, hr]) => acc + hr, 0)
  return sum / sessionHr.length
}

export interface HourlyImpulses {
  /** training_impulse per hour: Map<hourIso, trimp> */
  training: Map<string, number>
  /** activity_impulse per hour: Map<hourIso, scaledCalories> */
  activity: Map<string, number>
  /** Workout details for the range */
  workouts: WorkoutTrimp[]
}

/**
 * Compute hourly impulse buckets from raw exercise and calorie data.
 *
 * For each completed hour in [start, end):
 *  - training impulse = sum of TRIMP from exercises overlapping that hour
 *  - activity impulse = sum of active calories in that hour × scale factor
 */
/**
 * Process a single exercise session: compute TRIMP, build a WorkoutTrimp record,
 * and distribute the TRIMP across overlapping hourly buckets.
 */
const processExercise = (
  ex: Activity,
  hrSamples: [Date, number][],
  hrMax: number,
  hrRest: number,
  kFactor: number,
  training: Map<string, number>,
): WorkoutTrimp | null => {
  const sessionEnd = ex.end_time ?? new Date(ex.start_time.getTime() + MS_PER_HOUR)
  const durationMs = sessionEnd.getTime() - ex.start_time.getTime()
  const durationMinutes = durationMs / 60_000
  if (durationMinutes <= 0) return null

  const avgHr = getAverageHrForSession(ex.start_time, sessionEnd, hrSamples)

  const trimp =
    avgHr && avgHr > hrRest ?
      calculateTrimp({
        avg_hr: avgHr,
        duration_minutes: durationMinutes,
        hr_max: hrMax,
        hr_rest: hrRest,
        k_factor: kFactor,
      })
    : durationMinutes * 0.5

  // Distribute TRIMP across overlapping hours
  let hourCursor = floorToHour(ex.start_time)
  while (hourCursor < sessionEnd) {
    const hourIso = hourCursor.toISOString()
    const hourTrimp = getWorkoutTrimpForHour(ex.start_time, sessionEnd, trimp, hourCursor)
    if (hourTrimp > 0) {
      training.set(hourIso, (training.get(hourIso) ?? 0) + hourTrimp)
    }
    hourCursor = new Date(hourCursor.getTime() + MS_PER_HOUR)
  }

  const dateStr = ex.start_time.toISOString().split('T')[0]!
  return {
    activity_id: ex.id,
    avg_hr: avgHr ?? undefined,
    date: dateStr,
    duration_minutes: Math.round(durationMinutes * 10) / 10,
    end_time: sessionEnd.toISOString(),
    start_time: ex.start_time.toISOString(),
    title: ex.title ?? (ex.data?.exerciseType != null ? String(ex.data.exerciseType) : undefined),
    trimp: Math.round(trimp * 100) / 100,
  }
}

export const computeHourlyImpulses = (
  exercises: Activity[],
  hrSamples: [Date, number][],
  caloriesSamples: [Date, number][],
  hrMax: number,
  hrRest: number,
  kFactor: number,
  activityScale: number,
  start: Date,
  end: Date,
): HourlyImpulses => {
  const training = new Map<string, number>()
  const activity = new Map<string, number>()
  const workouts: WorkoutTrimp[] = []

  for (const ex of exercises) {
    const workout = processExercise(ex, hrSamples, hrMax, hrRest, kFactor, training)
    if (workout) workouts.push(workout)
  }

  // Aggregate active calories into hourly buckets
  for (const [time, kcal] of caloriesSamples) {
    if (time < start || time >= end) continue
    const hourIso = floorToHour(time).toISOString()
    activity.set(hourIso, (activity.get(hourIso) ?? 0) + kcal * activityScale)
  }

  return { activity, training, workouts }
}

// ============================================================================
// Hourly Banister EMA
// ============================================================================

export interface HourlyLoadParams {
  /** Hourly training impulse: Map<hourIso, value> */
  trainingImpulses: Map<string, number>
  /** Hourly activity impulse: Map<hourIso, value> */
  activityImpulses: Map<string, number>
  /** Start hour (inclusive) */
  start: Date
  /** End hour (inclusive) */
  end: Date
  /** Acute time constant in days (converted to hours internally) */
  tauAcuteDays: number
  /** Chronic time constant in days (converted to hours internally) */
  tauChronicDays: number
}

/**
 * Compute hourly ATL, CTL, TSB using Banister exponential decay.
 *
 * The tau values are in days but the EMA steps are hourly:
 *   tau_hours = tau_days × 24
 *   decay = e^(-1/tau_hours)
 *   gain  = 1 - decay
 *
 * Each hour: load(h) = load(h-1) × decay + impulse(h) × gain
 */
export const computeHourlyLoadSeries = (params: HourlyLoadParams): TrainingLoadPoint[] => {
  const { trainingImpulses, activityImpulses, start, end, tauAcuteDays, tauChronicDays } = params

  const tauAcuteHours = tauAcuteDays * HOURS_PER_DAY
  const tauChronicHours = tauChronicDays * HOURS_PER_DAY

  const decayAcute = Math.exp(-1 / tauAcuteHours)
  const decayChronic = Math.exp(-1 / tauChronicHours)
  const gainAcute = 1 - decayAcute
  const gainChronic = 1 - decayChronic

  const points: TrainingLoadPoint[] = []
  let atl = 0
  let ctl = 0

  let current = new Date(start)
  while (current <= end) {
    const hourIso = current.toISOString()
    const ti = trainingImpulses.get(hourIso) ?? 0
    const ai = activityImpulses.get(hourIso) ?? 0
    const totalImpulse = ti + ai

    atl = atl * decayAcute + totalImpulse * gainAcute
    ctl = ctl * decayChronic + totalImpulse * gainChronic
    const tsb = ctl - atl

    points.push({
      activity_impulse: Math.round(ai * 100) / 100,
      atl: Math.round(atl * 100) / 100,
      ctl: Math.round(ctl * 100) / 100,
      time: hourIso,
      training_impulse: Math.round(ti * 100) / 100,
      tsb: Math.round(tsb * 100) / 100,
    })

    current = new Date(current.getTime() + MS_PER_HOUR)
  }

  return points
}

// ============================================================================
// Recovery Zone Computation
// ============================================================================

/**
 * Compute recovery zone thresholds from historical ATL/CTL data.
 *
 * Zones are based on ATL relative to the user's historical CTL:
 *  - Undertrained: ATL < 0.8 × avg_CTL
 *  - Balanced: 0.8 × avg_CTL ≤ ATL ≤ 1.3 × avg_CTL
 *  - Strained: 1.3 × avg_CTL < ATL ≤ 1.7 × avg_CTL
 *  - Very Strained: ATL > 1.7 × avg_CTL
 *
 * Returns null during bootstrapping when there isn't enough data.
 */
export const computeRecoveryZones = (points: TrainingLoadPoint[]): RecoveryZones | undefined => {
  if (points.length < BOOTSTRAPPING_DAYS * HOURS_PER_DAY) return undefined

  // Average CTL over all points
  const totalCtl = points.reduce((sum, p) => sum + p.ctl, 0)
  const avgCtl = totalCtl / points.length

  if (avgCtl < 1) return undefined // Not enough training data

  return {
    balanced_max: Math.round(avgCtl * 1.3 * 100) / 100,
    balanced_min: Math.round(avgCtl * 0.8 * 100) / 100,
    strained_max: Math.round(avgCtl * 1.7 * 100) / 100,
  }
}

// ============================================================================
// Settings Helpers
// ============================================================================

/**
 * Get effective training load settings, filling defaults from user profile.
 */
export const getEffectiveSettings = (
  userSettings: TrainingLoadSettings | undefined,
  sex: BiologicalSex | undefined,
): ResolvedTrainingLoadSettings => {
  const kDefault = sex === 'female' ? DEFAULT_K_FEMALE : DEFAULT_K_MALE

  return {
    activity_impulse_scale: userSettings?.activity_impulse_scale ?? DEFAULT_ACTIVITY_IMPULSE_SCALE,
    hr_max: userSettings?.hr_max,
    hr_rest: userSettings?.hr_rest,
    k_factor: userSettings?.k_factor ?? kDefault,
    tau_acute: userSettings?.tau_acute ?? DEFAULT_TAU_ACUTE_DAYS,
    tau_chronic: userSettings?.tau_chronic ?? DEFAULT_TAU_CHRONIC_DAYS,
  }
}

/**
 * Resolve the effective max HR from settings, observed data, or age estimate.
 */
export const resolveHrMax = (
  settingsHrMax: number | undefined,
  observedMaxHr: number | undefined,
  birthDate: string | undefined,
): number => {
  if (settingsHrMax) return settingsHrMax
  if (observedMaxHr && observedMaxHr > 100) return observedMaxHr

  if (birthDate) {
    const birth = new Date(birthDate)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--
    return 220 - age
  }

  return 190
}

/**
 * Resolve the effective resting HR from settings or observed data.
 */
export const resolveHrRest = (
  settingsHrRest: number | undefined,
  latestRestingHr: number | undefined,
): number => {
  if (settingsHrRest) return settingsHrRest
  if (latestRestingHr && latestRestingHr > 30) return latestRestingHr
  return 60
}

// ============================================================================
// Dependencies (injected for testability)
// ============================================================================

export interface TrainingLoadDeps {
  /** Get exercise activities in a time range */
  getExercises: (user: string, start: Date, end: Date) => Promise<Activity[]>
  /** Get HR time-series data in a time range (bucketed to 5-min) */
  getHrSamples: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Get active calorie time-series data (raw samples) */
  getActiveCalories: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Get active calories summed per hour (DB-level aggregation) */
  getHourlyCalorieSums: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Get pre-computed impulse buckets from time_series */
  getImpulseBuckets: (user: string, metric: string, start: Date, end: Date) => Promise<[Date, number][]>
  /** Write impulse buckets to time_series */
  writeImpulseBuckets: (user: string, points: TimeSeriesPoint[]) => Promise<void>
  /** Delete impulse buckets in a range (for recomputation) */
  deleteImpulseBuckets: (
    user: string,
    metric: string,
    source: string,
    start: Date,
    end: Date,
  ) => Promise<number>
  /** Get the maximum observed HR value */
  getMaxObservedHr: (user: string) => Promise<number | undefined>
  /** Get the most recent resting HR */
  getLatestRestingHr: (user: string) => Promise<number | undefined>
  /** Get user settings */
  getUserSettings: (user: string) => Promise<{
    training_load?: TrainingLoadSettings
    sex?: BiologicalSex
    birth_date?: string
  }>
  /** Update training load settings (for watermark) */
  updateTrainingLoadSettings: (user: string, update: Partial<TrainingLoadSettings>) => Promise<void>
}

// ============================================================================
// Impulse Recomputation (Write Path)
// ============================================================================

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

// ============================================================================
// Main Query Helpers
// ============================================================================

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

// ============================================================================
// Bucket Aggregation
// ============================================================================

/**
 * Aggregate hourly training load points into larger time buckets.
 *
 * For each bucket:
 * - training_impulse, activity_impulse: summed across all hours in the bucket
 * - atl: peak value within the bucket (shows worst-case fatigue)
 * - ctl, tsb: value from the last hour in the bucket (most recent EMA state)
 * - time: floored to bucket boundary
 */
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

// ============================================================================
// Main Query (Read Path)
// ============================================================================

/**
 * Resolve max observed HR using cached value from settings if available,
 * falling back to the expensive 1-year `getTimeSeriesStats` scan.
 * Caches the result in settings for future requests.
 *
 * @param fireAndForget - If true, cache write doesn't block. Used on the read path.
 */
const getOrCacheMaxObservedHr = async (
  deps: TrainingLoadDeps,
  user: string,
  trainingLoadSettings: TrainingLoadSettings | undefined,
  fireAndForget = true,
): Promise<number | undefined> => {
  const cached = trainingLoadSettings?.observed_hr_max
  if (cached && cached > 100) return cached

  const observed = await deps.getMaxObservedHr(user)
  if (observed && observed > 100 && observed !== cached) {
    const writePromise = deps.updateTrainingLoadSettings(user, { observed_hr_max: observed })
    if (fireAndForget) writePromise.catch(() => {})
    else await writePromise
  }
  return observed
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

// ============================================================================
// Default Dependencies (using actual DB functions)
// ============================================================================

import {
  deleteTimeSeriesBySource,
  getActivities,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesStats,
  insertTimeSeries,
} from '../db'
import { upsertUserSettings } from '../db/settings'
import { getSettings } from './settings'

/**
 * Create production dependencies for the training load computation.
 */
export const createTrainingLoadDeps = (): TrainingLoadDeps => ({
  deleteImpulseBuckets: async (user, metric, source, start, end) => {
    return deleteTimeSeriesBySource(user, metric, source, start, end)
  },

  getActiveCalories: async (user, start, end) => {
    const samples = await getTimeSeries(user, 'calories_active', start, end)
    return samples
  },

  getExercises: async (user, start, end) => {
    return getActivities(user, 'exercise', start, end)
  },

  getHourlyCalorieSums: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['calories_active'], start, end, '60 minutes')
    return buckets.map((b) => [b.bucket_start, b.sum] as [Date, number])
  },

  getHrSamples: async (user, start, end) => {
    const buckets = await getTimeSeriesBucketed(user, ['heart_rate'], start, end, '5 minutes')
    return buckets.map((b) => [b.bucket_start, b.avg] as [Date, number])
  },

  getImpulseBuckets: async (user, metric, start, end) => {
    return getTimeSeries(user, metric, start, end)
  },

  getLatestRestingHr: async (user) => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const samples = await getTimeSeries(user, 'resting_heart_rate', thirtyDaysAgo, now)
    if (samples.length === 0) return undefined
    return samples[samples.length - 1][1]
  },

  getMaxObservedHr: async (user) => {
    const now = new Date()
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    const stats = await getTimeSeriesStats(user, ['heart_rate'], oneYearAgo, now)
    const hrStats = stats.find((s) => s.metric === 'heart_rate')
    if (!hrStats || hrStats.count === 0) return undefined
    return hrStats.max
  },

  getUserSettings: async (user) => {
    const s = await getSettings(user)
    return { birth_date: s.birth_date, sex: s.sex, training_load: s.training_load }
  },

  updateTrainingLoadSettings: async (user, update) => {
    const current = await getSettings(user)
    await upsertUserSettings(user, {
      training_load: { ...current.training_load, ...update },
    })
  },

  writeImpulseBuckets: async (user, points) => {
    await insertTimeSeries(user, points)
  },
})
