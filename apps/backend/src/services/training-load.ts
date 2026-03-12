/**
 * Training load calculation using the Banister impulse-response model.
 *
 * Computes:
 * - TRIMP (Training Impulse) for each workout from HR data
 * - ATL (Acute Training Load / fatigue) — 7-day exponential moving average
 * - CTL (Chronic Training Load / fitness) — 42-day exponential moving average
 * - TSB (Training Stress Balance / form) = CTL - ATL
 */

import type {
  BiologicalSex,
  TrainingLoadPoint,
  TrainingLoadResult,
  TrainingLoadSettings,
  WorkoutTrimp,
} from '@aurboda/api-spec'
import type { Activity } from '../db/types'

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_TAU_ACUTE = 7
const DEFAULT_TAU_CHRONIC = 42
const DEFAULT_K_MALE = 1.92
const DEFAULT_K_FEMALE = 1.67
const BOOTSTRAPPING_DAYS = 42 // CTL needs ~6 weeks to be meaningful

/** Settings after resolving defaults — k_factor, tau_acute, tau_chronic are always set. */
export interface ResolvedTrainingLoadSettings extends TrainingLoadSettings {
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
// Exponential Moving Average (Banister Model)
// ============================================================================

export interface LoadAccumulatorParams {
  /** Daily TRIMP values, indexed by date string (YYYY-MM-DD) */
  daily_trimps: Map<string, number>
  /** Start date for the time series */
  start_date: string
  /** End date for the time series */
  end_date: string
  /** Acute time constant in days (default 7) */
  tau_acute: number
  /** Chronic time constant in days (default 42) */
  tau_chronic: number
}

/**
 * Compute daily ATL, CTL, and TSB using the Banister exponential decay model.
 *
 * ATL(today) = ATL(yesterday) × e^(-1/τ_a) + TRIMP(today)
 * CTL(today) = CTL(yesterday) × e^(-1/τ_c) + TRIMP(today)
 * TSB(today) = CTL(today) - ATL(today)
 */
export const computeTrainingLoadSeries = (params: LoadAccumulatorParams): TrainingLoadPoint[] => {
  const { daily_trimps, start_date, end_date, tau_acute, tau_chronic } = params

  const decayAcute = Math.exp(-1 / tau_acute)
  const decayChronic = Math.exp(-1 / tau_chronic)
  const gainAcute = 1 - decayAcute // ~0.133 for τ=7
  const gainChronic = 1 - decayChronic // ~0.024 for τ=42

  const points: TrainingLoadPoint[] = []
  let atl = 0
  let ctl = 0

  // Iterate day by day from start to end
  const current = new Date(start_date + 'T00:00:00Z')
  const endDt = new Date(end_date + 'T00:00:00Z')

  while (current <= endDt) {
    const dateStr = current.toISOString().split('T')[0]
    const dailyTrimp = daily_trimps.get(dateStr) ?? 0

    // Banister EMA: load(n) = load(n-1) × e^(-1/τ) + TRIMP(n) × (1 - e^(-1/τ))
    // The (1 - decay) gain factor normalizes so steady-state ≈ average daily TRIMP.
    atl = atl * decayAcute + dailyTrimp * gainAcute
    ctl = ctl * decayChronic + dailyTrimp * gainChronic
    const tsb = ctl - atl

    points.push({
      atl: Math.round(atl * 100) / 100,
      ctl: Math.round(ctl * 100) / 100,
      daily_trimp: Math.round(dailyTrimp * 100) / 100,
      date: dateStr,
      tsb: Math.round(tsb * 100) / 100,
    })

    current.setUTCDate(current.getUTCDate() + 1)
  }

  return points
}

// ============================================================================
// Data Extraction Helpers
// ============================================================================

export interface ExerciseWithHr {
  activity: Activity
  avg_hr: number
  duration_minutes: number
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
  // Find HR samples within the session window
  const sessionHr = hrSamples.filter(([t]) => t >= sessionStart && t <= sessionEnd)

  if (sessionHr.length === 0) return null

