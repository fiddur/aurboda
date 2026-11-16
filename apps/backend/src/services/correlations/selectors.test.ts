import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import { computeContinuous } from './continuous.ts'
import { resolveSelector } from './selectors.ts'

vi.mock('../../db', () => ({
  getEffectiveActivitiesInRange: vi.fn(),
  getDailyNutrientTotals: vi.fn(),
  getMealFlagsInRange: vi.fn(),
  getMealLogCompletedInRange: vi.fn(),
  getNutritionCompleteDaysInRange: vi.fn(),
  getProductivity: vi.fn(),
  getTimeSeries: vi.fn(),
}))

const start = new Date('2024-01-01T00:00:00Z')
const end = new Date('2024-01-05T23:59:59Z')

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([])
  vi.mocked(db.getDailyNutrientTotals).mockResolvedValue([])
  vi.mocked(db.getMealFlagsInRange).mockResolvedValue([])
  vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue([])
  vi.mocked(db.getNutritionCompleteDaysInRange).mockResolvedValue([])
  vi.mocked(db.getProductivity).mockResolvedValue([])
  vi.mocked(db.getTimeSeries).mockResolvedValue([])
})

describe('resolveSelector - tag', () => {
  test('every day is known; event days are days with a match', async () => {
    vi.mocked(db.getEffectiveActivitiesInRange).mockResolvedValue([
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

  test('agg avg of an instantaneous-sample metric weighs every 5-minute bin alike', async () => {
    const dense = Array.from({ length: 300 }, (_, i): [Date, number] => [
      new Date(Date.parse('2024-01-02T10:00:00Z') + i * 1000),
      80,
    ])
    vi.mocked(db.getTimeSeries).mockResolvedValue([[new Date('2024-01-02T08:00:00Z'), 20], ...dense])

    const resolved = await resolveSelector(
      'user',
      { kind: 'metric', metric: 'heart_rate', agg: 'avg' },
      start,
      end,
    )
    expect(resolved.daily.get('2024-01-02')).toBe(50)
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

describe('resolveSelector - sensitivity', () => {
  const GLUTEN = '11111111-1111-4111-8111-111111111111'
  const DAIRY = '22222222-2222-4222-8222-222222222222'
  const meal = (time: string, flag_ids: string[]) => ({ flag_ids, id: time, time: new Date(time) })

  beforeEach(() => {
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue([
      meal('2024-01-01T08:00:00Z', [GLUTEN]),
      meal('2024-01-01T12:00:00Z', [GLUTEN, DAIRY]),
      meal('2024-01-02T12:00:00Z', [DAIRY]),
      meal('2024-01-04T23:30:00Z', [GLUTEN]),
    ])
    vi.mocked(db.getMealLogCompletedInRange).mockResolvedValue(['2024-01-02', '2024-01-03'])
  })

  test('counts flagged meals per UTC day; days with a meal or marked complete are known, others unknown', async () => {
    const resolved = await resolveSelector('user', { flag: GLUTEN, kind: 'sensitivity' }, start, end)

    expect(Object.fromEntries(resolved.daily)).toEqual({
      '2024-01-01': 2,
      '2024-01-02': 0,
      '2024-01-03': 0,
      '2024-01-04': 1,
    })
    expect(resolved.knownDays.sort()).toEqual(['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'])
    expect(resolved.daily.has('2024-01-05')).toBe(false)
    expect(resolved.eventDays.sort()).toEqual(['2024-01-01', '2024-01-04'])
    expect(resolved.completeDays).toEqual(['2024-01-02', '2024-01-03'])
  })

  test('a threshold picks the event days from the daily count', async () => {
    const resolved = await resolveSelector(
      'user',
      { flag: GLUTEN, kind: 'sensitivity', threshold: { op: 'gte', value: 2 } },
      start,
      end,
    )
    expect(resolved.eventDays).toEqual(['2024-01-01'])
  })
})

describe('sensitivity vs the next night', () => {
  test("lag_days 1 pairs a day's flagged meals with the sleep that follows, stamped on the wake-up day", async () => {
    const GLUTEN = '11111111-1111-4111-8111-111111111111'
    vi.mocked(db.getMealFlagsInRange).mockResolvedValue(
      ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04'].map((day, i) => ({
        flag_ids: i % 2 === 0 ? [GLUTEN] : [],
        id: day,
        time: new Date(`${day}T18:00:00Z`),
      })),
    )
    // A night's sleep_score is stamped on the day it ends (Garmin's calendarDate at 12:00 UTC, Oura's day).
    vi.mocked(db.getTimeSeries).mockResolvedValue([
      [new Date('2024-01-02T12:00:00Z'), 60],
      [new Date('2024-01-03T12:00:00Z'), 80],
      [new Date('2024-01-04T12:00:00Z'), 60],
      [new Date('2024-01-05T12:00:00Z'), 80],
    ])
    const trigger = await resolveSelector('user', { flag: GLUTEN, kind: 'sensitivity' }, start, end)
    const outcome = await resolveSelector('user', { kind: 'metric', metric: 'sleep_score' }, start, end)
    const correlate = (lagDays: number) =>
      computeContinuous({
        lagDays,
        outcomeDaily: outcome.daily,
        outcomeKnown: outcome.knownDays,
        triggerDaily: trigger.daily,
        triggerKnown: trigger.knownDays,
      }).group_comparison

    expect(correlate(1)).toMatchObject({ mean_with: 60, mean_without: 80, n_with: 2, n_without: 2 })
    expect(correlate(0)).toMatchObject({ mean_with: 80, mean_without: 60 })
  })
})
