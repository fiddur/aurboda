/**
 * Calorie calculation from heart rate data.
 *
 * Uses the formulas from https://www.omnicalculator.com/sports/calories-burned-by-heart-rate
 *
 * Men:   CB = T * (0.634*H + 0.404*V + 0.394*W + 0.271*A - 95.7735) / 4.184
 * Women: CB = T * (0.45*H  + 0.380*V + 0.103*W + 0.274*A - 59.3954) / 4.184
 *
 * where:
 *   CB = Calories burned (kcal)
 *   T  = Duration in minutes
 *   H  = Average heart rate (bpm)
 *   V  = VO2 max (mL/kg/min)
 *   W  = Weight (kg)
 *   A  = Age (years)
 *
 * The formula computes TOTAL caloric burn including BMR. To get active-only
 * calories, we subtract a baseline computed at resting_hr * BASELINE_HR_MULTIPLIER
 * using the same formula. This naturally zeroes out sleep and rest periods.
 *
 * The 1.2x multiplier was empirically validated against Oura sleep HR data:
 * during actual sleep stages (light/deep/REM, excluding awake periods with
 * 5-min margins), HR stays at or below resting_hr * 1.2, so this threshold
 * produces 0 active calories during sleep.
 */

import type { BiologicalSex, HrZoneThresholds } from '@aurboda/api-spec'

/**
 * Maximum minutes a single HR reading can be held forward.
 * If the gap between consecutive HR samples exceeds this, minutes beyond
 * the threshold are skipped (no calorie data rather than stale data).
 */
export const MAX_HOLD_MINUTES = 5

/**
 * Multiplier applied to resting HR to compute the baseline HR threshold.
 * The formula's output at this HR is subtracted from each minute's result
 * to yield active-only calories. Empirically validated against sleep data:
 * during actual sleep stages, HR stays at or below this threshold.
 */
export const BASELINE_HR_MULTIPLIER = 1.2

/** Default resting HR when no measured value is available. */
export const DEFAULT_RESTING_HR = 60

/** Default VO2 max fallback values by sex and age group (mL/kg/min). */
const VO2_MAX_FALLBACK: Record<BiologicalSex, { age: number; value: number }[]> = {
  female: [
    { age: 30, value: 36 },
    { age: 40, value: 34 },
    { age: 50, value: 31 },
    { age: 60, value: 28 },
    { age: 70, value: 25 },
    { age: 999, value: 23 },
  ],
  male: [
    { age: 30, value: 42 },
    { age: 40, value: 40 },
    { age: 50, value: 37 },
    { age: 60, value: 34 },
    { age: 70, value: 31 },
    { age: 999, value: 28 },
  ],
}

/**
 * Get a population-average VO2 max estimate based on sex and age.
 */
export const getVo2MaxFallback = (sex: BiologicalSex, age: number): number => {
  const brackets = VO2_MAX_FALLBACK[sex]
  for (const bracket of brackets) {
    if (age < bracket.age) return bracket.value
  }
  return brackets[brackets.length - 1].value
}

export interface CalorieCalcParams {
  /** Sorted HR samples: [timestamp, bpm] */
  hr_samples: [Date, number][]
  /** VO2 max in mL/kg/min */
  vo2_max: number
  /** Weight in kg */
  weight_kg: number
  /** Age in years */
  age_years: number
  /** Biological sex */
  sex: BiologicalSex
  /** Resting heart rate (bpm). Used to compute the baseline subtraction. */
  resting_hr?: number
}

export interface CalorieDataPoint {
  /** Start of the minute bucket */
  time: Date
  /** End of the minute bucket (time + 60s) */
  end_time: Date
  /** Calories burned in this minute (kcal) */
  kcal: number
}

export interface GapFillInput {
  /** Start of the calendar day (midnight UTC) */
  day_start: Date
  /** Per-minute aurboda calorie points already computed for this day */
  aurboda_points: CalorieDataPoint[]
  /** HC aggregate total active calories for this day (from health_connect_aggregate source) */
  hc_aggregate_kcal: number
}

