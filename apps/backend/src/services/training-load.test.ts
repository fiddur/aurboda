import { describe, expect, test } from 'vitest'

import type { Activity } from '../db/types'
import {
  calculateTrimp,
  computeTrainingLoad,
  computeTrainingLoadSeries,
  getAverageHrForSession,
  getEffectiveSettings,
  resolveHrMax,
  resolveHrRest,
  type TrainingLoadDeps,
} from './training-load'

// ============================================================================
// TRIMP Calculation
// ============================================================================

describe('calculateTrimp', () => {
  test('computes classic Banister TRIMP for a typical workout', () => {
    // 60-minute run, avg HR 150, resting HR 60, max HR 190, k=1.92
    // ΔHR_ratio = (150-60)/(190-60) = 90/130 ≈ 0.6923
    // TRIMP = 60 × 0.6923 × e^(1.92 × 0.6923)
    // = 60 × 0.6923 × e^(1.3293)
    // = 60 × 0.6923 × 3.7783
    // ≈ 156.9
    const trimp = calculateTrimp({
      avg_hr: 150,
      duration_minutes: 60,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
    expect(trimp).toBeCloseTo(156.9, 0)
  })

  test('returns 0 when avg HR is at or below resting HR', () => {
    expect(
      calculateTrimp({
        avg_hr: 60,
        duration_minutes: 30,
        hr_max: 190,
        hr_rest: 60,
        k_factor: 1.92,
      }),
    ).toBe(0)
  })

  test('returns 0 when duration is 0 or negative', () => {
    expect(
      calculateTrimp({
        avg_hr: 150,
        duration_minutes: 0,
        hr_max: 190,
        hr_rest: 60,
        k_factor: 1.92,
      }),
    ).toBe(0)
  })

  test('returns 0 when max HR <= resting HR', () => {
    expect(
      calculateTrimp({
        avg_hr: 150,
        duration_minutes: 30,
        hr_max: 60,
        hr_rest: 60,
        k_factor: 1.92,
      }),
    ).toBe(0)
  })

  test('clamps delta HR ratio to [0, 1]', () => {
    // avg_hr > hr_max should still give a valid result (clamped to 1.0)
    const trimp = calculateTrimp({
      avg_hr: 200,
      duration_minutes: 30,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
    // ratio clamped to 1.0: TRIMP = 30 × 1.0 × e^(1.92) ≈ 30 × 6.82 ≈ 204.7
    expect(trimp).toBeCloseTo(204.7, 0)
  })

  test('produces lower TRIMP with female k-factor', () => {
    const maleTrimp = calculateTrimp({
      avg_hr: 150,
      duration_minutes: 45,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
    const femaleTrimp = calculateTrimp({
      avg_hr: 150,
      duration_minutes: 45,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.67,
    })
    expect(femaleTrimp).toBeLessThan(maleTrimp)
    expect(femaleTrimp).toBeGreaterThan(0)
  })

  test('scales linearly with duration', () => {
    const trimp30 = calculateTrimp({
      avg_hr: 140,
      duration_minutes: 30,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
    const trimp60 = calculateTrimp({
      avg_hr: 140,
      duration_minutes: 60,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
    expect(trimp60).toBeCloseTo(trimp30 * 2, 1)
  })
})

// ============================================================================
// Training Load Series
// ============================================================================

describe('computeTrainingLoadSeries', () => {
  test('produces correct number of daily points', () => {
    const points = computeTrainingLoadSeries({
      daily_trimps: new Map(),
      end_date: '2024-01-10',
      start_date: '2024-01-01',
      tau_acute: 7,
      tau_chronic: 42,
    })
    expect(points).toHaveLength(10) // Jan 1-10 inclusive
  })

  test('all values are 0 when no workouts', () => {
    const points = computeTrainingLoadSeries({
      daily_trimps: new Map(),
      end_date: '2024-01-05',
      start_date: '2024-01-01',
      tau_acute: 7,
      tau_chronic: 42,
    })
    for (const p of points) {
      expect(p.atl).toBe(0)
      expect(p.ctl).toBe(0)
      expect(p.tsb).toBe(0)
      expect(p.daily_trimp).toBe(0)
    }
  })

  test('ATL decays faster than CTL after a single workout', () => {
    const trimps = new Map([['2024-01-01', 100]])
    const points = computeTrainingLoadSeries({
      daily_trimps: trimps,
      end_date: '2024-01-15',
      start_date: '2024-01-01',
      tau_acute: 7,
      tau_chronic: 42,
    })

    // Day 1: both ATL and CTL should be TRIMP × gain factor
    // gain_acute = 1 - e^(-1/7) ≈ 0.1331, gain_chronic = 1 - e^(-1/42) ≈ 0.0235
    // ATL = 100 × 0.1331 ≈ 13.31, CTL = 100 × 0.0235 ≈ 2.35
    expect(points[0].atl).toBeCloseTo(13.31, 0)
    expect(points[0].ctl).toBeCloseTo(2.35, 0)

    // ATL starts higher than CTL (faster response), so TSB is negative initially
    expect(points[0].tsb).toBeLessThan(0)

    // By day 8, ATL should have decayed more than CTL
    // ATL: 13.31 × e^(-7/7) ≈ 13.31 × 0.3679 ≈ 4.90
    // CTL: 2.35 × e^(-7/42) ≈ 2.35 × 0.8465 ≈ 1.99
    expect(points[7].atl).toBeCloseTo(4.9, 0)
    expect(points[7].ctl).toBeCloseTo(1.99, 0)

    // TSB should be negative but recovering (ATL decaying faster toward CTL)
    expect(points[14].atl).toBeLessThan(points[7].atl)
    expect(points[14].ctl).toBeLessThan(points[7].ctl)
  })

  test('regular training accumulates both ATL and CTL', () => {
    // Training every day for 7 days with TRIMP 50
    const trimps = new Map<string, number>()
    for (let i = 1; i <= 7; i++) {
      trimps.set(`2024-01-${String(i).padStart(2, '0')}`, 50)
    }

    const points = computeTrainingLoadSeries({
      daily_trimps: trimps,
      end_date: '2024-01-14',
      start_date: '2024-01-01',
      tau_acute: 7,
      tau_chronic: 42,
    })

    // ATL should peak around the last training day
    const atlValues = points.map((p) => p.atl)
    const maxAtlIdx = atlValues.indexOf(Math.max(...atlValues))
    expect(maxAtlIdx).toBeGreaterThanOrEqual(5) // Peak near end of training block
    expect(maxAtlIdx).toBeLessThanOrEqual(7)

    // CTL should still be rising or stable at the end of training
    expect(points[6].ctl).toBeGreaterThan(points[0].ctl)

    // After training stops, TSB should increase (recovery)
    expect(points[13].tsb).toBeGreaterThan(points[6].tsb)
  })

  test('assigns daily TRIMP correctly', () => {
    const trimps = new Map([
      ['2024-01-02', 75],
      ['2024-01-04', 120],
    ])
    const points = computeTrainingLoadSeries({
      daily_trimps: trimps,
      end_date: '2024-01-05',
      start_date: '2024-01-01',
      tau_acute: 7,
      tau_chronic: 42,
    })

    expect(points[0].daily_trimp).toBe(0) // Jan 1
    expect(points[1].daily_trimp).toBe(75) // Jan 2
    expect(points[2].daily_trimp).toBe(0) // Jan 3
    expect(points[3].daily_trimp).toBe(120) // Jan 4
    expect(points[4].daily_trimp).toBe(0) // Jan 5
  })
})

// ============================================================================
// HR Data Extraction
// ============================================================================

describe('getAverageHrForSession', () => {
  test('returns average of HR samples within session window', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T11:00:00Z')
    const samples: [Date, number][] = [
      [new Date('2024-01-01T10:00:00Z'), 120],
      [new Date('2024-01-01T10:15:00Z'), 140],
      [new Date('2024-01-01T10:30:00Z'), 160],
      [new Date('2024-01-01T10:45:00Z'), 150],
    ]
    expect(getAverageHrForSession(start, end, samples)).toBeCloseTo(142.5)
  })

  test('excludes HR samples outside session window', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T11:00:00Z')
    const samples: [Date, number][] = [
      [new Date('2024-01-01T09:00:00Z'), 70], // Before session
      [new Date('2024-01-01T10:30:00Z'), 150], // During session
      [new Date('2024-01-01T12:00:00Z'), 80], // After session
    ]
    expect(getAverageHrForSession(start, end, samples)).toBeCloseTo(150)
  })

  test('returns null when no HR samples in session', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T11:00:00Z')
    const samples: [Date, number][] = [
      [new Date('2024-01-01T08:00:00Z'), 70],
      [new Date('2024-01-01T12:00:00Z'), 80],
    ]
    expect(getAverageHrForSession(start, end, samples)).toBeNull()
  })

  test('returns null for empty samples', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T11:00:00Z')
    expect(getAverageHrForSession(start, end, [])).toBeNull()
  })
})

// ============================================================================
// Settings Resolution
// ============================================================================

describe('getEffectiveSettings', () => {
  test('returns defaults for male with no user settings', () => {
    const settings = getEffectiveSettings(undefined, 'male')
    expect(settings.k_factor).toBe(1.92)
    expect(settings.tau_acute).toBe(7)
    expect(settings.tau_chronic).toBe(42)
  })

  test('returns female k-factor default', () => {
    const settings = getEffectiveSettings(undefined, 'female')
    expect(settings.k_factor).toBe(1.67)
  })

  test('uses user overrides when provided', () => {
    const settings = getEffectiveSettings({ k_factor: 2.0, tau_acute: 5, tau_chronic: 30 }, 'male')
    expect(settings.k_factor).toBe(2.0)
    expect(settings.tau_acute).toBe(5)
    expect(settings.tau_chronic).toBe(30)
  })

  test('falls back to male k-factor when sex is undefined', () => {
    const settings = getEffectiveSettings(undefined, undefined)
    expect(settings.k_factor).toBe(1.92)
  })
})

describe('resolveHrMax', () => {
  test('prefers settings override', () => {
    expect(resolveHrMax(185, 195, '1985-01-01')).toBe(185)
  })

  test('falls back to observed max HR', () => {
    expect(resolveHrMax(undefined, 195, '1985-01-01')).toBe(195)
  })

  test('falls back to age-based estimate', () => {
    // Age ~41 in 2026: 220 - 41 = 179
    const result = resolveHrMax(undefined, undefined, '1985-01-01')
    expect(result).toBe(179)
  })

  test('uses ultimate fallback when nothing available', () => {
    expect(resolveHrMax(undefined, undefined, undefined)).toBe(190)
  })

  test('ignores observed HR below 100 (probably resting data)', () => {
    expect(resolveHrMax(undefined, 72, '1985-01-01')).toBe(179)
  })
})

describe('resolveHrRest', () => {
  test('prefers settings override', () => {
    expect(resolveHrRest(55, 62)).toBe(55)
  })

  test('falls back to latest observed resting HR', () => {
    expect(resolveHrRest(undefined, 62)).toBe(62)
  })

  test('uses fallback when nothing available', () => {
    expect(resolveHrRest(undefined, undefined)).toBe(60)
  })

  test('ignores resting HR below 30 (invalid data)', () => {
    expect(resolveHrRest(undefined, 25)).toBe(60)
  })
})

// ============================================================================
// Full Computation (Integration with Mocked Dependencies)
// ============================================================================

describe('computeTrainingLoad', () => {
  const makeActivity = (id: string, startStr: string, endStr: string, title?: string): Activity => ({
    activity_type: 'exercise',
    data: {},
    end_time: new Date(endStr),
    id,
    source: 'health_connect',
    start_time: new Date(startStr),
    title,
  })

  const makeDeps = (overrides: Partial<TrainingLoadDeps> = {}): TrainingLoadDeps => ({
    getExercises: async () => [],
    getHrSamples: async () => [],
    getLatestRestingHr: async () => 60,
    getMaxObservedHr: async () => 190,
    getUserSettings: async () => ({ birth_date: '1985-06-15', sex: 'male' as const }),
    ...overrides,
  })

  test('returns empty results when no exercises', async () => {
    const deps = makeDeps()
    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    expect(result.workouts).toHaveLength(0)
    expect(result.points.length).toBeGreaterThan(0)
    expect(result.points.every((p) => p.atl === 0 && p.ctl === 0)).toBe(true)
    expect(result.bootstrapping).toBe(true)
  })

  test('computes TRIMP for exercises with HR data', async () => {
    const exercises = [makeActivity('a1', '2024-01-03T10:00:00Z', '2024-01-03T11:00:00Z', 'Running')]
    const hrSamples: [Date, number][] = [
      [new Date('2024-01-03T10:00:00Z'), 140],
      [new Date('2024-01-03T10:30:00Z'), 160],
      [new Date('2024-01-03T11:00:00Z'), 150],
    ]

    const deps = makeDeps({
      getExercises: async () => exercises,
      getHrSamples: async () => hrSamples,
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].trimp).toBeGreaterThan(0)
    expect(result.workouts[0].avg_hr).toBeCloseTo(150)
    expect(result.workouts[0].title).toBe('Running')
    expect(result.workouts[0].duration_minutes).toBe(60)

    // ATL and CTL should be non-zero on workout day and after
    const jan3Point = result.points.find((p) => p.date === '2024-01-03')
    expect(jan3Point?.atl).toBeGreaterThan(0)
    expect(jan3Point?.ctl).toBeGreaterThan(0)
  })

  test('uses duration-based fallback when no HR data', async () => {
    const exercises = [makeActivity('a1', '2024-01-03T10:00:00Z', '2024-01-03T10:30:00Z', 'Strength')]

    const deps = makeDeps({
      getExercises: async () => exercises,
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    expect(result.workouts).toHaveLength(1)
    // Fallback: 30 min × 0.5 = 15
    expect(result.workouts[0].trimp).toBe(15)
    expect(result.workouts[0].avg_hr).toBeUndefined()
  })

  test('applies effective settings from user configuration', async () => {
    const deps = makeDeps({
      getUserSettings: async () => ({
        birth_date: '1985-06-15',
        sex: 'female' as const,
        training_load: {
          hr_max: 185,
          hr_rest: 50,
          k_factor: 1.67,
          tau_acute: 5,
          tau_chronic: 30,
        },
      }),
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    expect(result.settings.hr_max).toBe(185)
    expect(result.settings.hr_rest).toBe(50)
    expect(result.settings.k_factor).toBe(1.67)
    expect(result.settings.tau_acute).toBe(5)
    expect(result.settings.tau_chronic).toBe(30)
  })

  test('filters workouts and points to requested range', async () => {
    // Exercise in extended lookback range (before start date)
    const exercises = [
      makeActivity('a0', '2023-11-15T10:00:00Z', '2023-11-15T11:00:00Z', 'Old workout'),
      makeActivity('a1', '2024-01-03T10:00:00Z', '2024-01-03T11:00:00Z', 'In-range workout'),
    ]

    const deps = makeDeps({
      getExercises: async () => exercises,
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    // Only the in-range workout should be in workouts
    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].title).toBe('In-range workout')

    // Points should only cover Jan 1-7
    expect(result.points[0].date).toBe('2024-01-01')
    expect(result.points[result.points.length - 1].date).toBe('2024-01-07')
  })
})
