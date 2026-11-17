import type {
  MuscleRecovery,
  MuscleRecoveryGroup,
  MuscleRecoveryHistory,
  MuscleRecoverySource,
} from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  filterOptionLabel,
  readyLabel,
  recoveryLevel,
  recoveryOf,
  recoveryPeriod,
  recoverySeries,
  restCount,
  restLine,
  sourceLabel,
  tiredGroups,
} from './recoveryView'

const HOUR = 3_600_000

const group = (
  muscle_group: MuscleRecoveryGroup['muscle_group'],
  recovery: number,
  extra: Partial<MuscleRecoveryGroup> = {},
): MuscleRecoveryGroup => ({
  fatigue: (100 - recovery) / 100,
  half_life_hours: 24,
  muscle_group,
  name: muscle_group,
  ready_at: null,
  recovery,
  sources: [],
  ...extra,
})

const recovery = (groups: MuscleRecoveryGroup[]): MuscleRecovery => ({
  at: '2026-11-17T12:00:00.000Z',
  field: 'sets.exercise',
  groups,
  ready_percent: 80,
  window_days: 10,
})

describe('recoveryLevel', () => {
  test('is ready from the ready percent', () => {
    expect(recoveryLevel(80, 80)).toBe('ready')
    expect(recoveryLevel(100, 80)).toBe('ready')
  })

  test('is recovering from 50 up to the ready percent', () => {
    expect(recoveryLevel(79, 80)).toBe('recovering')
    expect(recoveryLevel(50, 80)).toBe('recovering')
  })

  test('is fatigued below 50', () => {
    expect(recoveryLevel(49, 80)).toBe('fatigued')
    expect(recoveryLevel(0, 80)).toBe('fatigued')
  })
})

describe('readyLabel', () => {
  const now = new Date(2026, 10, 17, 12, 0)
  const ahead = (hours: number) => new Date(now.getTime() + hours * HOUR).toISOString()

  test('is Ready when there is no ready time', () => {
    expect(readyLabel(null, now)).toBe('Ready')
  })

  test('is Ready when the ready time has passed', () => {
    expect(readyLabel(ahead(-1), now)).toBe('Ready')
  })

  test('is at least one hour', () => {
    expect(readyLabel(ahead(0.5), now)).toBe('Ready in 1 h')
    expect(readyLabel(ahead(0.1), now)).toBe('Ready in 1 h')
  })

  test('gives whole hours under a day ahead', () => {
    expect(readyLabel(ahead(5), now)).toBe('Ready in 5 h')
    expect(readyLabel(ahead(23), now)).toBe('Ready in 23 h')
  })

  test('is Ready tomorrow beyond a day when it falls on the next calendar day', () => {
    expect(readyLabel(ahead(30), new Date(2026, 10, 17, 8, 0))).toBe('Ready tomorrow')
  })

  test('gives the weekday when it falls later', () => {
    const late = new Date(2026, 10, 17, 22, 0)
    expect(readyLabel(new Date(late.getTime() + 30 * HOUR).toISOString(), late)).toBe('Ready on Thu')
  })
})

describe('tiredGroups and restCount', () => {
  test('are empty and the whole count when all groups are at 100', () => {
    const data = recovery([group('chest', 100), group('biceps', 100)])
    expect(tiredGroups(data)).toEqual([])
    expect(restCount(data)).toBe(2)
  })

  test('list the groups below 100, lowest first, ties in the given order', () => {
    const data = recovery([
      group('chest', 70),
      group('biceps', 100),
      group('triceps', 40),
      group('lats', 70),
      group('quadriceps', 90),
    ])
    expect(tiredGroups(data).map((g) => g.muscle_group)).toEqual(['triceps', 'chest', 'lats', 'quadriceps'])
    expect(restCount(data)).toBe(1)
  })

  test('take the ready percent as the limit when given', () => {
    const data = recovery([group('chest', 70), group('biceps', 80), group('triceps', 40), group('lats', 95)])
    expect(tiredGroups(data, 80).map((g) => g.muscle_group)).toEqual(['triceps', 'chest'])
    expect(restCount(data, 80)).toBe(2)
  })
})

