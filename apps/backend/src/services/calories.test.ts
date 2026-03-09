import { describe, expect, test } from 'vitest'

import { computeCaloriesForMinute, computeCaloriesPerMinute, getVo2MaxFallback } from './calories'

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

describe('computeCaloriesForMinute', () => {
  test('computes calories for a male', () => {
    // Man, 50 years old, 100 kg, VO2max 40, HR 120
    // CB = (0.634*120 + 0.404*40 + 0.394*100 + 0.271*50 - 95.7735) / 4.184
    // = (76.08 + 16.16 + 39.4 + 13.55 - 95.7735) / 4.184
    // = 49.4165 / 4.184
    // ≈ 11.811
    const result = computeCaloriesForMinute(120, 40, 100, 50, 'male')
    expect(result).toBeCloseTo(11.811, 2)
  })

  test('computes calories for a female', () => {
    // Woman, 35 years old, 65 kg, VO2max 35, HR 130
    // CB = (0.45*130 + 0.380*35 + 0.103*65 + 0.274*35 - 59.3954) / 4.184
    // = (58.5 + 13.3 + 6.695 + 9.59 - 59.3954) / 4.184
    // = 28.6896 / 4.184
    // ≈ 6.858
    const result = computeCaloriesForMinute(130, 35, 65, 35, 'female')
    expect(result).toBeCloseTo(6.858, 2)
  })

  test('clamps to 0 for very low heart rate', () => {
    // Very low HR where formula would go negative
    const result = computeCaloriesForMinute(40, 30, 50, 20, 'male')
    expect(result).toBe(0)
  })

  test('returns positive value for moderate exercise', () => {
    const result = computeCaloriesForMinute(150, 45, 80, 40, 'male')
    expect(result).toBeGreaterThan(0)
  })
})

describe('computeCaloriesPerMinute', () => {
  const baseParams = {
    age_years: 50,
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
    // First minute: HR 120, no other samples in [10:00, 10:01)
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:01:00Z'))
  })

  test('hold-last-value fills sparse data (5-minute intervals like Oura)', () => {
    // Oura sleep HR: one sample every 5 minutes
    const samples: [Date, number][] = [
      [new Date('2024-01-15T23:00:00Z'), 60],
      [new Date('2024-01-15T23:05:00Z'), 58],
      [new Date('2024-01-15T23:10:00Z'), 55],
    ]
    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })

    // Should produce 11 minute buckets (23:00 through 23:10)
    expect(result).toHaveLength(11)

    // First minute uses HR 60
    expect(result[0].kcal).toBeCloseTo(computeCaloriesForMinute(60, 40, 100, 50, 'male'), 4)

    // Minutes 1-4 (23:01-23:04) also use HR 60 (hold-last-value)
    expect(result[1].kcal).toBeCloseTo(result[0].kcal, 4)
    expect(result[4].kcal).toBeCloseTo(result[0].kcal, 4)

    // Minute 5 (23:05) uses HR 58
    expect(result[5].kcal).toBeCloseTo(computeCaloriesForMinute(58, 40, 100, 50, 'male'), 4)
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
    expect(result[0].kcal).toBeCloseTo(computeCaloriesForMinute(110, 40, 100, 50, 'male'), 4)
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

  test('total calories for a 30-minute run match formula', () => {
    // 30 minutes of constant 150bpm running
    const samples: [Date, number][] = Array.from(
      { length: 31 },
      (_, i) => [new Date(`2024-01-15T10:${String(i).padStart(2, '0')}:00Z`), 150] as [Date, number],
    )

    const result = computeCaloriesPerMinute({ ...baseParams, hr_samples: samples })
    const totalKcal = result.reduce((sum, p) => sum + p.kcal, 0)

    // Formula: CB = T * (0.634*150 + 0.404*40 + 0.394*100 + 0.271*50 - 95.7735) / 4.184
    //            = 30 * (95.1 + 16.16 + 39.4 + 13.55 - 95.7735) / 4.184
    //            = 30 * 68.4365 / 4.184
    //            = 30 * 16.3579...
    //            ≈ 490.74
    const expectedPerMinute = (0.634 * 150 + 0.404 * 40 + 0.394 * 100 + 0.271 * 50 - 95.7735) / 4.184
    const expectedTotal = 31 * expectedPerMinute

    expect(totalKcal).toBeCloseTo(expectedTotal, 0)
  })
})
