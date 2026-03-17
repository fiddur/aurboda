import { describe, expect, test } from 'vitest'

import {
  BASELINE_HR_MULTIPLIER,
  type CalorieDataPoint,
  computeCaloriesForMinute,
  computeCaloriesPerMinute,
  computeGapFillPoints,
  computeTotalCaloriesForMinute,
  DEFAULT_RESTING_HR,
  getVo2MaxFallback,
  MAX_HOLD_MINUTES,
} from './calories.ts'

describe('getVo2MaxFallback', () => {
  test('returns age-appropriate fallback for male', () => {
    expect(getVo2MaxFallback('male', 25)).toBe(42) // < 30
    expect(getVo2MaxFallback('male', 35)).toBe(40) // < 40
    expect(getVo2MaxFallback('male', 49)).toBe(37) // < 50
    expect(getVo2MaxFallback('male', 55)).toBe(34) // < 60
    expect(getVo2MaxFallback('male', 75)).toBe(28) // >= 70
  })

  test('returns age-appropriate fallback for female', () => {
    expect(getVo2MaxFallback('female', 25)).toBe(36) // < 30
    expect(getVo2MaxFallback('female', 45)).toBe(31) // < 50
    expect(getVo2MaxFallback('female', 80)).toBe(23) // >= 70
  })
})

describe('computeTotalCaloriesForMinute', () => {
  test('computes total calories for a male (including BMR)', () => {
    // Man, 50 years old, 100 kg, VO2max 40, HR 120
    // CB = (0.634*120 + 0.404*40 + 0.394*100 + 0.271*50 - 95.7735) / 4.184
    // = (76.08 + 16.16 + 39.4 + 13.55 - 95.7735) / 4.184
    // = 49.4165 / 4.184
    // ≈ 11.811
    const result = computeTotalCaloriesForMinute(120, 40, 100, 50, 'male')
    expect(result).toBeCloseTo(11.811, 2)
  })

  test('computes total calories for a female', () => {
    // Woman, 35 years old, 65 kg, VO2max 35, HR 130
    // CB = (0.45*130 + 0.380*35 + 0.103*65 + 0.274*35 - 59.3954) / 4.184
    // = (58.5 + 13.3 + 6.695 + 9.59 - 59.3954) / 4.184
    // = 28.6896 / 4.184
    // ≈ 6.858
    const result = computeTotalCaloriesForMinute(130, 35, 65, 35, 'female')
    expect(result).toBeCloseTo(6.858, 2)
  })

  test('clamps to 0 for very low heart rate', () => {
    const result = computeTotalCaloriesForMinute(40, 30, 50, 20, 'male')
    expect(result).toBe(0)
  })

  test('returns positive value for moderate exercise', () => {
    const result = computeTotalCaloriesForMinute(150, 45, 80, 40, 'male')
    expect(result).toBeGreaterThan(0)
  })
})

describe('computeCaloriesForMinute (active-only with baseline subtraction)', () => {
  test('returns 0 at resting HR (below baseline threshold)', () => {
    // At resting HR 55, baseline HR = 55 * 1.2 = 66
    // HR 55 is below the baseline, so active calories should be 0
    const result = computeCaloriesForMinute(55, 40, 100, 50, 'male', 55)
    expect(result).toBe(0)
  })

  test('returns 0 at sleep HR (at or below baseline threshold)', () => {
    // Resting HR 55, baseline HR = 66
    // Sleep HR of 60 is below baseline
    const result = computeCaloriesForMinute(60, 40, 100, 50, 'male', 55)
    expect(result).toBe(0)
  })

  test('returns 0 exactly at the baseline HR threshold', () => {
    // Resting HR 55, baseline HR = 66
    const result = computeCaloriesForMinute(66, 40, 100, 50, 'male', 55)
    expect(result).toBe(0)
  })

  test('returns small positive value just above baseline threshold', () => {
    // Resting HR 55, baseline HR = 66
    // HR 70 is slightly above baseline
    const result = computeCaloriesForMinute(70, 40, 100, 50, 'male', 55)
    expect(result).toBeGreaterThan(0)
    expect(result).toBeLessThan(1) // should be small
  })

  test('returns active calories for exercise HR', () => {
    // Resting HR 55, baseline HR = 66
    const restingHr = 55
    const baselineHr = restingHr * BASELINE_HR_MULTIPLIER
    const total = computeTotalCaloriesForMinute(120, 40, 100, 50, 'male')
    const baseline = computeTotalCaloriesForMinute(baselineHr, 40, 100, 50, 'male')
    const expected = total - baseline

    const result = computeCaloriesForMinute(120, 40, 100, 50, 'male', restingHr)
    expect(result).toBeCloseTo(expected, 4)
    expect(result).toBeGreaterThan(5) // substantial active calories at HR 120
  })

  test('uses DEFAULT_RESTING_HR when resting HR not provided', () => {
    const baselineHr = DEFAULT_RESTING_HR * BASELINE_HR_MULTIPLIER
    const total = computeTotalCaloriesForMinute(120, 40, 100, 50, 'male')
    const baseline = computeTotalCaloriesForMinute(baselineHr, 40, 100, 50, 'male')
    const expected = total - baseline

    const result = computeCaloriesForMinute(120, 40, 100, 50, 'male')
    expect(result).toBeCloseTo(expected, 4)
  })

  test('active calories are less than total calories', () => {
    const active = computeCaloriesForMinute(150, 45, 80, 40, 'male', 55)
    const total = computeTotalCaloriesForMinute(150, 45, 80, 40, 'male')
    expect(active).toBeGreaterThan(0)
    expect(active).toBeLessThan(total)
  })
})