export interface GapFillResult {
  /** Gap-fill calorie points to store */
  points: CalorieDataPoint[]
  /** Number of gap minutes identified */
  gap_minutes: number
  /** Residual kcal distributed (hc_aggregate - aurboda_sum) */
  residual_kcal: number
  /** Per-minute kcal value used for gap-filling */
  per_minute_kcal: number
}

/**
 * Compute gap-fill calorie points for minutes without HR data.
 *
 * After computing per-minute active calories from HR data (aurboda source),
 * some minutes in the day have no HR coverage (e.g., wrist off, no HR monitor).
 * Oura/Health Connect may still capture movement-based calories for those periods.
 *
 * This function:
 * 1. Finds the residual: HC aggregate total - sum of aurboda points
 * 2. Identifies gap minutes in the day (no aurboda point exists)
 * 3. Distributes the residual evenly across gap minutes
 *
 * Returns empty points if:
 * - HC aggregate is not higher than aurboda sum (nothing to distribute)
 * - No gap minutes exist (full HR coverage)
 */
export const computeGapFillPoints = (input: GapFillInput): GapFillResult => {
  const { day_start, aurboda_points, hc_aggregate_kcal } = input
  const emptyResult: GapFillResult = { gap_minutes: 0, per_minute_kcal: 0, points: [], residual_kcal: 0 }

  // Sum of aurboda-computed calories for this day
  const aurbodaSum = aurboda_points.reduce((sum, p) => sum + p.kcal, 0)

  // Residual = what HC captured that we didn't
  const residual = hc_aggregate_kcal - aurbodaSum
  if (residual <= 0) return emptyResult

  // Build a set of minutes already covered by aurboda
  const coveredMinutes = new Set<number>()
  for (const p of aurboda_points) {
    coveredMinutes.add(Math.floor(p.time.getTime() / 60_000))
  }

  // Find gap minutes in the day (0..1439)
  const dayStartMs = day_start.getTime()
  const gapMinutes: number[] = []
  for (let m = 0; m < 1440; m++) {
    const minuteMs = dayStartMs + m * 60_000
    const minuteKey = Math.floor(minuteMs / 60_000)
    if (!coveredMinutes.has(minuteKey)) {
      gapMinutes.push(minuteMs)
    }
  }

  if (gapMinutes.length === 0) return emptyResult

  // Distribute residual evenly across gap minutes
  const perMinuteKcal = residual / gapMinutes.length

  const points: CalorieDataPoint[] = gapMinutes.map((ms) => ({
    end_time: new Date(ms + 60_000),
    kcal: perMinuteKcal,
    time: new Date(ms),
  }))

  return {
    gap_minutes: gapMinutes.length,
    per_minute_kcal: perMinuteKcal,
    points,
    residual_kcal: residual,
  }
}

/**
 * Compute per-minute calorie burn from heart rate samples.
 *
 * Uses hold-last-value interpolation for sparse data (e.g., Oura 5-minute HR):
 * a sample's HR value is assumed to persist for up to MAX_HOLD_MINUTES (5 min).
 * Minutes beyond that gap are skipped — no calorie data rather than stale data.
 */
