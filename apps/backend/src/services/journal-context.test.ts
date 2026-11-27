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
} from './journal-context.ts'
import { moonPhase } from './moon.ts'

const item = (raw: Record<string, unknown>): JournalContextItem => journalContextItemSchema.parse(raw)

const deps = (overrides: Partial<JournalContextDeps> = {}): JournalContextDeps => ({
  daysSinceActivity: async () => undefined,
  getItems: async () => [],
  metricValue: async () => undefined,
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

  test('a leap-day birthday turns a year older on 1 March in a common year', () => {
    expect(elapsedSince('2000-02-29', '2004-02-29', 'years')).toBe(4)
    expect(elapsedSince('2000-02-29', '2001-02-27', 'years')).toBeLessThan(1)
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
        metricValue: async (_user, metricItem) => {
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
