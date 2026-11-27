import {
  type JournalContextItem,
  journalContextItemSchema,
  journalContextItemsSchema,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  contextForItems,
  elapsedSince,
  entryContextDay,
  formatContextValue,
  getJournalContext,
  type JournalContextDeps,
  truncateTo,
} from './journal-context.ts'
import { moonPhase } from './moon.ts'

const item = (raw: Record<string, unknown>): JournalContextItem => journalContextItemSchema.parse(raw)

const deps = (overrides: Partial<JournalContextDeps> = {}): JournalContextDeps => ({
  daysSinceActivity: async () => undefined,
  getCustomMetrics: async () => [],
  getItems: async () => [],
  metricValue: async () => undefined,
  trainingLoadValue: async () => undefined,
  trendValue: async () => undefined,
  ...overrides,
})

const quiet = <T>(run: () => Promise<T>): Promise<T> => {
  const warn = console.warn
  console.warn = () => undefined
  return run().finally(() => {
    console.warn = warn
  })
}

describe('journal context item schema', () => {
  test('fills the defaults', () => {
    expect(item({ id: 'r', kind: 'metric', label: 'ŌR', metric: 'readiness_score' })).toEqual({
      decimals: 0,
      id: 'r',
      kind: 'metric',
      label: 'ŌR',
      metric: 'readiness_score',
      missing: 'hide',
    })
    expect(item({ id: 'm', kind: 'moon', label: '' })).toMatchObject({ value: 'illumination' })
    expect(
      item({ id: 'd', kind: 'days_since', label: 'E', pattern: 'sauna', source_type: 'tag' }),
    ).toMatchObject({
      unit: 'days',
    })
  })

  test('rejects duplicate ids and more than 30 items', () => {
    const moon = { id: 'm', kind: 'moon', label: '' }
    expect(journalContextItemsSchema.safeParse([moon, moon]).success).toBe(false)
    const many = Array.from({ length: 31 }, (_, i) => ({ ...moon, id: `m${i}` }))
    expect(journalContextItemsSchema.safeParse(many).success).toBe(false)
    expect(journalContextItemsSchema.safeParse(many.slice(0, 30)).success).toBe(true)
  })

  test('rejects a long label and too many decimals', () => {
    expect(journalContextItemSchema.safeParse({ id: 'm', kind: 'moon', label: 'x'.repeat(13) }).success).toBe(
      false,
    )
    expect(
      journalContextItemSchema.safeParse({ decimals: 4, id: 'm', kind: 'moon', label: '' }).success,
    ).toBe(false)
  })

  test('days_since needs a date for the date source and a pattern for the others', () => {
    const base = { id: 'd', kind: 'days_since', label: 'A' }
    expect(journalContextItemSchema.safeParse({ ...base, source_type: 'date' }).success).toBe(false)
    expect(
      journalContextItemSchema.safeParse({ ...base, date: '1980-05-17', source_type: 'date' }).success,
    ).toBe(true)
    expect(journalContextItemSchema.safeParse({ ...base, source_type: 'tag' }).success).toBe(false)
  })
})

describe('elapsedSince', () => {
  test('counts days and weeks', () => {
    expect(elapsedSince('2024-01-01', '2024-01-01', 'days')).toBe(0)
    expect(elapsedSince('2024-01-01', '2024-01-15', 'days')).toBe(14)
    expect(elapsedSince('2024-01-01', '2024-01-11', 'weeks')).toBeCloseTo(10 / 7, 10)
  })

  test('counts years as whole years plus the fraction of the current one', () => {
    expect(elapsedSince('1980-05-17', '2025-05-17', 'years')).toBe(45)
    expect(elapsedSince('1980-05-17', '2025-09-15', 'years')).toBeCloseTo(45 + 121 / 365, 10)
  })

  test('a leap-day birthday turns a year older on 28 February in a common year', () => {
    expect(elapsedSince('2000-02-29', '2004-02-29', 'years')).toBe(4)
    expect(elapsedSince('2000-02-29', '2001-02-27', 'years')).toBeLessThan(1)
    expect(elapsedSince('2000-02-29', '2001-02-28', 'years')).toBe(1)
    expect(elapsedSince('2000-02-29', '2001-03-01', 'years')).toBeCloseTo(1 + 1 / 365, 10)
  })

  test('is undefined for a date after the day', () => {
    expect(elapsedSince('2024-01-02', '2024-01-01', 'days')).toBeUndefined()
    expect(elapsedSince('2024-01-02', '2024-01-01', 'years')).toBeUndefined()
  })
})