export const computeCaloriesPerMinute = (params: CalorieCalcParams): CalorieDataPoint[] => {
  const { hr_samples, vo2_max, weight_kg, age_years, sex } = params
  const restingHr = params.resting_hr ?? DEFAULT_RESTING_HR

  if (hr_samples.length === 0) return []

  // Compute the baseline: formula output at resting_hr * multiplier.
  // This is subtracted from every minute to yield active-only calories.
  const baselineHr = restingHr * BASELINE_HR_MULTIPLIER
  const baselineKcal = computeTotalCaloriesForMinute(baselineHr, vo2_max, weight_kg, age_years, sex)

  // Determine time range
  const firstTime = hr_samples[0][0].getTime()
  const lastTime = hr_samples[hr_samples.length - 1][0].getTime()

  // For a single sample, it covers just the one minute bucket it falls in
  const endTime = hr_samples.length === 1 ? firstTime : lastTime

  // Align start to the beginning of its minute
  const startMinute = Math.floor(firstTime / 60_000) * 60_000
  const endMinute = Math.floor(endTime / 60_000) * 60_000

  const results: CalorieDataPoint[] = []

  // For each minute bucket, find the applicable HR (hold-last-value)
  let sampleIdx = 0
  const maxHoldMs = MAX_HOLD_MINUTES * 60_000

  for (let minuteMs = startMinute; minuteMs <= endMinute; minuteMs += 60_000) {
    const bucketStart = minuteMs
    const bucketEnd = minuteMs + 60_000

    // Advance sampleIdx to the last sample at or before bucketEnd
    while (sampleIdx < hr_samples.length - 1 && hr_samples[sampleIdx + 1][0].getTime() <= bucketStart) {
      sampleIdx++
    }

    // Collect all HR values that fall within or apply to this bucket
    const hrValues: number[] = []

    // If the current sample is at or before this bucket, its value applies (hold-last-value)
    // BUT only if within MAX_HOLD_MINUTES of the bucket start
    const lastSampleTime = hr_samples[sampleIdx][0].getTime()
    if (lastSampleTime <= bucketStart && bucketStart - lastSampleTime < maxHoldMs) {
      hrValues.push(hr_samples[sampleIdx][1])
    }

    // Also include any samples that fall within this bucket
    for (let i = sampleIdx; i < hr_samples.length; i++) {
      const sampleTime = hr_samples[i][0].getTime()
      if (sampleTime > bucketStart && sampleTime < bucketEnd) {
        hrValues.push(hr_samples[i][1])
      }
      if (sampleTime >= bucketEnd) break
    }

    // Skip this minute if we have no HR data
    if (hrValues.length === 0) continue

    // Average HR for this minute
    const avgHr = hrValues.reduce((a, b) => a + b, 0) / hrValues.length

    // Active calories = total formula output minus baseline
    const totalKcal = computeTotalCaloriesForMinute(avgHr, vo2_max, weight_kg, age_years, sex)
    const kcal = Math.max(0, totalKcal - baselineKcal)

    results.push({
      end_time: new Date(bucketEnd),
      kcal,
      time: new Date(bucketStart),
    })
  }

  return results
}

/**
 * Compute TOTAL calories burned in one minute (including BMR) given HR and parameters.
 * Returns 0 if the formula yields a negative value (very low HR).
 * This is the raw formula — use computeCaloriesForMinute for active-only calories.
 */
export const computeTotalCaloriesForMinute = (
  avgHr: number,
  vo2Max: number,
  weightKg: number,
  ageYears: number,
  sex: BiologicalSex,
): number => {
  let raw: number
  if (sex === 'male') {
    raw = (0.634 * avgHr + 0.404 * vo2Max + 0.394 * weightKg + 0.271 * ageYears - 95.7735) / 4.184
  } else {
    raw = (0.45 * avgHr + 0.38 * vo2Max + 0.103 * weightKg + 0.274 * ageYears - 59.3954) / 4.184
  }
  return Math.max(0, raw)
}

/**
 * Compute ACTIVE calories burned in one minute given HR, resting HR, and other parameters.
 * Subtracts the formula's output at resting_hr * BASELINE_HR_MULTIPLIER as the zero-point.
 * Returns 0 for HR at or below the baseline threshold (sleep, rest).
 */
export const computeCaloriesForMinute = (
  avgHr: number,
  vo2Max: number,
  weightKg: number,
  ageYears: number,
  sex: BiologicalSex,
  restingHr?: number,
): number => {
  const rhr = restingHr ?? DEFAULT_RESTING_HR
  const baselineHr = rhr * BASELINE_HR_MULTIPLIER
  const total = computeTotalCaloriesForMinute(avgHr, vo2Max, weightKg, ageYears, sex)
  const baseline = computeTotalCaloriesForMinute(baselineHr, vo2Max, weightKg, ageYears, sex)
  return Math.max(0, total - baseline)
}