describe('restLine', () => {
  test('says all are recovered when none is tired', () => {
    expect(restLine(12, 0)).toBe('All muscle groups are recovered.')
  })

  test('counts the others, singular for one', () => {
    expect(restLine(9, 3)).toBe('The other 9 muscle groups are recovered.')
    expect(restLine(1, 11)).toBe('The other muscle group is recovered.')
  })

  test('says ready when asked to', () => {
    expect(restLine(12, 0, 'ready')).toBe('All muscle groups are ready.')
    expect(restLine(9, 3, 'ready')).toBe('The other 9 muscle groups are ready.')
  })

  test('is nothing when every group is tired', () => {
    expect(restLine(0, 12)).toBeUndefined()
  })
})

describe('recoveryOf', () => {
  const data = recovery([group('chest', 64)])

  test('finds the group', () => {
    expect(recoveryOf(data, 'chest')?.recovery).toBe(64)
  })

  test('is undefined for a group not in the answer or without data', () => {
    expect(recoveryOf(data, 'biceps')).toBeUndefined()
    expect(recoveryOf(undefined, 'chest')).toBeUndefined()
    expect(recoveryOf(null, 'chest')).toBeUndefined()
  })
})

describe('filterOptionLabel', () => {
  test('is the name alone without recovery or at 100', () => {
    expect(filterOptionLabel('Chest', undefined)).toBe('Chest')
    expect(filterOptionLabel('Chest', 100)).toBe('Chest')
  })

  test('adds the recovery below 100', () => {
    expect(filterOptionLabel('Chest', 64)).toBe('Chest · 64 %')
    expect(filterOptionLabel('Chest', 0)).toBe('Chest · 0 %')
  })
})

describe('recoveryPeriod', () => {
  test('covers the 14 days up to the end of the current hour, every 6 hours', () => {
    const now = new Date(2026, 10, 17, 12, 34, 56)
    const period = recoveryPeriod(now)
    expect(period.end).toBe(new Date(2026, 10, 17, 13, 0, 0).toISOString())
    expect(new Date(period.end).getTime() - new Date(period.start).getTime()).toBe(14 * 24 * HOUR)
    expect(period.step_hours).toBe(6)
  })

  test('is stable within the hour', () => {
    expect(recoveryPeriod(new Date(2026, 10, 17, 12, 1))).toEqual(
      recoveryPeriod(new Date(2026, 10, 17, 12, 59)),
    )
  })
})

describe('recoverySeries', () => {
  const history: MuscleRecoveryHistory = {
    end: '2026-11-17T12:00:00.000Z',
    field: 'sets.exercise',
    points: [
      {
        at: '2026-11-17T00:00:00.000Z',
        recovery: { chest: 40 } as MuscleRecoveryHistory['points'][number]['recovery'],
      },
      {
        at: '2026-11-17T06:00:00.000Z',
        recovery: { chest: 60 } as MuscleRecoveryHistory['points'][number]['recovery'],
      },
      { at: '2026-11-17T12:00:00.000Z', recovery: {} as MuscleRecoveryHistory['points'][number]['recovery'] },
    ],
    start: '2026-11-17T00:00:00.000Z',
    step_hours: 6,
  }

  test('maps the points of the group, skipping points without it', () => {
    expect(recoverySeries(history, 'chest')).toEqual([
      { date: '2026-11-17T00:00:00.000Z', value: 40 },
      { date: '2026-11-17T06:00:00.000Z', value: 60 },
    ])
  })

  test('is empty without history', () => {
    expect(recoverySeries(undefined, 'chest')).toEqual([])
    expect(recoverySeries({ ...history, points: [] }, 'chest')).toEqual([])
  })
})

describe('sourceLabel', () => {
  const source = (sets: number): MuscleRecoverySource => ({
    activity_type: 'strength_training',
    end_time: new Date(2026, 10, 14, 11, 0).toISOString(),
    fatigue: 0.2,
    session_id: 'a',
    sets,
    start_time: new Date(2026, 10, 14, 10, 0).toISOString(),
  })

  test('gives the day and the sets with at most one decimal', () => {
    expect(sourceLabel(source(3.5))).toBe('Sat 14 Nov · 3.5 sets')
    expect(sourceLabel(source(3.46))).toBe('Sat 14 Nov · 3.5 sets')
    expect(sourceLabel(source(4))).toBe('Sat 14 Nov · 4 sets')
  })

  test('uses the singular for one set', () => {
    expect(sourceLabel(source(1))).toBe('Sat 14 Nov · 1 set')
  })
})