  const sum = sessionHr.reduce((acc, [, hr]) => acc + hr, 0)
  return sum / sessionHr.length
}

/**
 * Get effective training load settings, filling defaults from user profile.
 */
export const getEffectiveSettings = (
  userSettings: TrainingLoadSettings | undefined,
  sex: BiologicalSex | undefined,
): ResolvedTrainingLoadSettings => {
  const kDefault = sex === 'female' ? DEFAULT_K_FEMALE : DEFAULT_K_MALE

  return {
    hr_max: userSettings?.hr_max,
    hr_rest: userSettings?.hr_rest,
    k_factor: userSettings?.k_factor ?? kDefault,
    tau_acute: userSettings?.tau_acute ?? DEFAULT_TAU_ACUTE,
    tau_chronic: userSettings?.tau_chronic ?? DEFAULT_TAU_CHRONIC,
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

  // Age-based fallback: 220 - age
  if (birthDate) {
    const birth = new Date(birthDate)
    const today = new Date()
    let age = today.getFullYear() - birth.getFullYear()
    const monthDiff = today.getMonth() - birth.getMonth()
    if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birth.getDate())) age--
    return 220 - age
  }

  // Ultimate fallback
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
  // Fallback
  return 60
}

// ============================================================================
// Dependencies (injected for testability)
// ============================================================================

export interface TrainingLoadDeps {
  /** Get exercise activities in a time range */
  getExercises: (user: string, start: Date, end: Date) => Promise<Activity[]>
  /** Get HR time-series data in a time range */
  getHrSamples: (user: string, start: Date, end: Date) => Promise<[Date, number][]>
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
}

// ============================================================================
// Main Computation
// ============================================================================

/**
 * Compute training load time series for a user and date range.
 *
 * Gathers exercise sessions, HR data, and user settings, then:
 * 1. Computes TRIMP for each workout
 * 2. Aggregates daily TRIMP totals
 * 3. Runs the Banister model to produce ATL/CTL/TSB
 */
