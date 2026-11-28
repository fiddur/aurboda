import type { Note } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  dayHeading,
  daysLeft,
  daysLeftLabel,
  entryCountLabel,
  entryDate,
  entryGlimpse,
  entryTimeLabel,
  groupEntriesByDay,
  isLongText,
  isUnfiltered,
  type JournalFilters,
  commentsFromQuery,
  journalChartHref,
  journalQueryFor,
  listedContext,
  searchFromQuery,
  tagList,
  tagsFromQuery,
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
    expect(
      entryGlimpse({ content: '![](attachment:3f0c2b1a-9d8e-4f7a-8b6c-5d4e3f2a1b0c)\nAt the lake' }),
    ).toBe('At the lake')
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
      include_context: true,
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

describe('listedContext', () => {
  const entry = { content: 'x', date: '2026-11-20', entity_type: 'day' as const, id: 'a' }
  const token = {
    decimals: 0,
    id: 'm',
    kind: 'moon' as const,
    label: '🌕',
    name: 'Moon illumination',
    suffix: '%',
    text: '🌕99%',
    value: 99,
  }

  test('is the line the entry came with, when it has items', () => {
    const context = { date: '2026-11-20', items: [token] }
    expect(listedContext({ ...entry, context })).toBe(context)
  })

  test('is none without a line or with an empty one', () => {
    expect(listedContext(entry)).toBeUndefined()
    expect(listedContext({ ...entry, context: { date: '2026-11-20', items: [] } })).toBeUndefined()
  })
})

describe('tagsFromQuery', () => {
  test('the ?tag= the list opens with, as stored', () => {
    expect(tagsFromQuery({ tag: '#Running' })).toEqual(['running'])
    expect(tagsFromQuery({ tag: 'löpning' })).toEqual(['löpning'])
  })

  test('none without one, or for one that is not a tag', () => {
    expect(tagsFromQuery({})).toEqual([])
    expect(tagsFromQuery({ tag: '' })).toEqual([])
    expect(tagsFromQuery({ tag: '123' })).toEqual([])
    expect(tagsFromQuery({ person: 'x' })).toEqual([])
  })
})

describe('tagList', () => {
  test('normalises each tag, drops what is not one and repeats', () => {
    expect(tagList('#Travel, work,,123,travel')).toEqual(['travel', 'work'])
    expect(tagList(undefined)).toEqual([])
    expect(tagList('')).toEqual([])
  })
})

describe('the other URL readers', () => {
  test('a comma-separated ?tag= opens with each tag', () => {
    expect(tagsFromQuery({ tag: 'travel,Work' })).toEqual(['travel', 'work'])
  })

  test('?q= prefills the search, ?comments=1 shows comments', () => {
    expect(searchFromQuery({ q: 'lake walk' })).toBe('lake walk')
    expect(searchFromQuery({})).toBe('')
    expect(commentsFromQuery({ comments: '1' })).toBe(true)
    expect(commentsFromQuery({ comments: '0' })).toBe(false)
    expect(commentsFromQuery({})).toBe(false)
  })
})

describe('journalChartHref', () => {
  const params = (href: string) => Object.fromEntries(new URLSearchParams(href.split('?')[1]))
  const none = { related: undefined, tags: [], withComments: false }

  test('without filters, entries per week over a year', () => {
    const href = journalChartHref(none, '')
    expect(href.startsWith('/chart?')).toBe(true)
    expect(params(href)).toEqual({
      bucket_size: '1w',
      chart_type: 'bar',
      lookback_days: '365',
      source_type: 'journal',
    })
  })

  test('carries the tags, the related filter, the search and the comments', () => {
    const related = { id: '00000000-0000-4000-8000-000000000001', type: 'person' as const }
    expect(
      params(journalChartHref({ related, tags: ['travel', 'work'], withComments: true }, ' lake ')),
    ).toMatchObject({
      journal_entity_types: 'time,day,activity,meal,report',
      journal_q: 'lake',
      journal_related_id: related.id,
      journal_related_type: 'person',
      journal_tags: 'travel,work',
    })
  })
})

describe('entryCountLabel', () => {
  test('counts every entry without filters, the matching ones with', () => {
    expect(entryCountLabel(1234, true)).toBe('1,234 entries')
    expect(entryCountLabel(1, true)).toBe('1 entry')
    expect(entryCountLabel(12, false)).toBe('12 entries match')
    expect(entryCountLabel(1, false)).toBe('1 entry matches')
  })

  test('says nothing when there are none or the count is not known', () => {
    expect(entryCountLabel(0, true)).toBeUndefined()
    expect(entryCountLabel(undefined, false)).toBeUndefined()
  })
})
