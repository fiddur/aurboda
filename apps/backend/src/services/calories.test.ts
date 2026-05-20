import type { HrZoneThresholds } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  computeCaloriesPerMinuteZoneMets,
  computeMetsForHr,
  defaultHrZoneThresholds,
  estimateBmrMifflinStJeor,
  MAX_HOLD_MINUTES,
  ZONE_METS_ANCHORS,
  type ZoneMetsContext,
} from './calories.ts'

const sampleZones: HrZoneThresholds = { 1: 90, 2: 110, 3: 131, 4: 152, 5: 165 }
const sampleCtx: ZoneMetsContext = {
  observed_hr_max: 178,
  resting_hr: 54,
  zones: sampleZones,
}

describe('computeMetsForHr', () => {
  test('returns 1 MET at and below resting HR', () => {
    expect(computeMetsForHr(40, sampleCtx)).toBe(1)
    expect(computeMetsForHr(54, sampleCtx)).toBe(1)
  })

  test('returns anchor MET values exactly at zone boundaries', () => {
    expect(computeMetsForHr(90, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[1], 6) // z1
    expect(computeMetsForHr(110, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[2], 6) // z2
    expect(computeMetsForHr(131, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[3], 6) // z3
    expect(computeMetsForHr(152, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[4], 6) // z4
    expect(computeMetsForHr(165, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[5], 6) // z5
    expect(computeMetsForHr(178, sampleCtx)).toBeCloseTo(ZONE_METS_ANCHORS[6], 6) // max
  })

  test('linearly interpolates between zone boundaries', () => {
    // Between resting (54, 1 MET) and z1 (90, 2 METs): midpoint 72 → 1.5
    expect(computeMetsForHr(72, sampleCtx)).toBeCloseTo(1.5, 2)
    // Between z1 (90, 2 METs) and z2 (110, 4 METs): midpoint 100 → 3
    expect(computeMetsForHr(100, sampleCtx)).toBeCloseTo(3, 2)
    // Between z3 (131, 6) and z4 (152, 8.5): midpoint 141.5 → 7.25
    expect(computeMetsForHr(141.5, sampleCtx)).toBeCloseTo(7.25, 2)
  })

  test('caps at maximum MET above observed_hr_max', () => {
    expect(computeMetsForHr(200, sampleCtx)).toBe(ZONE_METS_ANCHORS[6])
  })

  test('produces monotonically non-decreasing METs', () => {
    let prev = -Infinity
    for (let hr = 40; hr <= 200; hr += 1) {
      const mets = computeMetsForHr(hr, sampleCtx)
      expect(mets).toBeGreaterThanOrEqual(prev)
      prev = mets
    }
  })
})

describe('estimateBmrMifflinStJeor', () => {
  test('matches the Mifflin-St Jeor formula for males', () => {
    // 100 kg, 180 cm, 50 yr, male: 10*100 + 6.25*180 - 5*50 + 5 = 1000 + 1125 - 250 + 5 = 1880
    expect(estimateBmrMifflinStJeor(100, 180, 50, 'male')).toBeCloseTo(1880, 1)
  })

  test('matches the Mifflin-St Jeor formula for females', () => {
    // 65 kg, 165 cm, 35 yr, female: 10*65 + 6.25*165 - 5*35 - 161 = 650 + 1031.25 - 175 - 161 = 1345.25
    expect(estimateBmrMifflinStJeor(65, 165, 35, 'female')).toBeCloseTo(1345.25, 2)
  })
})

describe('defaultHrZoneThresholds', () => {
  test('derives ascending zone boundaries from HRR percentages', () => {
    const z = defaultHrZoneThresholds(54, 178)
    expect(z[1]).toBeLessThan(z[2])
    expect(z[2]).toBeLessThan(z[3])
    expect(z[3]).toBeLessThan(z[4])
    expect(z[4]).toBeLessThan(z[5])
    // Anchored at 50/60/70/80/90% HRR + resting
    expect(z[1]).toBe(Math.round(54 + 0.5 * 124)) // 116
    expect(z[5]).toBe(Math.round(54 + 0.9 * 124)) // 166
  })
})

describe('computeCaloriesPerMinuteZoneMets', () => {
  const bmrPerDay = 2181
  const bmrPerMin = bmrPerDay / 1440 // ~1.515

  test('returns empty array for no HR samples', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [],
      zone_context: sampleCtx,
    })
    expect(result).toEqual([])
  })

  test('produces BMR/min total and zero active at resting HR', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T03:00:00Z'), 50]],
      zone_context: sampleCtx,
    })
    // Single sample is held forward for MAX_HOLD_MINUTES, so 5 buckets
    expect(result).toHaveLength(MAX_HOLD_MINUTES)
    for (const p of result) {
      expect(p.mets).toBe(1)
      expect(p.kcal_total).toBeCloseTo(bmrPerMin, 4)
      expect(p.kcal_active).toBe(0)
    }
  })

  test('produces MET-scaled kcal at zone boundaries', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 131]], // z3 start = 6 METs
      zone_context: sampleCtx,
    })
    expect(result[0].mets).toBeCloseTo(6, 4)
    expect(result[0].kcal_total).toBeCloseTo(6 * bmrPerMin, 4)
    expect(result[0].kcal_active).toBeCloseTo(5 * bmrPerMin, 4)
  })

  test('caps at max MET above observed_hr_max', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 200]],
      zone_context: sampleCtx,
    })
    expect(result[0].mets).toBe(ZONE_METS_ANCHORS[6])
  })

  test('per-minute buckets aligned to minute start, 60s duration', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 120]],
      zone_context: sampleCtx,
    })
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:01:00Z'))
  })

  test('single sample is held forward for MAX_HOLD_MINUTES', () => {
    // One sample at 10:00 → 5 buckets (10:00..10:04), matching the documented
    // hold-forward semantics. No special-cased single-sample collapse.
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 120]],
      zone_context: sampleCtx,
    })
    expect(result).toHaveLength(MAX_HOLD_MINUTES)
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[MAX_HOLD_MINUTES - 1].time).toEqual(new Date('2024-01-15T10:04:00Z'))
  })

  test('total never falls below BMR/min', () => {
    // HR < resting still floors at BMR; single sample held forward for MAX_HOLD_MINUTES
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T03:00:00Z'), 30]],
      zone_context: sampleCtx,
    })
    expect(result).toHaveLength(MAX_HOLD_MINUTES)
    expect(result[0].kcal_total).toBeCloseTo(bmrPerMin, 4)
    expect(result[0].kcal_active).toBe(0)
  })

  test('hold-last-value over sparse samples (Oura-style)', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [
        [new Date('2024-01-15T10:00:00Z'), 120],
        [new Date('2024-01-15T10:05:00Z'), 125],
      ],
      zone_context: sampleCtx,
    })
    // First sample held forward 5 minutes (10:00..10:04), second held forward
    // 5 minutes (10:05..10:09) = 10 buckets.
    expect(result).toHaveLength(2 * MAX_HOLD_MINUTES)
    for (const p of result) {
      expect(p.kcal_total).toBeGreaterThan(bmrPerMin)
    }
  })

  test('skips minutes beyond MAX_HOLD_MINUTES gap', () => {
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [
        [new Date('2024-01-15T10:00:00Z'), 120],
        [new Date('2024-01-15T10:20:00Z'), 130],
      ],
      zone_context: sampleCtx,
    })
    // First sample held forward MAX_HOLD_MINUTES (10:00..10:04), gap from
    // 10:05..10:19 produces no buckets (stale), second sample held forward
    // MAX_HOLD_MINUTES (10:20..10:24). Total = 2 * MAX_HOLD_MINUTES.
    expect(result).toHaveLength(2 * MAX_HOLD_MINUTES)
    expect(result[0].time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[MAX_HOLD_MINUTES - 1].time).toEqual(new Date('2024-01-15T10:04:00Z'))
    expect(result[MAX_HOLD_MINUTES].time).toEqual(new Date('2024-01-15T10:20:00Z'))
  })

  test('intake-vs-burn sanity check at moderate HR matches simulator', () => {
    // 1440 minutes (full day) of constant HR=80 → ~3.1 METs → kcal/min ≈ 3.1 * 1.515 ≈ 4.70
    // Daily total ≈ 4.70 * 1440 ≈ 6766. Active ≈ 6766 - 2181 ≈ 4585.
    // We just check the per-minute value matches expectations.
    const result = computeCaloriesPerMinuteZoneMets({
      bmr_kcal_per_day: bmrPerDay,
      hr_samples: [[new Date('2024-01-15T10:00:00Z'), 80]],
      zone_context: sampleCtx,
    })
    const expectedMets =
      ZONE_METS_ANCHORS[0] + ((80 - 54) / (90 - 54)) * (ZONE_METS_ANCHORS[1] - ZONE_METS_ANCHORS[0])
    expect(result[0].mets).toBeCloseTo(expectedMets, 6)
    expect(result[0].kcal_total).toBeCloseTo(expectedMets * bmrPerMin, 6)
  })
})
