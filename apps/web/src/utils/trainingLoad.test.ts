import type { RecoveryZones, TrainingLoadPoint, WorkoutTrimp } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  formState,
  newestFirst,
  parseTimeConstant,
  recoveryZone,
  withTimeConstant,
  zoneSegments,
} from './trainingLoad'

const zones: RecoveryZones = { balanced_max: 52, balanced_min: 32, strained_max: 68 }

const point = (time: string, atl: number): TrainingLoadPoint => ({
  activity_impulse: 0,
  atl,
  ctl: 40,
  time,
  training_impulse: 0,
  tsb: 40 - atl,
})

describe('recoveryZone', () => {
  test.each([
    [10, 'undertrained'],
    [32, 'balanced'],
    [52, 'balanced'],
    [60, 'strained'],
    [68, 'strained'],
    [69, 'very_strained'],
  ] as const)('ATL %d is %s', (atl, zone) => {
    expect(recoveryZone(atl, zones)).toBe(zone)
  })
})

describe('formState', () => {
  test('is fresh at or above zero and fatigued below', () => {
    expect(formState(0)).toBe('fresh')
    expect(formState(3.2)).toBe('fresh')
    expect(formState(-0.1)).toBe('fatigued')
  })
})

describe('zoneSegments', () => {
  test('merges consecutive points in the same zone', () => {
    const points = [
      point('2026-11-01T00:00:00Z', 20),
      point('2026-11-02T00:00:00Z', 25),
      point('2026-11-03T00:00:00Z', 40),
      point('2026-11-04T00:00:00Z', 70),
      point('2026-11-05T00:00:00Z', 45),
    ]

    expect(zoneSegments(points, zones)).toEqual([
      { count: 2, end: '2026-11-02T00:00:00Z', start: '2026-11-01T00:00:00Z', zone: 'undertrained' },
      { count: 1, end: '2026-11-03T00:00:00Z', start: '2026-11-03T00:00:00Z', zone: 'balanced' },
      { count: 1, end: '2026-11-04T00:00:00Z', start: '2026-11-04T00:00:00Z', zone: 'very_strained' },
      { count: 1, end: '2026-11-05T00:00:00Z', start: '2026-11-05T00:00:00Z', zone: 'balanced' },
    ])
  })

  test('is empty without points', () => {
    expect(zoneSegments([], zones)).toEqual([])
  })
})

describe('newestFirst', () => {
  test('sorts workouts by start time, newest first, without mutating the input', () => {
    const workout = (start_time: string): WorkoutTrimp => ({
      date: start_time.slice(0, 10),
      duration_minutes: 30,
      end_time: start_time,
      start_time,
      trimp: 10,
      trimp_basis: 'hr',
    })
    const workouts = [
      workout('2026-11-02T08:00:00Z'),
      workout('2026-11-05T08:00:00Z'),
      workout('2026-11-01T08:00:00Z'),
    ]

    expect(newestFirst(workouts).map((w) => w.date)).toEqual(['2026-11-05', '2026-11-02', '2026-11-01'])
    expect(workouts[0].date).toBe('2026-11-02')
  })
})

describe('parseTimeConstant', () => {
  test('reads a positive number of days, empty as the default and anything else as invalid', () => {
    expect(parseTimeConstant('7')).toBe(7)
    expect(parseTimeConstant(' 10.5 ')).toBe(10.5)
    expect(parseTimeConstant('')).toBeNull()
    expect(parseTimeConstant('0')).toBe('invalid')
    expect(parseTimeConstant('-3')).toBe('invalid')
    expect(parseTimeConstant('abc')).toBe('invalid')
  })
})

describe('withTimeConstant', () => {
  test('keeps the other training load settings', () => {
    expect(
      withTimeConstant(
        { hr_max: 190, impulse_watermark: '2026-11-01T00:00:00Z', tau_acute: 7 },
        'tau_chronic',
        50,
      ),
    ).toEqual({ hr_max: 190, impulse_watermark: '2026-11-01T00:00:00Z', tau_acute: 7, tau_chronic: 50 })
  })

  test('drops the constant to fall back to its default', () => {
    expect(withTimeConstant({ tau_acute: 5, tau_chronic: 50 }, 'tau_acute', null)).toEqual({
      tau_chronic: 50,
    })
  })

  test('starts from nothing', () => {
    expect(withTimeConstant(undefined, 'tau_acute', 9)).toEqual({ tau_acute: 9 })
    expect(withTimeConstant(null, 'tau_acute', 9)).toEqual({ tau_acute: 9 })
  })
})