describe('computeCaloriesPerMinute', () => {
  const baseParams = {
    age_years: 50,
    resting_hr: 55,
    sex: 'male' as const,
    vo2_max: 40,
    weight_kg: 100,
  }

  test('returns empty array for no HR samples', () => {
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: [] })
    expect(result).toEqual([])
  })

  test('returns one data point for a single HR sample', () => {
    const result = computeCaloriesPerMinute({
      ...baseParams,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 120]],
    })
    expect(result).toHaveLength(1)
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:01:00Z'))
    expect(result[0].kcal).toBeGreaterThan(0)
  })

  test('returns 0 kcal for sleep-range HR', () => {
    // HR 60 with resting HR 55 → baseline HR 66 → should be 0
    const result = computeCaloriesPerMinute({
      ...baseParams,
      hr_samples: [[new Date('2024-01-15T23:00:00Z'), 60]],
    })
    expect(result).toHaveLength(1)
    expect(result[0].kcal).toBe(0)
  })

  test('produces per-minute buckets for dense HR data', () => {
    // 5 samples over 4 minutes (every 60 seconds)
    const samples: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 120],
      [new Date('2024-01-15T10:01:00Z'), 125],
      [new Date('2024-01-15T10:02:00Z'), 130],
      [new Date('2024-01-15T10:03:00Z'), 128],
      [new Date('2024-01-15T10:04:00Z'), 122],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })
    expect(result).toHaveLength(5)

    // Each minute should have the corresponding HR value
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:01:00Z'))

    // All should have positive active calories (HR > 66 threshold)
    for (const point of result) {
      expect(point.kcal).toBeGreaterThan(0)
    }
  })

  test('hold-last-value fills sparse data (5-minute intervals like Oura)', () => {
    // Oura sleep HR: one sample every 5 minutes
    const samples: [Date, number][] = [
      [new Date('2024-01-15T23:00:00Z'), 60],
      [new Date('2024-01-15T23:05:00Z'), 58],
      [new Date('2024-01-15T23:10:00Z'), 55],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })

    // 23:00-23:04 from first sample (5 buckets), 23:05-23:09 from second (5 buckets),
    // 23:10 from third (1 bucket) = 11 total
    expect(result).toHaveLength(11)

    // All sleep-range HR values should produce 0 active calories
    for (const point of result) {
      expect(point.kcal).toBe(0)
    }
  })

  test('skips minutes beyond MAX_HOLD_MINUTES gap', () => {
    // Two readings 20 minutes apart — only the first MAX_HOLD_MINUTES should be filled
    const samples: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 120],
      [new Date('2024-01-15T10:20:00Z'), 130],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })

    // 10:00-10:04 from first sample (5 buckets) + 10:20 from second (1 bucket) = 6 total
    expect(result).toHaveLength(MAX_HOLD_MINUTES + 1)
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[MAX_HOLD_MINUTES - 1].time).toEqual(new Date('2024-01-15T10:04:00Z'))
    expect(result[MAX_HOLD_MINUTES].time).toEqual(new Date('2024-01-15T10:20:00Z'))
  })

  test('does not produce stale data for hours-long gaps', () => {
    // Workout ends at 18:00, next reading at 23:00 (sleep)
    const samples: [Date, number][] = [
      [new Date('2024-01-15T18:00:00Z'), 150],
      [new Date('2024-01-15T23:00:00Z'), 55],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })

    // Only MAX_HOLD_MINUTES from the first sample + 1 from the second
    expect(result).toHaveLength(MAX_HOLD_MINUTES + 1)

    // Exercise HR should produce positive active calories
    expect(result[0].kcal).toBeGreaterThan(0)

    // Sleep HR (55, below baseline 66) should produce 0
    expect(result[MAX_HOLD_MINUTES].kcal).toBe(0)
  })

  test('averages multiple HR samples within same minute', () => {
    // Two samples in the same minute
    const samples: [Date, number][] = [
      [new Date('2024-01-15T10:00:10Z'), 100],
      [new Date('2024-01-15T10:00:40Z'), 120],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })
    expect(result).toHaveLength(1)

    // Average of 100 and 120 = 110
    expect(result[0].kcal).toBeCloseTo(computeCaloriesForMinute(110, 40, 100, 50, 'male', 55), 4)
  })

  test('all data points have 60-second intervals', () => {
    const samples: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 120],
      [new Date('2024-01-15T10:05:00Z'), 130],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })

    for (const point of result) {
      const diffMs = point.end_time.getTime() - point.time.getTime()
      expect(diffMs).toBe(60_000)
    }
  })

  test('total active calories for a 30-minute run are less than total burn', () => {
    // 31 minutes of constant 150bpm running
    const samples: [Date, number][] = Array.from(
      { length: 31 },
      (_, i) => [new Date(`2024-01-15T10:${String(i).padStart(2, '0')}:00Z`), 150] as [Date, number],
    )

    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })
    const totalActiveKcal = result.reduce((sum, p) => sum + p.kcal, 0)

    // The active calories should be less than the total formula output
    const totalPerMinute = computeTotalCaloriesForMinute(150, 40, 100, 50, 'male')
    const totalBurn = 31 * totalPerMinute
    expect(totalActiveKcal).toBeLessThan(totalBurn)

    // But still substantial (most of the burn at HR 150 is active)
    const activePerMinute = computeCaloriesForMinute(150, 40, 100, 50, 'male', 55)
    const expectedActive = 31 * activePerMinute
    expect(totalActiveKcal).toBeCloseTo(expectedActive, 0)
  })

  test('uses default resting HR when not provided', () => {
    const withResting = computeCaloriesPerMinute({
      ...baseParams,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 120]],
      resting_hr: DEFAULT_RESTING_HR,
    })
    const withoutResting = computeCaloriesPerMinute({
      ...baseParams,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 120]],
      resting_hr: undefined,
    })
    expect(withResting[0].kcal).toBeCloseTo(withoutResting[0].kcal, 4)
  })
})

