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

import type { BiologicalSex } from '@aurboda/api-spec'

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