describe('formatContextValue', () => {
  test('formats with the decimals, label and suffix', () => {
    const value = formatContextValue(
      item({ decimals: 1, id: 'w', kind: 'metric', label: 'W', metric: 'weight' }),
      96.62,
    )
    expect(value).toEqual({
      decimals: 1,
      id: 'w',
      kind: 'metric',
      label: 'W',
      name: 'weight',
      suffix: '',
      text: 'W96.6',
      value: 96.62,
    })
  })

  test('names a derived dashboard metric readably', () => {
    const metric = (raw: Record<string, unknown>) =>
      formatContextValue(item({ id: 'r', kind: 'metric', label: 'R', ...raw }), 50).name
    expect(metric({ metric: 'rhr_7day' })).toBe('Resting HR (7-day)')
    expect(metric({ metric: 'zone2_weekly', source: 'garmin' })).toBe('Zone 2 (Weekly) (garmin)')
    expect(metric({ metric: 'resting_heart_rate' })).toBe('resting_heart_rate')
  })

  test('never prints -0', () => {
    const metric = item({ id: 't', kind: 'metric', label: 'T', metric: 'temperature' })
    expect(formatContextValue(metric, -0.2).text).toBe('T0')
    expect(formatContextValue({ ...metric, decimals: 1 }, -0.04).text).toBe('T0.0')
    expect(formatContextValue(metric, -0.6).text).toBe('T-1')
  })
})

describe('truncateTo', () => {
  test('cuts instead of rounding, without floating-point slips', () => {
    expect(truncateTo(46.53, 0)).toBe(46)
    expect(truncateTo(46.59, 1)).toBe(46.5)
    expect(truncateTo(46.5, 1)).toBe(46.5)
    expect(truncateTo(2, 2)).toBe(2)
  })
})

describe('contextForItems', () => {
  const day = '2024-03-10'

  test('keeps the order, leaves out missing values and failing items', async () => {
    const items = [
      item({ id: 'a', kind: 'metric', label: 'ŌR', metric: 'readiness_score', source: 'oura' }),
      item({ id: 'b', kind: 'metric', label: 'X', metric: 'missing_metric' }),
      item({
        decimals: 1,
        half_life_days: 30,
        id: 'c',
        kind: 'trend',
        label: 'HA',
        pattern: 'sauna',
        source_type: 'activity_type',
      }),
      item({ id: 'd', kind: 'metric', label: 'B', metric: 'broken' }),
      item({ id: 'e', kind: 'days_since', label: 'E', pattern: 'sauna', source_type: 'tag' }),
    ]
    const context = await quiet(() =>
      contextForItems('u', items, day, 'UTC', {
        ...deps(),
        daysSinceActivity: async () => 3,
        metricValue: async (_scope, metricItem) => {
          if (metricItem.metric === 'broken') throw new Error('boom')
          return metricItem.metric === 'readiness_score' ? 85 : undefined
        },
        trendValue: async () => 5.71,
      }),
    )
    expect(context.date).toBe(day)
    expect(context.items.map((v) => [v.id, v.text, v.name])).toEqual([
      ['a', 'ŌR85', 'readiness_score (oura)'],
      ['c', 'HA5.7', 'Trend: sauna (30 d half-life, monthly)'],
      ['e', 'E3', 'Days since sauna'],
    ])
  })

  test('shows the moon with its phase emoji and suffix', async () => {
    const items = [
      item({ id: 'i', kind: 'moon', label: '' }),
      item({ decimals: 1, id: 'd', kind: 'moon', label: 'M', value: 'age_days' }),
    ]
    const moon = moonPhase(day)
    const context = await contextForItems('u', items, day, 'UTC', deps())
    expect(context.items).toMatchObject([
      {
        label: moon.emoji,
        name: 'Moon illumination',
        suffix: '%',
        text: `${moon.emoji}${moon.illumination.toFixed(0)}%`,
      },
      { label: `M${moon.emoji}`, suffix: 'd', text: `M${moon.emoji}${moon.age_days.toFixed(1)}d` },
    ])
  })

  test('converts days since an activity to the unit', async () => {
    const items = [
      item({
        decimals: 2,
        id: 'w',
        kind: 'days_since',
        label: 'W',
        pattern: 'run',
        source_type: 'activity_type',
        unit: 'weeks',
      }),
    ]
    const context = await contextForItems('u', items, day, 'UTC', {
      ...deps(),
      daysSinceActivity: async () => 14,
    })
    expect(context.items).toMatchObject([{ name: 'Weeks since run', text: 'W2.00', value: 2 }])
  })

  test('counts from a fixed date, and leaves out a date after the day', async () => {
    const items = [
      item({
        date: '1980-05-17',
        decimals: 1,
        id: 'age',
        kind: 'days_since',
        label: 'A',
        source_type: 'date',
        unit: 'years',
      }),
      item({ date: '2024-03-11', id: 'later', kind: 'days_since', label: 'L', source_type: 'date' }),
    ]
    const context = await contextForItems('u', items, day, 'UTC', deps())
    expect(context.items).toHaveLength(1)
    expect(context.items[0]).toMatchObject({ name: 'Years since 1980-05-17', text: 'A43.8' })
  })

  test('truncates an age to its decimals, so value and text agree', async () => {
    const age = (decimals: number) =>
      item({
        date: '1980-05-17',
        decimals,
        id: `a${decimals}`,
        kind: 'days_since',
        label: 'A',
        source_type: 'date',
        unit: 'years',
      })
    const context = await contextForItems('u', [age(0), age(1)], '2026-11-27', 'UTC', deps())
    expect(context.items.map((v) => [v.value, v.text])).toEqual([
      [46, 'A46'],
      [46.5, 'A46.5'],
    ])
  })

  test('loads custom metrics once, and only when a metric or trend item needs them', async () => {
    let loads = 0
    const counting = {
      ...deps(),
      getCustomMetrics: async () => {
        loads++
        return []
      },
      metricValue: async () => 1,
      trendValue: async () => 2,
    }
    const metric = (id: string) => item({ id, kind: 'metric', label: '', metric: 'weight' })
    await contextForItems(
      'u',
      [
        metric('a'),
        metric('b'),
        item({ id: 'c', kind: 'trend', label: '', pattern: 'run', source_type: 'tag' }),
      ],
      day,
      'UTC',
      counting,
    )
    expect(loads).toBe(1)
    await contextForItems('u', [item({ id: 'm', kind: 'moon', label: '' })], day, 'UTC', counting)
    expect(loads).toBe(1)
  })
})

