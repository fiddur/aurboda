import type { ActivityTypeDefinition } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { MergedActivity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import { measuresByItemValue, queryMeasuredActivities } from './activity-measure-series.ts'

vi.mock('../../db', () => ({
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityTypeDefinitions: vi.fn(),
  getUserSettings: vi.fn().mockResolvedValue(null),
}))

const strengthDef: ActivityTypeDefinition = {
  aliases: [],
  color: '#000000',
  data_schema: {
    fields: [
      { name: 'location', type: 'string' },
      {
        item_fields: [
          { is_categorical: true, name: 'exercise', type: 'string' },
          { name: 'weight', type: 'number' },
          { name: 'reps', type: 'number' },
        ],
        name: 'sets',
        type: 'list',
      },
    ],
  },
  display_category: 'exercise',
  display_name: 'Strength',
  is_builtin: true,
  name: 'strength_training',
  show_on_timeline: true,
}

const lift = (
  id: string,
  startIso: string,
  sets: Record<string, unknown>[],
  extra: Partial<MergedActivity> = {},
): MergedActivity => ({
  activity_type: 'strength_training',
  data: { location: 'Gym', sets },
  end_time: new Date(new Date(startIso).getTime() + 45 * 60_000),
  id,
  source: 'gravl',
  start_time: new Date(startIso),
  ...extra,
})

const bench = (weight: number, reps: number, extra = {}) => ({
  exercise: 'Bench Press',
  reps,
  weight,
  ...extra,
})
const squat = (weight: number, reps: number) => ({ exercise: 'squat', reps, weight })

const s1 = lift('s1', '2026-08-01T17:00:00Z', [
  bench(40, 10, { set_type: 'warmup' }),
  bench(80, 5),
  squat(100, 5),
])
const s2 = lift('s2', '2026-09-01T17:00:00Z', [squat(110, 3)], {
  data: { location: 'Home', sets: [squat(110, 3)] },
})
const s3 = lift('s3', '2026-09-08T17:00:00Z', [{ exercise: ' bench press ', reps: 3, weight: 85 }], {
  source_ids: ['a', 'b'],
})

const start = new Date('2026-08-01T00:00:00Z')
const end = new Date('2026-10-01T00:00:00Z')

describe('queryMeasuredActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([strengthDef])
    vi.mocked(db.getActivities).mockResolvedValue([s3, s1, s2])
  })

  test('measures every working item of the type’s list field, in start order', async () => {
    const result = await queryMeasuredActivities('u', 'strength_training', start, end)

    expect(result.map((m) => m.id)).toEqual(['s1', 's2', 'merged:s3'])
    expect(result[0]?.measures).toEqual({
      e1rm: 116.7,
      max_reps: 5,
      max_weight: 100,
      set_count: 2,
      total_reps: 10,
      volume: 900,
    })
    expect(db.getActivities).toHaveBeenCalledWith(
      'u',
      ['strength_training'],
      start,
      end,
      undefined,
      undefined,
      new Map([['strength_training', 'exercise']]),
    )
  })

  test('an item filter measures only that value’s items and drops sessions without one', async () => {
    const result = await queryMeasuredActivities('u', 'strength_training', start, end, {
      field: 'sets.exercise',
      value: 'bench press',
    })

    expect(result.map((m) => [m.id, m.measures.e1rm, m.measures.set_count])).toEqual([
      ['s1', 93.3, 1],
      ['merged:s3', 93.5, 1],
    ])
  })

  test('a scalar filter keeps the sessions whose field has the value', async () => {
    const result = await queryMeasuredActivities('u', 'strength_training', start, end, {
      field: 'location',
      value: 'Home',
    })

    expect(result.map((m) => m.id)).toEqual(['s2'])
  })

  test('a type without a list field has no measured sessions', async () => {
    vi.mocked(db.getActivityTypeDefinitions).mockResolvedValue([
      { ...strengthDef, data_schema: { fields: [{ name: 'location', type: 'string' }] } },
    ])

    expect(await queryMeasuredActivities('u', 'strength_training', start, end)).toEqual([])
    expect(db.getActivities).not.toHaveBeenCalled()
  })
})

describe('measuresByItemValue', () => {
  test('one entry per normalised value with the measures over its items', () => {
    const groups = measuresByItemValue(s1, 'sets.exercise')

    expect(groups).toEqual([
      {
        measures: { e1rm: 93.3, max_reps: 5, max_weight: 80, set_count: 1, total_reps: 5, volume: 400 },
        normalized: 'bench press',
        value: 'Bench Press',
      },
      {
        measures: { e1rm: 116.7, max_reps: 5, max_weight: 100, set_count: 1, total_reps: 5, volume: 500 },
        normalized: 'squat',
        value: 'squat',
      },
    ])
  })

  test('a filter on the same list field narrows the items grouped', () => {
    const groups = measuresByItemValue(s1, 'sets.exercise', { field: 'sets.exercise', value: 'Squat' })

    expect(groups.map((g) => g.value)).toEqual(['squat'])
  })

  test('a scalar path has no item values', () => {
    expect(measuresByItemValue(s1, 'location')).toEqual([])
  })
})