// =============================================================================
// Zone-METs model (current)
// =============================================================================
//
// HR-based calorie estimation that walks the user's calibrated HR zones with
// MET anchors at each zone boundary and linear interpolation between them.
// METs are converted to kcal/min using the user's BMR (lab-measured if
// available; Mifflin-St Jeor fallback otherwise).
//
// Why this and not Keytel? The Keytel formula is calibrated against
// steady-state exercise (HR > ~60% HRmax) and systematically overshoots at
// resting/light-activity HR. Empirical replay against 14 days of intake data
// for a stable-weight user showed Keytel+lab-BMR overshooting by ~21% and
// the BMR/min baseline variant by ~92%, while zone-METs landed within ~10%.
//
// MET anchors (1 → 2 → 4 → 6 → 8.5 → 11 → 13) reflect typical physiology at
// the boundaries of the standard 5-zone model. Below rest: 1 MET (BMR).
// Above observed max: capped extrapolation.

/** MET anchors at boundaries [resting, z1, z2, z3, z4, z5, observed_max]. */
export const ZONE_METS_ANCHORS = [1, 2, 4, 6, 8.5, 11, 13] as const

export interface ZoneMetsContext {
  /** Resting HR (bpm). At and below this, METs = 1 (BMR-only). */
  resting_hr: number
  /** Custom or derived zone-start HRs in bpm: { 1, 2, 3, 4, 5 }. */
  zones: HrZoneThresholds
  /** Cached observed maximum HR (bpm). Used as the upper anchor. */
  observed_hr_max: number
}

/**
 * Compute METs at a given HR by linear interpolation between the anchors
 * [resting_hr, z1, z2, z3, z4, z5, observed_hr_max] using ZONE_METS_ANCHORS.
 * Returns 1 at and below resting_hr; 13 at and above observed_hr_max.
 */
export const computeMetsForHr = (hr: number, ctx: ZoneMetsContext): number => {
  const boundaries = [
    ctx.resting_hr,
    ctx.zones[1],
    ctx.zones[2],
    ctx.zones[3],
    ctx.zones[4],
    ctx.zones[5],
    ctx.observed_hr_max,
  ]
  if (hr <= boundaries[0]) return ZONE_METS_ANCHORS[0]
  if (hr >= boundaries[boundaries.length - 1]) return ZONE_METS_ANCHORS[ZONE_METS_ANCHORS.length - 1]
  for (let i = 0; i < boundaries.length - 1; i++) {
    if (hr < boundaries[i + 1]) {
      const span = boundaries[i + 1] - boundaries[i]
      if (span <= 0) return ZONE_METS_ANCHORS[i + 1]
      const t = (hr - boundaries[i]) / span
      return ZONE_METS_ANCHORS[i] + t * (ZONE_METS_ANCHORS[i + 1] - ZONE_METS_ANCHORS[i])
    }
  }
  return ZONE_METS_ANCHORS[ZONE_METS_ANCHORS.length - 1]
}

/**
 * Estimate BMR (kcal/day) using Mifflin-St Jeor when no lab value is known.
 * Returns null when required inputs are missing (no height etc).
 */
export const estimateBmrMifflinStJeor = (
  weightKg: number,
  heightCm: number,
  ageYears: number,
  sex: BiologicalSex,
): number => {
  const base = 10 * weightKg + 6.25 * heightCm - 5 * ageYears
  return sex === 'male' ? base + 5 : base - 161
}

export interface ZoneMetsCaloriesParams {
  /** Sorted HR samples: [timestamp, bpm] */
  hr_samples: [Date, number][]
  /** BMR in kcal/day (lab measurement preferred; Mifflin-St Jeor fallback). */
  bmr_kcal_per_day: number
  /** Zone-METs context (resting HR, zone thresholds, observed max). */
  zone_context: ZoneMetsContext
}

