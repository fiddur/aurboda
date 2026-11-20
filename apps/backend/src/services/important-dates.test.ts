import { describe, expect, test } from 'vitest'

import {
  type DatedEntry,
  dueImportantDates,
  importantDateDedupeKey,
  importantDateOccurrences,
  importantDateTitle,
  occurrenceIn,
} from './important-dates.ts'

const ANNA = { id: '11111111-1111-4111-8111-111111111111', name: 'Anna' }

const entry = (overrides: Partial<DatedEntry> = {}): DatedEntry => ({
  date_id: null,
  day: 12,
  kind: 'birthday',
  label: "Anna's birthday",
  month: 4,
  notify_days_before: null,
  person: ANNA,
  year: null,
  ...overrides,
})

describe('occurrenceIn', () => {
  test('29 February falls on 28 February in a year without one', () => {
    expect(occurrenceIn(2027, 2, 29).toString()).toBe('2027-02-28')
    expect(occurrenceIn(2028, 2, 29).toString()).toBe('2028-02-29')
  })
})

describe('importantDateOccurrences', () => {
  test('lists every occurrence in the window, by date, with the age when the year is known', () => {
    const dates = importantDateOccurrences(
      [
        entry({ year: 1990 }),
        entry({ date_id: 'd1', day: 1, kind: 'anniversary', label: 'Wedding', month: 6, year: 2015 }),
      ],
      '2026-03-01',
      '2027-05-01',
    )
    expect(dates).toEqual([
      {
        date: '2026-04-12',
        date_id: null,
        kind: 'birthday',
        label: "Anna's birthday",
        person: ANNA,
        years: 36,
      },
      { date: '2026-06-01', date_id: 'd1', kind: 'anniversary', label: 'Wedding', person: ANNA, years: 11 },
      {
        date: '2027-04-12',
        date_id: null,
        kind: 'birthday',
        label: "Anna's birthday",
        person: ANNA,
        years: 37,
      },
    ])
  })

  test('leaves out years when unknown or not positive', () => {
    const [unknown] = importantDateOccurrences([entry()], '2026-04-01', '2026-04-30')
    const [zero] = importantDateOccurrences([entry({ year: 2026 })], '2026-04-01', '2026-04-30')
    expect(unknown).not.toHaveProperty('years')
    expect(zero).not.toHaveProperty('years')
  })

  test('29 February is listed on 28 February in a non-leap year', () => {
    const dates = importantDateOccurrences([entry({ day: 29, month: 2 })], '2027-02-01', '2027-03-31')
    expect(dates.map((d) => d.date)).toEqual(['2027-02-28'])
  })

  test('the window is inclusive at both ends', () => {
    expect(importantDateOccurrences([entry()], '2026-04-12', '2026-04-12')).toHaveLength(1)
    expect(importantDateOccurrences([entry()], '2026-04-13', '2027-04-11')).toHaveLength(0)
  })
})

const at = (iso: string) => new Date(iso)

describe('dueImportantDates', () => {
  test('is due from 08:00 local on the day the notice starts, not before', () => {
    const anna = entry({ notify_days_before: 3, year: 1990 })
    expect(dueImportantDates([anna], 'Europe/Stockholm', at('2026-04-09T05:59:00Z'))).toEqual([])
    expect(dueImportantDates([anna], 'Europe/Stockholm', at('2026-04-09T06:00:00Z'))).toEqual([
      { date: '2026-04-12', days_until: 3, entry: anna, years: 36 },
    ])
    expect(dueImportantDates([anna], 'Europe/Stockholm', at('2026-04-09T21:59:00Z'))).toHaveLength(1)
    expect(dueImportantDates([anna], 'Europe/Stockholm', at('2026-04-09T22:00:00Z'))).toEqual([])
  })

  test('reads the day in the zone west of UTC', () => {
    const anna = entry({ notify_days_before: 0 })
    expect(dueImportantDates([anna], 'America/Los_Angeles', at('2026-04-12T14:59:00Z'))).toEqual([])
    expect(dueImportantDates([anna], 'America/Los_Angeles', at('2026-04-12T15:00:00Z'))).toHaveLength(1)
    expect(dueImportantDates([anna], 'America/Los_Angeles', at('2026-04-13T06:00:00Z'))).toHaveLength(1)
    expect(dueImportantDates([anna], 'America/Los_Angeles', at('2026-04-13T07:00:00Z'))).toEqual([])
  })

  test('reads the day in the zone east of UTC', () => {
    const anna = entry({ notify_days_before: 1 })
    expect(dueImportantDates([anna], 'Asia/Tokyo', at('2026-04-10T23:00:00Z'))).toHaveLength(1)
    expect(dueImportantDates([anna], 'Asia/Tokyo', at('2026-04-10T22:59:00Z'))).toEqual([])
  })

  test('counts across a year boundary', () => {
    const date = entry({
      date_id: 'd1',
      day: 2,
      kind: 'other',
      label: 'Name day',
      month: 1,
      notify_days_before: 5,
    })
    expect(dueImportantDates([date], 'UTC', at('2026-12-28T09:00:00Z'))).toEqual([
      { date: '2027-01-02', days_until: 5, entry: date },
    ])
  })

  test('29 February is due ahead of 28 February in a non-leap year', () => {
    const date = entry({ day: 29, month: 2, notify_days_before: 1 })
    expect(dueImportantDates([date], 'UTC', at('2027-02-27T09:00:00Z'))).toEqual([
      { date: '2027-02-28', days_until: 1, entry: date },
    ])
  })

  test('raises nothing without a notice', () => {
    expect(dueImportantDates([entry()], 'UTC', at('2026-04-12T09:00:00Z'))).toEqual([])
  })
})

describe('importantDateTitle', () => {
  test('names the birthday, when it is and the age', () => {
    const birthday = entry({ year: 1990 })
    expect(importantDateTitle({ date: '2026-04-12', days_until: 3, entry: birthday, years: 36 })).toBe(
      "Anna's birthday is in 3 days (turns 36)",
    )
    expect(importantDateTitle({ date: '2026-04-12', days_until: 1, entry: birthday })).toBe(
      "Anna's birthday is tomorrow",
    )
  })

  test('names the person and the label of another date, with the count', () => {
    const wedding = entry({ date_id: 'd1', kind: 'anniversary', label: 'Wedding anniversary' })
    expect(importantDateTitle({ date: '2026-04-12', days_until: 0, entry: wedding, years: 11 })).toBe(
      'Anna: Wedding anniversary is today (11 years)',
    )
  })
})

describe('importantDateDedupeKey', () => {
  test('is per date (or birthday) and occurrence', () => {
    expect(importantDateDedupeKey(entry(), '2026-04-12')).toBe(
      `important_date:birthday:${ANNA.id}:2026-04-12`,
    )
    expect(importantDateDedupeKey(entry({ date_id: 'd1' }), '2026-04-12')).toBe(
      'important_date:d1:2026-04-12',
    )
  })
})
