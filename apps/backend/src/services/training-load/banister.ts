/**
 * Pure Banister impulse-response model. No DB access, no I/O — straightforward
 * to unit test.
 *
 * Computes:
 *  - TRIMP (Training Impulse) for each workout from HR data
 *  - ATL (Acute Training Load / fatigue) — 7-day hourly EMA
 *  - CTL (Chronic Training Load / fitness) — 42-day hourly EMA
 *  - TSB (Training Stress Balance / form) = CTL - ATL
 *  - Recovery zone thresholds derived from ATL relative to historical CTL
 */

import type {
  BiologicalSex,
  RecoveryZones,
  TrainingLoadPoint,
  TrainingLoadSettings,
  WorkoutTrimp,
} from '@aurboda/api-spec'

import type { Activity } from '../../db/types.ts'

// ============================================================================
// Constants
// ============================================================================

export const DEFAULT_TAU_ACUTE_DAYS = 7
export const DEFAULT_TAU_CHRONIC_DAYS = 42
export const DEFAULT_K_MALE = 1.92
export const DEFAULT_K_FEMALE = 1.67
export const DEFAULT_ACTIVITY_IMPULSE_SCALE = 0.1 // 100 kcal active → 10 impulse
export const HOURS_PER_DAY = 24
export const BOOTSTRAPPING_DAYS = 42 // CTL needs ~6 weeks to be meaningful
export const MS_PER_HOUR = 60 * 60 * 1000

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
 * Process a single exercise session: compute TRIMP, build a WorkoutTrimp record,
 * and distribute the TRIMP across overlapping hourly buckets.
 *
 * Mutates `training` map in place. Returns the WorkoutTrimp record (or null if
 * the duration is non-positive).
 */
export const processExercise = (
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
    avgHr && avgHr > hrRest
      ? calculateTrimp({
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

/**
 * Compute hourly impulse buckets from raw exercise and calorie data.
 *
 * For each completed hour in [start, end):
 *  - training impulse = sum of TRIMP from exercises overlapping that hour
 *  - activity impulse = sum of active calories in that hour × scale factor
 */
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
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) {
      age--
    }
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
