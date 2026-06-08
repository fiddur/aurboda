import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { resolveSelector } from './selectors.ts'

vi.mock('../../db', () => ({
  getAllActivitiesInRange: vi.fn(),
  getDailyNutrientTotals: vi.fn(),
  getMealLogCompletedInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

const start = new Date('2024-01-01T00:00:00Z')
const end = new Date('2024-01-05T23:59:59Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([])
  vi.mocked(db.getDailyNutrientTotals).mockResolvedValue([])
  vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([])
  vi.mocked(db.getProductivity).mockResolvedValue([])
  vi.mocked(db.getTimeSeries).mockResolvedValue([])
})

describe('resolveSelector - tag', () => {
  test('every day is known; event days are days with a match', async () => {
    vi.mocked(db.getAllActivitiesInRange).mockResolvedValue([
      { source: 'manual', start_time: new Date('2024-01-02T10:00:00Z'), activity_type: 'sauna' },
      { source: 'manual', start_time: new Date('2024-01-04T18:00:00Z'), activity_type: 'sauna' },
      { source: 'manual', start_time: new Date('2024-01-04T19:00:00Z'), activity_type: 'coffee' },
    ] as unknown as db.Activity[])

    const resolved = await resolveSelector('user', { kind: 'tag', pattern: 'sauna' }, start, end)

    // Absence of a tag is a known no-event, so all 5 days are known.
    expect(resolved.knownDays).toHaveLength(5)
    expect(resolved.eventDays.sort()).toEqual(['2024-01-02', '2024-01-04'])
    // Daily count: one sauna on the 2nd, one on the 4th.
    expect(resolved.daily.get('2024-01-04')).toBe(1)
  })
})

describe('resolveSelector - metric event mode', () => {
  test('known days are only days with entries; events pass the threshold', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-02T08:00:00Z'), 3],
      [new Date('2024-01-04T08:00:00Z'), 0],
    ])

    const resolved = await resolveSelector('user', { kind: 'metric', metric: 'back_pain' }, start, end)

    // Only logged days are known (the 0 on the 4th is a known zero, not absence).
    expect(resolved.knownDays.sort()).toEqual(['2024-01-02', '2024-01-04'])
    // Default threshold > 0 -> only the value-3 day is an event.
    expect(resolved.eventDays).toEqual(['2024-01-02'])
  })

  test('agg avg averages multiple entries per day', async () => {
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-02T08:00:00Z'), 10],
      [new Date('2024-01-02T20:00:00Z'), 20],
    ])

    const resolved = await resolveSelector(
      'user',
      { kind: 'metric', metric: 'weight', agg: 'avg' },
      start,
      end,
    )
    expect(resolved.daily.get('2024-01-02')).toBe(15)
  })
})

describe('resolveSelector - nutrition', () => {
  test('meal-log-completed zero days are known', async () => {
    vi.mocked(db.getDailyNutrientTotals).mockResolvedValue([
      { date: '2024-01-02', nutrient: 'carbs', total: 120 },
    ])
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue(['2024-01-02', '2024-01-03'])

    const resolved = await resolveSelector('user', { kind: 'nutrition', nutrient: 'carbs' }, start, end)

    // Day 3 was marked complete with no meal -> known zero.
    expect(resolved.knownDays.sort()).toEqual(['2024-01-02', '2024-01-03'])
    expect(resolved.daily.get('2024-01-03')).toBe(0)
    // Only the day with carbs > 0 is an event.
    expect(resolved.eventDays).toEqual(['2024-01-02'])
  })
})