describe('computeGapFillPoints', () => {
  const dayStart = new Date('2024-01-15T00:00:00Z')

  /** Helper to create a CalorieDataPoint at a given minute offset from day start. */
  const makePoint = (minuteOffset: number, kcal: number): CalorieDataPoint => ({
    end_time: new Date(dayStart.getTime() + (minuteOffset + 1) * 60_000),
    kcal,
    time: new Date(dayStart.getTime() + minuteOffset * 60_000),
  })

  test('returns empty result when HC aggregate is 0', () => {
    const result = computeGapFillPoints({
      aurboda_points: [makePoint(600, 5)],
      day_start: dayStart,
      hc_aggregate_kcal: 0,
    })
    expect(result.points).toHaveLength(0)
    expect(result.gap_minutes).toBe(0)
    expect(result.residual_kcal).toBe(0)
  })

  test('returns empty result when aurboda sum >= HC aggregate', () => {
    // Aurboda computed more than HC thinks — nothing to distribute
    const result = computeGapFillPoints({
      aurboda_points: [makePoint(600, 10), makePoint(601, 10)],
      day_start: dayStart,
      hc_aggregate_kcal: 15,
    })
    expect(result.points).toHaveLength(0)
    expect(result.residual_kcal).toBe(0)
  })

  test('returns empty result when no gap minutes exist (full coverage)', () => {
    // 1440 points covering every minute of the day
    const points = Array.from({ length: 1440 }, (_, i) => makePoint(i, 0.5))
    const aurbodaSum = 1440 * 0.5 // 720 kcal

    const result = computeGapFillPoints({
      aurboda_points: points,
      day_start: dayStart,
      hc_aggregate_kcal: aurbodaSum + 100, // HC has more, but no gaps
    })
    expect(result.points).toHaveLength(0)
    expect(result.gap_minutes).toBe(0)
  })

  test('distributes residual evenly across gap minutes', () => {
    // 60 minutes of HR data (10:00-10:59), total 120 kcal
    const points = Array.from({ length: 60 }, (_, i) => makePoint(600 + i, 2))

    // HC says 220 kcal total, aurboda sum = 120, residual = 100 kcal
    const result = computeGapFillPoints({
      aurboda_points: points,
      day_start: dayStart,
      hc_aggregate_kcal: 220,
    })

    // 1440 - 60 = 1380 gap minutes
    expect(result.gap_minutes).toBe(1380)
    expect(result.residual_kcal).toBeCloseTo(100, 4)
    expect(result.per_minute_kcal).toBeCloseTo(100 / 1380, 4)
    expect(result.points).toHaveLength(1380)

    // Total of gap-fill points should equal the residual
    const gapTotal = result.points.reduce((sum, p) => sum + p.kcal, 0)
    expect(gapTotal).toBeCloseTo(100, 2)
  })

  test('gap-fill points have correct time boundaries', () => {
    // Single aurboda point at 10:00
    const result = computeGapFillPoints({
      aurboda_points: [makePoint(600, 5)],
      day_start: dayStart,
      hc_aggregate_kcal: 100,
    })

    // 1439 gap minutes (all except minute 600)
    expect(result.gap_minutes).toBe(1439)

    // Each point should be exactly 1 minute long
    for (const p of result.points) {
      expect(p.end_time.getTime() - p.time.getTime()).toBe(60_000)
    }

    // First gap point is at midnight
    expect(result.points[0].time).toEqual(dayStart)

    // Last gap point is at 23:59
    const lastPoint = result.points[result.points.length - 1]
    expect(lastPoint.time).toEqual(new Date('2024-01-15T23:59:00Z'))

    // Minute 600 (10:00) should NOT be in gap-fill points
    const gap600 = result.points.find((p) => p.time.getTime() === dayStart.getTime() + 600 * 60_000)
    expect(gap600).toBeUndefined()
  })

  test('gap-fill points do not overlap with aurboda points', () => {
    // Aurboda covers 08:00-08:59 and 17:00-17:29
    const points = [
      ...Array.from({ length: 60 }, (_, i) => makePoint(480 + i, 3)),
      ...Array.from({ length: 30 }, (_, i) => makePoint(1020 + i, 4)),
    ]

    const result = computeGapFillPoints({
      aurboda_points: points,
      day_start: dayStart,
      hc_aggregate_kcal: 500,
    })

    // 1440 - 60 - 30 = 1350 gap minutes
    expect(result.gap_minutes).toBe(1350)

    // No gap point should have the same minute as an aurboda point
    const aurbodaMinutes = new Set(points.map((p) => p.time.getTime()))
    for (const gapPoint of result.points) {
      expect(aurbodaMinutes.has(gapPoint.time.getTime())).toBe(false)
    }
  })

  test('realistic scenario: 8h sleep + 1h exercise, HC has movement data too', () => {
    // Sleep 23:00 prev day → 07:00 (covered by HR, but 0 active kcal since below baseline)
    // Exercise 17:00-17:59 (covered by HR, high active kcal)
    // HC aggregate = 400 kcal (includes movement during uncovered hours)
    const sleepPoints = Array.from({ length: 420 }, (_, i) => makePoint(i, 0)) // 00:00-06:59, 0 kcal each
    const exercisePoints = Array.from({ length: 60 }, (_, i) => makePoint(1020 + i, 5)) // 17:00-17:59, 5 kcal each
    const allPoints = [...sleepPoints, ...exercisePoints]
    const aurbodaSum = 60 * 5 // 300 kcal (only exercise contributes)

    const result = computeGapFillPoints({
      aurboda_points: allPoints,
      day_start: dayStart,
      hc_aggregate_kcal: 400,
    })

    // 1440 - 420 - 60 = 960 gap minutes
    expect(result.gap_minutes).toBe(960)
    expect(result.residual_kcal).toBeCloseTo(100, 4) // 400 - 300 = 100 kcal
    expect(result.per_minute_kcal).toBeCloseTo(100 / 960, 4)

    // Total gap-fill + aurboda should approximate HC aggregate
    const gapTotal = result.points.reduce((sum, p) => sum + p.kcal, 0)
    expect(gapTotal + aurbodaSum).toBeCloseTo(400, 1)
  })

  test('handles very small residual correctly', () => {
    // Only 1 kcal residual across 1000 gap minutes
    const points = Array.from({ length: 440 }, (_, i) => makePoint(i, 0.1))
    const aurbodaSum = 440 * 0.1 // 44 kcal

    const result = computeGapFillPoints({
      aurboda_points: points,
      day_start: dayStart,
      hc_aggregate_kcal: aurbodaSum + 1,
    })

    expect(result.gap_minutes).toBe(1000)
    expect(result.residual_kcal).toBeCloseTo(1, 4)
    expect(result.per_minute_kcal).toBeCloseTo(0.001, 4)
  })
})
