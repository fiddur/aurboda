import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Activity, MergedActivity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import { queryActivityItemHistory } from './activity-item-history.ts'

vi.mock('../../db/index.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof db>()),
  expandActivityTypes: vi.fn().mockImplementation((_user: string, types: string[]) => Promise.resolve(types)),
  getActivities: vi.fn(),
  getActivityById: vi.fn(),
  getActivityTypeDefinitions: vi.fn().mockResolvedValue([]),
  getOverlappingActivities: vi.fn(),
}))

const at = (iso: string) => new Date(iso)

const lift = (
  id: string,
  startIso: string,
  sets: unknown,
  extra: Partial<MergedActivity> = {},
): MergedActivity => ({
  activity_type: 'strength_training',
  data: { sets },
  end_time: new Date(at(startIso).getTime() + 3_600_000),
  id,
  source: 'gravl',
  start_time: at(startIso),
  ...extra,
})

const bench = (weight: number | null, reps: number | null, setType = 'normal') => ({
  exercise: 'Bench Press',
  reps,
  set_type: setType,
  time: null,
  weight,
})
const plank = (time: number) => ({ exercise: 'Plank', reps: null, set_type: 'normal', time, weight: null })

describe('queryActivityItemHistory', () => {
  const current = lift('cur', '2026-09-10T17:00:00Z', [
    bench(40, 10, 'warmup'),
    bench(80, 6),
    plank(50),
    { exercise: ' bench press', reps: 4, set_type: 'normal', weight: 82.5 },
  ])

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getActivityById).mockResolvedValue(current as Activity)
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([current as Activity])
  })

  test('null when the activity does not exist', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(null)
    expect(await queryActivityItemHistory('u', 'nope', 'sets.exercise')).toBeNull()
  })

  test('groups by value with measures, records against every earlier session, and the previous one', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      lift('old', '2026-08-01T17:00:00Z', [bench(85, 2), plank(60)]),
      lift('mid', '2026-09-01T17:00:00Z', [bench(75, 5)], { source_ids: ['mid', 'other'] }),
      lift('none', '2026-09-05T17:00:00Z', [{ exercise: 'Squat', reps: 5, weight: 100 }]),
    ])

    const history = await queryActivityItemHistory('u', 'cur', 'sets.exercise')

    const [, types, start, end] = vi.mocked(db.getActivities).mock.calls[0]!
    expect(types).toEqual(['strength_training'])
    expect(start).toEqual(new Date(0))
    expect(end.getTime()).toBeLessThan(current.start_time.getTime())

    expect(history).toEqual({
      activity_id: 'cur',
      field: 'sets.exercise',
      groups: [
        {
          items: [
            bench(40, 10, 'warmup'),
            bench(80, 6),
            { exercise: ' bench press', reps: 4, set_type: 'normal', weight: 82.5 },
          ],
          measures: { e1rm: 96, max_reps: 6, max_weight: 82.5, set_count: 2, total_reps: 10, volume: 810 },
          previous: {
            id: 'merged:mid',
            items: [bench(75, 5)],
            measures: { e1rm: 87.5, max_reps: 5, max_weight: 75, set_count: 1, total_reps: 5, volume: 375 },
            start_time: '2026-09-01T17:00:00.000Z',
          },
          records: ['e1rm', 'max_reps'],
          trend: [
            { after: 810, before: 356, measure: 'volume' },
            { after: 96, before: 83.1, measure: 'e1rm' },
            { after: 82.5, before: 71.2, measure: 'max_weight' },
            { after: 2, before: 0.9, measure: 'set_count' },
            { after: 10, before: 4.7, measure: 'total_reps' },
            { after: 6, before: 4.7, measure: 'max_reps' },
          ],
          value: 'Bench Press',
        },
        {
          items: [plank(50)],
          measures: { max_time: 50, set_count: 1 },
          previous: {
            id: 'old',
            items: [plank(60)],
            measures: { max_time: 60, set_count: 1 },
            start_time: '2026-08-01T17:00:00.000Z',
          },
          records: [],
          trend: [
            { after: 1, before: 0.8, measure: 'set_count' },
            { after: 50, before: 47.6, measure: 'max_time' },
          ],
          value: 'Plank',
        },
      ],
      totals: {
        e1rm: 96,
        max_reps: 6,
        max_time: 50,
        max_weight: 82.5,
        set_count: 3,
        total_reps: 10,
        volume: 810,
      },
      trend_half_life_days: 120,
    })
  })

  test('the trend before is the decayed best of the earlier sessions, same-day ones included; after is lifted by this one', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([
      lift('a', '2026-05-13T17:00:00Z', [bench(100, 6)]),
      lift('b', '2026-09-10T08:00:00Z', [bench(60, 5)]),
    ])

    const history = await queryActivityItemHistory('u', 'cur', 'sets.exercise')
    const trend = (measure: string) => history!.groups[0]!.trend.find((t) => t.measure === measure)

    expect(trend('e1rm')).toEqual({ after: 96, before: 70, measure: 'e1rm' })
    expect(trend('volume')).toEqual({ after: 810, before: 300, measure: 'volume' })
  })

  test('a weaker session leaves the trend where it was', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([lift('a', '2026-09-09T17:00:00Z', [bench(120, 5)])])

    const history = await queryActivityItemHistory('u', 'cur', 'sets.exercise')

    expect(history!.groups[0]!.trend.find((t) => t.measure === 'e1rm')).toEqual({
      after: 139.2,
      before: 139.2,
      measure: 'e1rm',
    })
  })

  test('a first-time exercise has a trend with no before', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([])
    const history = await queryActivityItemHistory('u', 'cur', 'sets.exercise')
    expect(history!.groups[1]!.trend).toEqual([
      { after: 1, measure: 'set_count' },
      { after: 50, measure: 'max_time' },
    ])
  })

  test('a first time has every present record measure and no previous', async () => {
    vi.mocked(db.getActivities).mockResolvedValue([])
    const history = await queryActivityItemHistory('u', 'cur', 'sets.exercise')
    expect(history!.groups.map((g) => [g.value, g.records, g.previous])).toEqual([
      ['Bench Press', ['e1rm', 'max_weight', 'max_reps'], undefined],
      ['Plank', ['max_time'], undefined],
    ])
  })

  test('a merged id reads the merged data and looks back from the group start', async () => {
    const strava = {
      ...lift('strava', '2026-09-10T16:59:50Z', undefined),
      data: { calories: 300 },
      source: 'strava',
    }
    vi.mocked(db.getOverlappingActivities).mockResolvedValue([strava as Activity, current as Activity])
    vi.mocked(db.getActivities).mockResolvedValue([])

    const history = await queryActivityItemHistory('u', 'merged:cur', 'sets.exercise')

    expect(history!.activity_id).toBe('merged:cur')
    expect(history!.groups.map((g) => g.value)).toEqual(['Bench Press', 'Plank'])
    expect(vi.mocked(db.getActivities).mock.calls[0]![3].getTime()).toBeLessThan(strava.start_time.getTime())
  })

  test('a field that is not a list gives no groups and empty totals', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(lift('cur', '2026-09-10T17:00:00Z', 'oops') as Activity)
    expect(await queryActivityItemHistory('u', 'cur', 'sets.exercise')).toEqual({
      activity_id: 'cur',
      field: 'sets.exercise',
      groups: [],
      totals: {},
      trend_half_life_days: 120,
    })
    expect(db.getActivities).not.toHaveBeenCalled()
  })
})