export const computeTrainingLoad = async (
  deps: TrainingLoadDeps,
  user: string,
  start: Date,
  end: Date,
): Promise<TrainingLoadResult> => {
  // Gather all inputs
  const [userSettings, maxObservedHr, latestRestingHr] = await Promise.all([
    deps.getUserSettings(user),
    deps.getMaxObservedHr(user),
    deps.getLatestRestingHr(user),
  ])

  const effectiveSettings = getEffectiveSettings(userSettings.training_load, userSettings.sex)

  const hrMax = resolveHrMax(effectiveSettings.hr_max, maxObservedHr, userSettings.birth_date)
  const hrRest = resolveHrRest(effectiveSettings.hr_rest, latestRestingHr)

  // Extend the lookback period for the chronic load to have meaningful EMA values
  // We need tau_chronic * 3 days of pre-history for CTL convergence
  const lookbackDays = Math.ceil(effectiveSettings.tau_chronic * 3)
  const extendedStart = new Date(start)
  extendedStart.setUTCDate(extendedStart.getUTCDate() - lookbackDays)

  // Fetch exercises and HR data for the extended range
  const [exercises, hrSamples] = await Promise.all([
    deps.getExercises(user, extendedStart, end),
    deps.getHrSamples(user, extendedStart, end),
  ])

  // Compute TRIMP for each workout
  const workouts: WorkoutTrimp[] = []
  for (const activity of exercises) {
    const sessionEnd = activity.end_time ?? new Date(activity.start_time.getTime() + 60 * 60 * 1000) // 1h default
    const durationMs = sessionEnd.getTime() - activity.start_time.getTime()
    const durationMinutes = durationMs / 60_000

    if (durationMinutes <= 0) continue

    // Get average HR for this session
    const avgHr = getAverageHrForSession(activity.start_time, sessionEnd, hrSamples)

    let trimp: number
    if (avgHr && avgHr > hrRest) {
      trimp = calculateTrimp({
        avg_hr: avgHr,
        duration_minutes: durationMinutes,
        hr_max: hrMax,
        hr_rest: hrRest,
        k_factor: effectiveSettings.k_factor,
      })
    } else {
      // Fallback: use a simpler estimate based on duration alone
      // Assume moderate intensity (~65% of reserve HR)
      trimp = durationMinutes * 0.5
    }

    const dateStr = activity.start_time.toISOString().split('T')[0]

    workouts.push({
      activity_id: activity.id,
      avg_hr: avgHr ?? undefined,
      date: dateStr,
      duration_minutes: Math.round(durationMinutes * 10) / 10,
      end_time: sessionEnd.toISOString(),
      start_time: activity.start_time.toISOString(),
      title:
        activity.title ??
        (activity.data?.exerciseType != null ? String(activity.data.exerciseType) : undefined),
      trimp: Math.round(trimp * 100) / 100,
    })
  }

  // Aggregate daily TRIMP totals
  const dailyTrimps = new Map<string, number>()
  for (const w of workouts) {
    dailyTrimps.set(w.date, (dailyTrimps.get(w.date) ?? 0) + w.trimp)
  }

  // Compute training load series from extended start to end
  const extendedStartStr = extendedStart.toISOString().split('T')[0]
  const endStr = end.toISOString().split('T')[0]
  const startStr = start.toISOString().split('T')[0]

  const allPoints = computeTrainingLoadSeries({
    daily_trimps: dailyTrimps,
    end_date: endStr,
    start_date: extendedStartStr,
    tau_acute: effectiveSettings.tau_acute,
    tau_chronic: effectiveSettings.tau_chronic,
  })

  // Filter to only return points within the requested range
  const points = allPoints.filter((p) => p.date >= startStr && p.date <= endStr)

  // Filter workouts to requested range too
  const rangeWorkouts = workouts.filter((w) => w.date >= startStr && w.date <= endStr)

  // Determine if we're in bootstrapping period
  const daysWithData = new Set(workouts.map((w) => w.date)).size
  const requestedDays = points.length
  const bootstrapping = requestedDays < BOOTSTRAPPING_DAYS || daysWithData < 10

  return {
    bootstrapping,
    data_days: daysWithData,
    points,
    settings: {
      ...effectiveSettings,
      hr_max: hrMax,
      hr_rest: hrRest,
    },
    workouts: rangeWorkouts,
  }
}

// ============================================================================
// Default Dependencies (using actual DB functions)
// ============================================================================

import { getActivities, getTimeSeries, getTimeSeriesBucketed, getTimeSeriesStats } from '../db'
import { getSettings } from './settings'

/**
 * Create production dependencies for the training load computation.
 */
export const createTrainingLoadDeps = (): TrainingLoadDeps => ({
  getExercises: async (user, start, end) => {
    return getActivities(user, 'exercise', start, end)
  },

  getHrSamples: async (user, start, end) => {
    // Use 5-minute bucketed averages instead of raw samples (which can be millions
    // of points over months). 5-minute resolution is sufficient for per-session
    // average HR calculation used in TRIMP.
    const buckets = await getTimeSeriesBucketed(user, ['heart_rate'], start, end, 5)
    return buckets.map((b) => [b.bucket_start, b.avg] as [Date, number])
  },

  getLatestRestingHr: async (user) => {
    const now = new Date()
    const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)
    const samples = await getTimeSeries(user, 'resting_heart_rate', thirtyDaysAgo, now)
    if (samples.length === 0) return undefined
    // Return the most recent value
    return samples[samples.length - 1][1]
  },

  getMaxObservedHr: async (user) => {
    const now = new Date()
    const oneYearAgo = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000)
    // Use SQL MAX() aggregation instead of loading all raw samples — raw HR data
    // can be millions of points over a year, which would overflow the stack with
    // Math.max(...samples).
    const stats = await getTimeSeriesStats(user, ['heart_rate'], oneYearAgo, now)
    const hrStats = stats.find((s) => s.metric === 'heart_rate')
    if (!hrStats || hrStats.count === 0) return undefined
    return hrStats.max
  },

  getUserSettings: async (user) => {
    const settings = await getSettings(user)
    return {
      birth_date: settings.birth_date,
      sex: settings.sex,
      training_load: settings.training_load,
    }
  },
})
