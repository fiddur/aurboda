import { describe, expect, test } from 'vitest'

import type { MergedActivity } from '../db/types.ts'

import {
  classifyDebt,
  type CountedSleep,
  datesBetween,
  getSleepDebt,
  getSleepDebtForDate,
  getCurrentSleepDebt,
  resolveSleepDebtRange,
  type SleepDebtDeps,
  sleepDebtSeries,
  toCountedSleeps,
} from './sleep-debt.ts'

const NEED = 480

const nights = (start: string, minutes: number[]): CountedSleep[] =>
  datesBetween(start, '2099-12-31')
    .slice(0, minutes.length)
    .map((date, i) => ({ date, kind: 'night', minutes: minutes[i] }))

describe('sleepDebtSeries', () => {
  test('a week of short nights builds debt night by night', () => {
    const dates = datesBetween('2026-03-01', '2026-03-07')
    const days = sleepDebtSeries(dates, nights('2026-03-01', Array(7).fill(360)), NEED)

    expect(days.map((d) => d.debt_minutes)).toEqual([120, 222, 309, 382, 445, 498, 544])
    expect(days.map((d) => d.severity)).toEqual([
      'mild',
      'mild',
      'moderate',
      'moderate',
      'moderate',
      'severe',
      'severe',
    ])
    expect(days[0]).toEqual({ date: '2026-03-01', debt_minutes: 120, severity: 'mild', slept_minutes: 360 })
  })

  test('a recovery week of long nights pays the debt back to zero and no further', () => {
    const dates = datesBetween('2026-03-01', '2026-03-14')
    const sleeps = nights('2026-03-01', [...Array(7).fill(360), ...Array(7).fill(540)])
    const recovery = sleepDebtSeries(dates, sleeps, NEED).slice(7)

    expect(recovery.map((d) => d.debt_minutes)).toEqual([402, 282, 179, 93, 19, 0, 0])
    expect(recovery.map((d) => d.severity)).toEqual([
      'moderate',
      'moderate',
      'mild',
      'mild',
      'none',
      'none',
      'none',
    ])
  })

  test('a missing night decays the debt and is not counted as no sleep', () => {
    const dates = datesBetween('2026-03-01', '2026-03-03')
    const sleeps = [...nights('2026-03-01', [360]), ...nights('2026-03-03', [480])]
    const days = sleepDebtSeries(dates, sleeps, NEED)

    expect(days[1]).toEqual({ date: '2026-03-02', debt_minutes: 102, severity: 'mild', slept_minutes: null })
    expect(days[2].debt_minutes).toBe(87)
  })

  test('today without a night yet carries the debt unchanged, a past date without one decays it', () => {
    const dates = datesBetween('2026-03-01', '2026-03-03')
    const sleeps = nights('2026-03-01', [360])

    expect(sleepDebtSeries(dates, sleeps, NEED, '2026-03-03').map((d) => d.debt_minutes)).toEqual([
      120, 102, 102,
    ])
    expect(sleepDebtSeries(dates, sleeps, NEED, '2026-03-02').map((d) => d.debt_minutes)).toEqual([
      120, 120, 102,
    ])
    expect(
      sleepDebtSeries(dates, [...sleeps, ...nights('2026-03-03', [480])], NEED, '2026-03-03')[2],
    ).toMatchObject({ debt_minutes: 87, slept_minutes: 480 })
  })

  test('a nap over 20 minutes counts at half its length, a shorter one not at all', () => {
    const dates = ['2026-03-01', '2026-03-02']
    const sleeps: CountedSleep[] = [
      { date: '2026-03-01', kind: 'night', minutes: 420 },
      { date: '2026-03-01', kind: 'nap', minutes: 60 },
      { date: '2026-03-02', kind: 'night', minutes: 480 },
      { date: '2026-03-02', kind: 'nap', minutes: 20 },
    ]
    const days = sleepDebtSeries(dates, sleeps, NEED)

    expect(days[0]).toMatchObject({ debt_minutes: 30, slept_minutes: 450 })
    expect(days[1]).toMatchObject({ debt_minutes: 26, slept_minutes: 480 })
  })

  test('a nap on a date without a night leaves it a missing night', () => {
    const days = sleepDebtSeries(
      ['2026-03-01', '2026-03-02'],
      [...nights('2026-03-01', [360]), { date: '2026-03-02', kind: 'nap', minutes: 90 }],
      NEED,
    )

    expect(days[1]).toMatchObject({ debt_minutes: 102, slept_minutes: null })
  })

  test('two sessions ending on the same date add up', () => {
    const days = sleepDebtSeries(
      ['2026-03-01'],
      [
        { date: '2026-03-01', kind: 'night', minutes: 200 },
        { date: '2026-03-01', kind: 'night', minutes: 250 },
      ],
      NEED,
    )

    expect(days[0]).toMatchObject({ debt_minutes: 30, slept_minutes: 450 })
  })
})

describe('classifyDebt', () => {
  test.each([
    [0, 'none'],
    [47, 'none'],
    [48, 'mild'],
    [239, 'mild'],
    [240, 'moderate'],
    [479, 'moderate'],
    [480, 'severe'],
  ] as const)('%i minutes against 480 is %s', (debt, severity) => {
    expect(classifyDebt(debt, NEED)).toBe(severity)
  })
})

const activity = (
  activity_type: string,
  start: string,
  end: string | undefined,
  data?: Record<string, unknown>,
): MergedActivity => ({
  activity_type,
  data,
  end_time: end ? new Date(end) : undefined,
  source: 'oura',
  start_time: new Date(start),
})