export interface ZoneMetsCaloriePoint {
  /** Start of the minute bucket */
  time: Date
  /** End of the minute bucket (time + 60s) */
  end_time: Date
  /** Total kcal burned this minute (BMR-floored: max(BMR/min, METs * BMR/min)). */
  kcal_total: number
  /** Active kcal this minute (kcal_total - BMR/min). Zero at and below rest. */
  kcal_active: number
  /** METs value used. */
  mets: number
}

/**
 * Compute per-minute total + active calories from HR samples using the
 * zone-METs model. Returns only minutes covered by HR data (within
 * MAX_HOLD_MINUTES of a sample). Callers are responsible for filling
 * uncovered minutes with BMR/min if a full-day series is desired.
 */
export const computeCaloriesPerMinuteZoneMets = (params: ZoneMetsCaloriesParams): ZoneMetsCaloriePoint[] => {
  const { hr_samples, bmr_kcal_per_day, zone_context } = params
  if (hr_samples.length === 0) return []

  const bmrPerMin = bmr_kcal_per_day / 1440

  const firstTime = hr_samples[0][0].getTime()
  const lastTime = hr_samples[hr_samples.length - 1][0].getTime()
  const endTime = hr_samples.length === 1 ? firstTime : lastTime

  const startMinute = Math.floor(firstTime / 60_000) * 60_000
  const endMinute = Math.floor(endTime / 60_000) * 60_000

  const results: ZoneMetsCaloriePoint[] = []
  const maxHoldMs = MAX_HOLD_MINUTES * 60_000
  let sampleIdx = 0

  for (let minuteMs = startMinute; minuteMs <= endMinute; minuteMs += 60_000) {
    const bucketStart = minuteMs
    const bucketEnd = minuteMs + 60_000

    while (sampleIdx < hr_samples.length - 1 && hr_samples[sampleIdx + 1][0].getTime() <= bucketStart) {
      sampleIdx++
    }

    const hrValues: number[] = []
    const lastSampleTime = hr_samples[sampleIdx][0].getTime()
    if (lastSampleTime <= bucketStart && bucketStart - lastSampleTime < maxHoldMs) {
      hrValues.push(hr_samples[sampleIdx][1])
    }
    for (let i = sampleIdx; i < hr_samples.length; i++) {
      const t = hr_samples[i][0].getTime()
      if (t > bucketStart && t < bucketEnd) hrValues.push(hr_samples[i][1])
      if (t >= bucketEnd) break
    }
    if (hrValues.length === 0) continue

    const avgHr = hrValues.reduce((a, b) => a + b, 0) / hrValues.length
    const mets = computeMetsForHr(avgHr, zone_context)
    const totalKcal = Math.max(bmrPerMin, mets * bmrPerMin)
    const activeKcal = totalKcal - bmrPerMin

    results.push({
      end_time: new Date(bucketEnd),
      kcal_active: activeKcal,
      kcal_total: totalKcal,
      mets,
      time: new Date(bucketStart),
    })
  }

  return results
}

/**
 * Derive default HR zone thresholds from observed_hr_max using percentages
 * of HRR (Heart Rate Reserve) over resting HR. Used when the user hasn't
 * customised their zones in settings.
 *
 * Anchors: 50%, 60%, 70%, 80%, 90% of HRR above resting HR.
 */
export const defaultHrZoneThresholds = (restingHr: number, observedMax: number): HrZoneThresholds => {
  const hrr = observedMax - restingHr
  return {
    1: Math.round(restingHr + 0.5 * hrr),
    2: Math.round(restingHr + 0.6 * hrr),
    3: Math.round(restingHr + 0.7 * hrr),
    4: Math.round(restingHr + 0.8 * hrr),
    5: Math.round(restingHr + 0.9 * hrr),
  }
}
