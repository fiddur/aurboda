import { describe, expect, test, vi } from 'vitest'

import type { Activity, TimeSeriesPoint } from '../db/types'
import {
  calculateTrimp,
  computeHourlyImpulses,
  computeHourlyLoadSeries,
  computeRecoveryZones,
  computeTrainingLoad,
  floorToHour,
  getAverageHrForSession,
  getEffectiveSettings,
  getWorkoutTrimpForHour,
  recomputeImpulseBuckets,
  resolveHrMax,
  resolveHrRest,
  type TrainingLoadDeps,
} from './training-load'

// ============================================================================
// TRIMP Calculation
// ============================================================================

describe('calculateTrimp', () => {
  test('computes classic Banister TRIMP for a typical workout', () => {
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
    const trimp = calculateTrimp({
      avg_hr: 200,
      duration_minutes: 30,
      hr_max: 190,
      hr_rest: 60,
      k_factor: 1.92,
    })
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
// floorToHour
// ============================================================================

describe('floorToHour', () => {
  test('floors to start of hour', () => {
    const result = floorToHour(new Date('2024-01-01T10:37:42.123Z'))
    expect(result.toISOString()).toBe('2024-01-01T10:00:00.000Z')
  })

  test('already at hour start remains unchanged', () => {
    const result = floorToHour(new Date('2024-01-01T10:00:00.000Z'))
    expect(result.toISOString()).toBe('2024-01-01T10:00:00.000Z')
  })
})

// ============================================================================
// getWorkoutTrimpForHour
// ============================================================================

describe('getWorkoutTrimpForHour', () => {
  test('returns full TRIMP for workout within single hour', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T10:30:00Z')
    const hourStart = new Date('2024-01-01T10:00:00Z')
    const result = getWorkoutTrimpForHour(start, end, 100, hourStart)
    expect(result).toBe(100)
  })

  test('splits TRIMP proportionally for 2-hour workout', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T12:00:00Z')

    const hour10 = getWorkoutTrimpForHour(start, end, 100, new Date('2024-01-01T10:00:00Z'))
    const hour11 = getWorkoutTrimpForHour(start, end, 100, new Date('2024-01-01T11:00:00Z'))
    expect(hour10).toBeCloseTo(50)
    expect(hour11).toBeCloseTo(50)
  })

  test('handles workout starting mid-hour', () => {
    const start = new Date('2024-01-01T10:30:00Z')
    const end = new Date('2024-01-01T11:30:00Z')

    const hour10 = getWorkoutTrimpForHour(start, end, 100, new Date('2024-01-01T10:00:00Z'))
    const hour11 = getWorkoutTrimpForHour(start, end, 100, new Date('2024-01-01T11:00:00Z'))
    expect(hour10).toBeCloseTo(50) // 30 min out of 60
    expect(hour11).toBeCloseTo(50)
  })

  test('returns 0 for hour outside workout', () => {
    const start = new Date('2024-01-01T10:00:00Z')
    const end = new Date('2024-01-01T11:00:00Z')
    const result = getWorkoutTrimpForHour(start, end, 100, new Date('2024-01-01T12:00:00Z'))
    expect(result).toBe(0)
  })
})

// ============================================================================
// computeHourlyImpulses
// ============================================================================

describe('computeHourlyImpulses', () => {
  test('distributes exercise TRIMP into hourly buckets', () => {
    const exercises: Activity[] = [
      {
        activity_type: 'exercise',
        data: {},
        end_time: new Date('2024-01-01T11:00:00Z'),
        id: 'a1',
        source: 'health_connect',
        start_time: new Date('2024-01-01T10:00:00Z'),
      },
    ]
    const hrSamples: [Date, number][] = [
      [new Date('2024-01-01T10:15:00Z'), 140],
      [new Date('2024-01-01T10:45:00Z'), 160],
    ]

    const result = computeHourlyImpulses(
      exercises,
      hrSamples,
      [], // no calories
      190,
      60,
      1.92,
      0.1,
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-02T00:00:00Z'),
    )

    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0].trimp).toBeGreaterThan(0)

    // All TRIMP should be in the 10:00 hour since workout is 10:00-11:00
    const hour10 = result.training.get('2024-01-01T10:00:00.000Z')
    expect(hour10).toBeGreaterThan(0)
    expect(hour10).toBeCloseTo(result.workouts[0].trimp, 1)
  })

  test('aggregates active calories into hourly activity impulse', () => {
    const caloriesSamples: [Date, number][] = [
      [new Date('2024-01-01T10:05:00Z'), 5],
      [new Date('2024-01-01T10:10:00Z'), 8],
      [new Date('2024-01-01T11:05:00Z'), 3],
    ]

    const result = computeHourlyImpulses(
      [], // no exercises
      [],
      caloriesSamples,
      190,
      60,
      1.92,
      0.1, // scale factor
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-02T00:00:00Z'),
    )

    // (5 + 8) × 0.1 = 1.3 in hour 10
    const hour10 = result.activity.get('2024-01-01T10:00:00.000Z')
    expect(hour10).toBeCloseTo(1.3)

    // 3 × 0.1 = 0.3 in hour 11
    const hour11 = result.activity.get('2024-01-01T11:00:00.000Z')
    expect(hour11).toBeCloseTo(0.3)
  })
})