describe('toCountedSleeps', () => {
  const napTypes = new Set(['nap'])

  test('dates a session by its local wake-up and counts asleep time, else time in bed', () => {
    const counted = toCountedSleeps(
      [
        activity('sleep', '2026-03-07T21:30:00Z', '2026-03-07T23:30:00Z'),
        activity('sleep', '2026-03-07T22:00:00Z', '2026-03-08T06:00:00Z', { total_sleep_duration: 25200 }),
        activity('nap', '2026-03-08T12:00:00Z', '2026-03-08T12:45:00Z'),
      ],
      napTypes,
      'Europe/Stockholm',
    )

    expect(counted).toEqual([
      { date: '2026-03-08', kind: 'night', minutes: 120 },
      { date: '2026-03-08', kind: 'night', minutes: 420 },
      { date: '2026-03-08', kind: 'nap', minutes: 45 },
    ])
  })

  test('skips open sessions and other sleep-category types', () => {
    const counted = toCountedSleeps(
      [
        activity('sleep', '2026-03-07T22:00:00Z', undefined),
        activity('rest', '2026-03-08T12:00:00Z', '2026-03-08T13:00:00Z'),
      ],
      napTypes,
      'UTC',
    )

    expect(counted).toEqual([])
  })
})

describe('resolveSleepDebtRange', () => {
  test('defaults to the two weeks up to today', () => {
    expect(resolveSleepDebtRange({}, '2026-03-14')).toEqual({ end: '2026-03-14', start: '2026-03-01' })
  })

  test('refuses a start after the end and a range over 366 days', () => {
    expect(resolveSleepDebtRange({ end: '2026-03-01', start: '2026-03-02' }, '2026-03-14')).toHaveProperty(
      'error',
    )
    expect(resolveSleepDebtRange({ end: '2026-12-31', start: '2025-12-30' }, '2026-03-14')).toHaveProperty(
      'error',
    )
    expect(resolveSleepDebtRange({ end: '2026-12-31', start: '2026-01-01' }, '2026-03-14')).toEqual({
      end: '2026-12-31',
      start: '2026-01-01',
    })
  })
})

describe('getSleepDebt', () => {
  const sessions = [
    activity('sleep', '2026-03-09T23:00:00Z', '2026-03-10T05:00:00Z'),
    activity('sleep', '2026-03-10T23:00:00Z', '2026-03-11T05:00:00Z'),
  ]
  const deps = (overrides: Partial<SleepDebtDeps> = {}): SleepDebtDeps => ({
    getNapTypes: async () => ['nap'],
    getSleepActivities: async () => sessions,
    getSleepNeed: async () => NEED,
    getTimezone: async () => 'UTC',
    now: () => new Date('2026-03-11T09:00:00Z'),
    ...overrides,
  })

  test('returns the range only, after warming up from four weeks before it', async () => {
    let window: [Date, Date] | undefined
    const result = await getSleepDebt(
      'u',
      { end: '2026-03-11', start: '2026-03-10' },
      deps({
        getSleepActivities: async (_user, _naps, start, end) => {
          window = [start, end]
          return sessions
        },
      }),
    )

    expect(window).toEqual([new Date('2026-02-09T00:00:00.000Z'), new Date('2026-03-11T23:59:59.999Z')])
    expect(result).toEqual({
      days: [
        { date: '2026-03-10', debt_minutes: 120, severity: 'mild', slept_minutes: 360 },
        { date: '2026-03-11', debt_minutes: 222, severity: 'mild', slept_minutes: 360 },
      ],
      debt_minutes: 222,
      severity: 'mild',
      sleep_need_minutes: NEED,
    })
  })

  test("today's night not yet synced keeps yesterday's debt in the range, the daily summary and the widget", async () => {
    const morning = deps({ now: () => new Date('2026-03-12T07:00:00Z') })

    const result = await getSleepDebt('u', { end: '2026-03-12', start: '2026-03-11' }, morning)
    expect(result).toMatchObject({
      days: [
        { date: '2026-03-11', debt_minutes: 222 },
        { date: '2026-03-12', debt_minutes: 222, severity: 'mild', slept_minutes: null },
      ],
      debt_minutes: 222,
    })
    expect(await getSleepDebtForDate('u', '2026-03-12', 'UTC', morning)).toMatchObject({ debt_minutes: 222 })
    expect((await getCurrentSleepDebt('u', morning))?.debt_minutes).toBe(222)
  })

  test('judges against the sleep need setting', async () => {
    const result = await getSleepDebt('u', { start: '2026-03-10' }, deps({ getSleepNeed: async () => 360 }))

    expect(result).toMatchObject({ debt_minutes: 0, severity: 'none', sleep_need_minutes: 360 })
  })

  test('passes a range error through', async () => {
    expect(await getSleepDebt('u', { end: '2026-03-01', start: '2026-03-05' }, deps())).toHaveProperty(
      'error',
    )
  })

  test('the debt for one date, null without any night in the weeks before it', async () => {
    expect(await getSleepDebtForDate('u', '2026-03-11', 'UTC', deps())).toEqual({
      date: '2026-03-11',
      debt_minutes: 222,
      severity: 'mild',
      slept_minutes: 360,
    })
    expect(
      await getSleepDebtForDate('u', '2026-03-11', 'UTC', deps({ getSleepActivities: async () => [] })),
    ).toBeNull()
  })

  test('the current debt covers the two weeks up to today, null without sleep data', async () => {
    const current = await getCurrentSleepDebt('u', deps())
    expect(current?.days).toHaveLength(14)
    expect(current?.debt_minutes).toBe(222)
    expect(await getCurrentSleepDebt('u', deps({ getSleepActivities: async () => [] }))).toBeNull()
  })
})
