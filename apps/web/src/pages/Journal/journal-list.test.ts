import type { Note } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  dayHeading,
  daysLeft,
  daysLeftLabel,
  entryDate,
  entryGlimpse,
  entryTimeLabel,
  groupEntriesByDay,
  isLongText,
  isUnfiltered,
  type JournalFilters,
  journalQueryFor,
} from './journal-list'

const local = (y: number, m: number, d: number, h = 12, min = 0) =>
  new Date(y, m - 1, d, h, min).toISOString()

const timed = (id: string, start: string, extra: Partial<Note> = {}): Note => ({
  content: id,
  entity_type: 'time',
  id,
  start_time: start,
  ...extra,
})

const dayEntry = (id: string, date: string): Note => ({ content: id, date, entity_type: 'day', id })

describe('groupEntriesByDay', () => {
  test('groups newest day first, day entries before the timed ones, timed ones in arrival order', () => {
    const notes = [
      timed('evening', local(2026, 11, 20, 21)),
      timed('morning', local(2026, 11, 20, 8)),
      dayEntry('the-day', '2026-11-20'),
      timed('yesterday', local(2026, 11, 19, 10)),
      dayEntry('older', '2026-11-02'),
    ]

    const days = groupEntriesByDay(notes)

    expect(days.map((d) => d.date)).toEqual(['2026-11-20', '2026-11-19', '2026-11-02'])
    expect(days[0]!.entries.map((n) => n.id)).toEqual(['the-day', 'evening', 'morning'])
  })

  test('a note seen twice (overlapping pages) is listed once, and notes without a date are left out', () => {
    const note = timed('a', local(2026, 1, 1))
    const days = groupEntriesByDay([note, note, { content: 'x', entity_type: 'metric', id: 'm' }])
    expect(days).toHaveLength(1)
    expect(days[0]!.entries).toHaveLength(1)
  })
})

describe('entryDate', () => {
  test('a day entry is its date whatever the time zone; a timed one its local start date', () => {
    expect(entryDate(dayEntry('d', '2026-02-28'))).toBe('2026-02-28')
    expect(entryDate(timed('t', local(2026, 3, 4, 23, 30)))).toBe('2026-03-04')
  })
})

describe('dayHeading', () => {
  test.each([
    ['2026-11-20', 'Today'],
    ['2026-11-19', 'Yesterday'],
    ['2026-11-02', 'Monday 2 November'],
    ['2025-11-20', 'Thursday 20 November 2025'],
  ])('%s is %s', (date, heading) => expect(dayHeading(date, '2026-11-20')).toBe(heading))
})

describe('entryTimeLabel', () => {
  test('a time, a span, nothing for a day entry', () => {
    expect(entryTimeLabel(timed('t', local(2026, 1, 1, 9, 5)))).toBe('09:05')
    expect(entryTimeLabel(timed('t', local(2026, 1, 1, 9, 5), { end_time: local(2026, 1, 1, 10, 30) }))).toBe(
      '09:05–10:30',
    )
    expect(entryTimeLabel(dayEntry('d', '2026-01-01'))).toBe('')
  })
})

describe('days left', () => {
  const now = new Date('2026-11-20T12:00:00Z')
  test('counts whole days up', () => {
    expect(daysLeft('2026-12-20T11:00:00Z', now)).toBe(30)
    expect(daysLeft('2026-11-20T11:00:00Z', now)).toBe(0)
    expect(daysLeft(undefined, now)).toBeUndefined()
  })
  test('labels', () => {
    expect(daysLeftLabel(1)).toBe('1 day left')
    expect(daysLeftLabel(12)).toBe('12 days left')
    expect(daysLeftLabel(0)).toBe('removed today')
  })
})

describe('entryGlimpse', () => {
  test('prefers the title, flattens markdown and cuts long text', () => {
    expect(entryGlimpse({ content: 'x', title: 'First snow' })).toBe('First snow')
    expect(entryGlimpse({ content: '## Walked\n\nto the **lake** #winter ![](https://x/y.png)' })).toBe(
      'Walked to the lake winter',
    )
    expect(entryGlimpse({ content: 'a'.repeat(200) }, 10)).toBe(`${'a'.repeat(9)}…`)
  })
})

describe('isLongText', () => {
  test('by characters or by lines', () => {
    expect(isLongText('short')).toBe(false)
    expect(isLongText('x'.repeat(500))).toBe(true)
    expect(isLongText('a\nb\nc\nd\ne\nf\ng')).toBe(true)
  })
})

describe('journalQueryFor', () => {
  const filters: JournalFilters = { jumpTo: '', needsText: false, search: '', tags: [], withComments: false }

  test('maps the filters to the search, with no related filter by default', () => {
    expect(journalQueryFor({ ...filters, jumpTo: '2026-11-01', tags: ['lake'] }, 'walk', 'UTC')).toEqual({
      include_comments: false,
      needs_text: false,
      q: 'walk',
      related: undefined,
      tags: ['lake'],
      to: '2026-11-01',
      tz: 'UTC',
    })
    expect(isUnfiltered(filters, '')).toBe(true)
  })

  test('related to someone, comments count too and the page is filtered', () => {
    const related = { id: 'p1', type: 'person' as const }
    expect(journalQueryFor({ ...filters, related }, '', undefined)).toMatchObject({
      include_comments: true,
      related,
    })
    expect(isUnfiltered({ ...filters, related }, '')).toBe(false)
  })
})