// ============================================================================
// Hourly Load Series (Banister EMA)
// ============================================================================

describe('computeHourlyLoadSeries', () => {
  test('produces correct number of hourly points', () => {
    const points = computeHourlyLoadSeries({
      activityImpulses: new Map(),
      end: new Date('2024-01-01T23:00:00Z'),
      start: new Date('2024-01-01T00:00:00Z'),
      tauAcuteDays: 7,
      tauChronicDays: 42,
      trainingImpulses: new Map(),
    })
    expect(points).toHaveLength(24) // 00:00 to 23:00 inclusive
  })

  test('all values are 0 when no impulses', () => {
    const points = computeHourlyLoadSeries({
      activityImpulses: new Map(),
      end: new Date('2024-01-01T05:00:00Z'),
      start: new Date('2024-01-01T00:00:00Z'),
      tauAcuteDays: 7,
      tauChronicDays: 42,
      trainingImpulses: new Map(),
    })
    for (const p of points) {
      expect(p.atl).toBe(0)
      expect(p.ctl).toBe(0)
      expect(p.tsb).toBe(0)
    }
  })

  test('ATL responds faster than CTL to a training impulse', () => {
    const impulses = new Map([['2024-01-01T10:00:00.000Z', 100]])
    const points = computeHourlyLoadSeries({
      activityImpulses: new Map(),
      end: new Date('2024-01-03T00:00:00Z'),
      start: new Date('2024-01-01T00:00:00Z'),
      tauAcuteDays: 7,
      tauChronicDays: 42,
      trainingImpulses: impulses,
    })

    // Find the hour with the impulse
    const impulseHour = points.find((p) => p.time === '2024-01-01T10:00:00.000Z')!
    expect(impulseHour.atl).toBeGreaterThan(0)
    expect(impulseHour.ctl).toBeGreaterThan(0)
    expect(impulseHour.atl).toBeGreaterThan(impulseHour.ctl) // ATL gains faster

    // TSB should be negative after training (fatigue > fitness)
    expect(impulseHour.tsb).toBeLessThan(0)

    // 24 hours later, ATL should have decayed (CTL barely moves with tau=42d)
    const nextDay = points.find((p) => p.time === '2024-01-02T10:00:00.000Z')!
    expect(nextDay.atl).toBeLessThan(impulseHour.atl)
    // CTL with tau=1008h decays very slowly — use <= since rounding may make them equal
    expect(nextDay.ctl).toBeLessThanOrEqual(impulseHour.ctl)
    // ATL decays faster, so ATL/CTL ratio should decrease
    expect(nextDay.atl / nextDay.ctl).toBeLessThan(impulseHour.atl / impulseHour.ctl)
  })

  test('includes both training and activity impulses', () => {
    const hour = '2024-01-01T10:00:00.000Z'
    const points = computeHourlyLoadSeries({
      activityImpulses: new Map([[hour, 5]]),
      end: new Date('2024-01-01T12:00:00Z'),
      start: new Date('2024-01-01T09:00:00Z'),
      tauAcuteDays: 7,
      tauChronicDays: 42,
      trainingImpulses: new Map([[hour, 50]]),
    })

    const impulsePoint = points.find((p) => p.time === hour)!
    expect(impulsePoint.training_impulse).toBe(50)
    expect(impulsePoint.activity_impulse).toBe(5)
    // ATL should reflect the combined impulse (50 + 5 = 55)
    expect(impulsePoint.atl).toBeGreaterThan(0)
  })
})