describe('contextForItems with training load', () => {
  const day = '2024-03-10'
  const load = (id: string, value?: string) =>
    item({ decimals: 1, id, kind: 'training_load', label: id.toUpperCase(), ...(value ? { value } : {}) })

  test('defaults to CTL', () => {
    expect(load('c')).toMatchObject({ value: 'ctl' })
  })

  test('fetches the load once for every item and shows each value with its name', async () => {
    let loads = 0
    const context = await contextForItems('u', [load('c'), load('a', 'atl'), load('t', 'tsb')], day, 'UTC', {
      ...deps(),
      trainingLoadValue: async (scope) => {
        loads++
        expect(scope).toMatchObject({ day, tz: 'UTC', user: 'u' })
        return { atl: 61.24, ctl: 48.06, tsb: -13.18 }
      },
    })
    expect(loads).toBe(1)
    expect(context.items.map((v) => [v.kind, v.name, v.text, v.suffix])).toEqual([
      ['training_load', 'Fitness (CTL)', 'C48.1', ''],
      ['training_load', 'Fatigue (ATL)', 'A61.2', ''],
      ['training_load', 'Form (TSB)', 'T-13.2', ''],
    ])
  })

  test('leaves the items out when there is no training load', async () => {
    const context = await contextForItems(
      'u',
      [load('c'), item({ id: 'm', kind: 'moon', label: '' })],
      day,
      'UTC',
      deps(),
    )
    expect(context.items.map((v) => v.id)).toEqual(['m'])
  })

  test('does not fetch the load without a training_load item', async () => {
    let loads = 0
    await contextForItems('u', [item({ id: 'm', kind: 'moon', label: '' })], day, 'UTC', {
      ...deps(),
      trainingLoadValue: async () => {
        loads++
        return undefined
      },
    })
    expect(loads).toBe(0)
  })
})

describe('getJournalContext', () => {
  test('is undefined when no items are configured', async () => {
    expect(await getJournalContext('u', '2024-03-10', 'UTC', deps())).toBeUndefined()
  })

  test('defaults to today in tz', async () => {
    const context = await getJournalContext('u', undefined, 'UTC', {
      ...deps(),
      getItems: async () => [item({ id: 'm', kind: 'moon', label: '' })],
    })
    expect(context?.date).toBe(new Date().toISOString().slice(0, 10))
  })
})

describe('entryContextDay', () => {
  test("is a day entry's date and a time entry's start day in tz", () => {
    expect(entryContextDay({ date: '2024-03-10', entity_type: 'day' }, 'UTC')).toBe('2024-03-10')
    expect(
      entryContextDay({ entity_type: 'time', start_time: '2024-03-10T23:30:00.000Z' }, 'Europe/Stockholm'),
    ).toBe('2024-03-11')
    expect(
      entryContextDay({ entity_type: 'activity', start_time: '2024-03-10T23:30:00.000Z' }, 'UTC'),
    ).toBeUndefined()
  })
})