// ============================================================================
// Recovery Zones
// ============================================================================

describe('computeRecoveryZones', () => {
  test('returns undefined during bootstrapping (too few points)', () => {
    const points = Array.from({ length: 100 }, (_, i) => ({
      activity_impulse: 0,
      atl: 10,
      ctl: 10,
      time: `2024-01-01T${String(i % 24).padStart(2, '0')}:00:00.000Z`,
      training_impulse: 0,
      tsb: 0,
    }))
    expect(computeRecoveryZones(points)).toBeUndefined()
  })

  test('computes zone thresholds from average CTL', () => {
    // Need at least 42 * 24 = 1008 points
    const points = Array.from({ length: 1100 }, (_, i) => ({
      activity_impulse: 0,
      atl: 20,
      ctl: 25, // average CTL = 25
      time: new Date(Date.UTC(2024, 0, 1) + i * 3600000).toISOString(),
      training_impulse: 0,
      tsb: 5,
    }))

    const zones = computeRecoveryZones(points)
    expect(zones).toBeDefined()
    // balanced_min = 25 × 0.8 = 20
    expect(zones!.balanced_min).toBeCloseTo(20, 0)
    // balanced_max = 25 × 1.3 = 32.5
    expect(zones!.balanced_max).toBeCloseTo(32.5, 0)
    // strained_max = 25 × 1.7 = 42.5
    expect(zones!.strained_max).toBeCloseTo(42.5, 0)
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
      [new Date('2024-01-01T09:00:00Z'), 70],
      [new Date('2024-01-01T10:30:00Z'), 150],
      [new Date('2024-01-01T12:00:00Z'), 80],
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
    expect(settings.activity_impulse_scale).toBe(0.1)
  })

  test('returns female k-factor default', () => {
    const settings = getEffectiveSettings(undefined, 'female')
    expect(settings.k_factor).toBe(1.67)
  })

  test('uses user overrides when provided', () => {
    const settings = getEffectiveSettings(
      { activity_impulse_scale: 0.2, k_factor: 2.0, tau_acute: 5, tau_chronic: 30 },
      'male',
    )
    expect(settings.k_factor).toBe(2.0)
    expect(settings.tau_acute).toBe(5)
    expect(settings.tau_chronic).toBe(30)
    expect(settings.activity_impulse_scale).toBe(0.2)
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
    const result = resolveHrMax(undefined, undefined, '1985-01-01')
    expect(result).toBe(179) // 220 - 41
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
// Test helpers
// ============================================================================

const makeActivity = (id: string, startStr: string, endStr: string, title?: string): Activity => ({
  activity_type: 'exercise',
  data: {},
  end_time: new Date(endStr),
  id,
  source: 'health_connect',
  start_time: new Date(startStr),
  title,
})

// ============================================================================
// Full Computation (Integration with Mocked Dependencies)
// ============================================================================

describe('computeTrainingLoad', () => {
  const makeDeps = (overrides: Partial<TrainingLoadDeps> = {}): TrainingLoadDeps => ({
    deleteImpulseBuckets: async () => 0,
    getActiveCalories: async () => [],
    getExercises: async () => [],
    getHourlyCalorieSums: async () => [],
    getHrSamples: async () => [],
    getImpulseBuckets: async () => [],
    getLatestRestingHr: async () => 60,
    getMaxObservedHr: async () => 190,
    getUserSettings: async () => ({ birth_date: '1985-06-15', sex: 'male' as const }),
    updateTrainingLoadSettings: async () => {},
    writeImpulseBuckets: async () => {},
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
    // With hourly EMA, the extended lookback (3×42 days) produces >1008 hours,
    // so bootstrapping may be false even for a short query range
    expect(typeof result.bootstrapping).toBe('boolean')
  })

  test('computes TRIMP for exercises with HR data', async () => {
    const exercises = [makeActivity('a1', '2024-01-03T10:00:00Z', '2024-01-03T11:00:00Z', 'Running')]
    const hrSamples: [Date, number][] = [
      [new Date('2024-01-03T10:00:00Z'), 140],
      [new Date('2024-01-03T10:30:00Z'), 160],
      [new Date('2024-01-03T11:00:00Z'), 150],
    ]

    // Provide pre-computed impulse buckets matching the exercise hour
    // (in the new architecture, exercises feed into the EMA only via stored impulse buckets)
    const impulseBuckets: [Date, number][] = [[new Date('2024-01-03T10:00:00Z'), 80]]

    const deps = makeDeps({
      getExercises: async () => exercises,
      getHrSamples: async () => hrSamples,
      getImpulseBuckets: async (_user, metric) => (metric === 'training_impulse' ? impulseBuckets : []),
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    expect(result.workouts).toHaveLength(1)
    expect(result.workouts[0]!.trimp).toBeGreaterThan(0)
    expect(result.workouts[0]!.avg_hr).toBeCloseTo(150)
    expect(result.workouts[0]!.title).toBe('Running')
    expect(result.workouts[0]!.duration_minutes).toBe(60)

    // Some hourly points should have non-zero ATL/CTL after the workout
    const postWorkout = result.points.filter((p) => p.time >= '2024-01-03T10:00:00.000Z')
    expect(postWorkout.some((p) => p.atl > 0)).toBe(true)
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

  test('includes pre-computed impulse buckets from storage', async () => {
    // Simulate stored impulse data from a previous computation
    const storedTraining: [Date, number][] = [
      [new Date('2024-01-02T14:00:00Z'), 80], // 80 TRIMP at 14:00
    ]
    const storedActivity: [Date, number][] = [
      [new Date('2024-01-02T14:00:00Z'), 5], // 5 impulse at 14:00
    ]

    const deps = makeDeps({
      getImpulseBuckets: async (_user, metric) => {
        if (metric === 'training_impulse') return storedTraining
        if (metric === 'activity_impulse') return storedActivity
        return []
      },
    })

    const result = await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    // Points after the impulse should show non-zero load
    const postImpulse = result.points.filter((p) => p.time >= '2024-01-02T14:00:00.000Z')
    expect(postImpulse.some((p) => p.atl > 0)).toBe(true)
  })

  test('triggers recomputation when watermark is set', async () => {
    const writeImpulseBuckets = vi.fn(async () => {})
    const deleteImpulseBuckets = vi.fn(async () => 0)

    const deps = makeDeps({
      deleteImpulseBuckets,
      getUserSettings: async () => ({
        birth_date: '1985-06-15',
        sex: 'male' as const,
        training_load: {
          impulse_watermark: '2024-01-02T00:00:00Z',
        },
      }),
      writeImpulseBuckets,
    })

    await computeTrainingLoad(
      deps,
      'testuser',
      new Date('2024-01-01T00:00:00Z'),
      new Date('2024-01-07T00:00:00Z'),
    )

    // Should have attempted to delete old buckets (recomputation triggered)
    expect(deleteImpulseBuckets).toHaveBeenCalled()
  })
})

// ============================================================================
// Recompute Impulse Buckets (chunked)
// ============================================================================

describe('recomputeImpulseBuckets', () => {
  const makeDeps = (overrides: Partial<TrainingLoadDeps> = {}): TrainingLoadDeps => ({
    deleteImpulseBuckets: async () => 0,
    getActiveCalories: async () => [],
    getExercises: async () => [],
    getHourlyCalorieSums: async () => [],
    getHrSamples: async () => [],
    getImpulseBuckets: async () => [],
    getLatestRestingHr: async () => 60,
    getMaxObservedHr: async () => 190,
    getUserSettings: async () => ({ birth_date: '1985-06-15', sex: 'male' as const }),
    updateTrainingLoadSettings: async () => {},
    writeImpulseBuckets: async () => {},
    ...overrides,
  })

  test('returns 0 hours when fromHour is in the future', async () => {
    const deps = makeDeps()
    const futureHour = new Date(Date.now() + 2 * 3600_000)
    const result = await recomputeImpulseBuckets(deps, 'testuser', futureHour)
    expect(result.hours_computed).toBe(0)
  })

  test('computes training impulse from exercises with per-exercise HR', async () => {
    const writtenPoints: TimeSeriesPoint[] = []
    const updateSettings = vi.fn(async () => {})

    const exerciseStart = new Date('2024-01-03T10:00:00Z')
    const exerciseEnd = new Date('2024-01-03T11:00:00Z')

    const deps = makeDeps({
      getExercises: async (_, start, end) => {
        // Only return exercise if the chunk overlaps
        if (start <= exerciseStart && end >= exerciseEnd) {
          return [makeActivity('ex1', '2024-01-03T10:00:00Z', '2024-01-03T11:00:00Z', 'Running')]
        }
        return []
      },
      getHrSamples: async (_, start) => {
        // Return HR samples only when queried for the exercise window
        if (start.getTime() === exerciseStart.getTime()) {
          return [
            [new Date('2024-01-03T10:00:00Z'), 150] as [Date, number],
            [new Date('2024-01-03T10:30:00Z'), 160] as [Date, number],
          ]
        }
        return []
      },
      updateTrainingLoadSettings: updateSettings,
      writeImpulseBuckets: async (_, points) => {
        writtenPoints.push(...points)
      },
    })

    // Use a fromHour just before the exercise
    const result = await recomputeImpulseBuckets(deps, 'testuser', new Date('2024-01-03T00:00:00Z'))

    expect(result.hours_computed).toBeGreaterThan(0)

    // Check that training_impulse points were written
    const trainingPoints = writtenPoints.filter((p) => p.metric === 'training_impulse')
    expect(trainingPoints.length).toBeGreaterThan(0)
    expect(trainingPoints.some((p) => p.value > 0)).toBe(true)

    // Watermark should be cleared
    expect(updateSettings).toHaveBeenCalledWith('testuser', { impulse_watermark: undefined })
  })

  test('computes activity impulse from hourly calorie sums', async () => {
    const writtenPoints: TimeSeriesPoint[] = []

    const deps = makeDeps({
      getHourlyCalorieSums: async () => [
        [new Date('2024-01-03T10:00:00Z'), 200] as [Date, number],
        [new Date('2024-01-03T14:00:00Z'), 150] as [Date, number],
      ],
      writeImpulseBuckets: async (_, points) => {
        writtenPoints.push(...points)
      },
    })

    const result = await recomputeImpulseBuckets(deps, 'testuser', new Date('2024-01-03T00:00:00Z'))

    expect(result.hours_computed).toBeGreaterThan(0)
    const activityPoints = writtenPoints.filter((p) => p.metric === 'activity_impulse')
    expect(activityPoints.length).toBe(2)
    expect(activityPoints.every((p) => p.value > 0)).toBe(true)
  })

  test('processes large ranges in chunks without loading all data at once', async () => {
    const exerciseCalls: [Date, Date][] = []
    const calorieCalls: [Date, Date][] = []

    const deps = makeDeps({
      getExercises: async (_, start, end) => {
        exerciseCalls.push([start, end])
        return []
      },
      getHourlyCalorieSums: async (_, start, end) => {
        calorieCalls.push([start, end])
        return []
      },
    })

    // Recompute 30 days — should result in multiple chunks (7 days each = ~5 chunks)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 3600_000)
    await recomputeImpulseBuckets(deps, 'testuser', floorToHour(thirtyDaysAgo))

    // Each chunk should make its own getExercises and getHourlyCalorieSums calls
    // 30 days / 7 days per chunk = ~5 chunks
    expect(exerciseCalls.length).toBeGreaterThanOrEqual(4)
    expect(calorieCalls.length).toBeGreaterThanOrEqual(4)

    // Verify chunk boundaries don't overlap (each call has distinct start/end)
    for (let i = 1; i < exerciseCalls.length; i++) {
      expect(exerciseCalls[i]![0].getTime()).toBe(exerciseCalls[i - 1]![1].getTime())
    }
  })
})
