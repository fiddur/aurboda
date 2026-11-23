import { describe, expect, test } from 'vitest'

import {
  dateRuns,
  type SuggestionActivity,
  suggestActivities,
  suggestionKey,
  suggestPeople,
} from './note-link-suggestions.ts'

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`

const NONE: ReadonlySet<string> = new Set()

const people = (...names: string[]) => names.map((name, i) => ({ id: id(i + 1), name }))

const names = (text: string, list: { id: string; name: string }[], linked = NONE, dismissed = NONE) =>
  suggestPeople(text, list, linked, dismissed).map((s) => s.label)

describe('suggestPeople', () => {
  test('matches a whole name in any case, and not inside a longer word', () => {
    const list = people('Sara', 'Bo')
    expect(names('Fika med sara idag', list)).toEqual(['Sara'])
    expect(names('Saraband och Bob', list)).toEqual([])
    expect(names('BO kom förbi', list)).toEqual(['Bo'])
  })

  test('matches letters outside ASCII as part of a word', () => {
    const list = people('Åsa', 'Li')
    expect(names('Med åsa i Lidingö', list)).toEqual(['Åsa'])
    expect(names('Liås', list)).toEqual([])
  })

  test('takes a possessive s, apostrophe s and typographic apostrophe s', () => {
    const list = people('Sara', 'Anna', 'Eva')
    expect(names('Saras katt', list)).toEqual(['Sara'])
    expect(names("Anna's cat", list)).toEqual(['Anna'])
    expect(names('Eva’s dog', list)).toEqual(['Eva'])
    expect(names('Evaa', list)).toEqual([])
  })

  test('matches a full name across any spacing, and a name holding regex characters literally', () => {
    const list = people('Anna Svensson', 'C++ Club (Tue)')
    expect(names('Lunch with anna\n svensson', list)).toEqual(['Anna Svensson'])
    expect(names('Went to C++ Club (Tue) again', list)).toEqual(['C++ Club (Tue)'])
    expect(names('C Club Tue', list)).toEqual([])
  })

  test('matches the first name alone when it is long enough and no one else has it', () => {
    expect(names('Ringde Anna', people('Anna Svensson', 'Bo Ek'))).toEqual(['Anna Svensson'])
    expect(names('Annas bok', people('Anna Svensson'))).toEqual(['Anna Svensson'])
    expect(names('Bo var där', people('Bo Ek'))).toEqual([])
    expect(names('Anna var där', people('Anna Svensson', 'Anna Berg'))).toEqual([])
    expect(names('Anna Berg var där', people('Anna Svensson', 'Anna Berg'))).toEqual(['Anna Berg'])
    expect(names('Anna var där', people('Anna', 'Anna Berg'))).toEqual(['Anna'])
  })

  test('skips the people already linked or dismissed', () => {
    const list = people('Sara', 'Bo', 'Eva')
    const linked = new Set([suggestionKey('person', list[0]!.id.toUpperCase())])
    const dismissed = new Set([suggestionKey('person', list[1]!.id)])
    expect(names('Sara, Bo och Eva', list, linked, dismissed)).toEqual(['Eva'])
  })

  test('orders by first appearance and answers person suggestions', () => {
    const list = people('Sara', 'Bo', 'Eva')
    const found = suggestPeople('Eva och Bo, sedan Sara. Eva igen.', list, NONE, NONE)
    expect(found).toEqual([
      { entity_id: id(3), entity_type: 'person', label: 'Eva', reason: 'name_in_text' },
      { entity_id: id(2), entity_type: 'person', label: 'Bo', reason: 'name_in_text' },
      { entity_id: id(1), entity_type: 'person', label: 'Sara', reason: 'name_in_text' },
    ])
  })
})

const activity = (
  n: number,
  type: string,
  start: string,
  end: string | null,
  extra: Partial<SuggestionActivity> = {},
): SuggestionActivity => ({
  activity_type: type,
  end_time: end === null ? null : new Date(end),
  id: id(n),
  name: extra.name ?? type,
  start_time: new Date(start),
  ...extra,
})

const TZ = 'Europe/Stockholm'

const suggested = (
  entry: Parameters<typeof suggestActivities>[0],
  list: SuggestionActivity[],
  tz = TZ,
  linked = NONE,
  dismissed = NONE,
) => suggestActivities(entry, list, tz, linked, dismissed).map((s) => [s.entity_id, s.reason])

describe('suggestActivities', () => {
  const sleep = activity(1, 'sleep', '2026-11-19T22:00:00Z', '2026-11-20T06:00:00Z', { name: 'Sleep' })
  const walk = activity(2, 'walking', '2026-11-20T15:00:00Z', '2026-11-20T16:00:00Z', { name: 'Walk' })
  const run = activity(3, 'running', '2026-11-20T08:00:00Z', '2026-11-20T09:00:00Z', { name: 'Run' })

  test("a morning entry gets the night's sleep and the day's activities in time order", () => {
    const entry = { entity_type: 'time' as const, start_time: new Date('2026-11-20T07:30:00Z') }
    expect(suggested(entry, [walk, sleep, run])).toEqual([
      [id(1), 'night_sleep'],
      [id(3), 'same_day'],
      [id(2), 'same_day'],
    ])
  })

  test('labels activities as links are labelled: a sleep by the day it ended', () => {
    const entry = { entity_type: 'time' as const, start_time: new Date('2026-11-20T07:30:00Z') }
    const [night, day] = suggestActivities(entry, [sleep, walk], TZ, NONE, NONE)
    expect(night).toEqual({
      activity_type: 'sleep',
      entity_id: id(1),
      entity_type: 'activity',
      label: 'Sleep, 2026-11-20',
      reason: 'night_sleep',
    })
    expect(day?.label).toBe('Walk, 2026-11-20')
  })

  test('the morning cutoff and the dates are in the user zone, across a UTC date boundary', () => {
    const lateSleep = activity(4, 'sleep', '2026-11-19T23:30:00Z', '2026-11-20T23:30:00Z')
    const tokyo = 'Asia/Tokyo'
    // 2026-11-20T23:45Z is 08:45 on 21 November in Tokyo: morning, and the sleep ended that day (08:30).
    const entry = { entity_type: 'time' as const, start_time: new Date('2026-11-20T23:45:00Z') }
    expect(suggested(entry, [lateSleep], tokyo)).toEqual([[id(4), 'night_sleep']])
    // The same instant is 00:45 on 21 November in Stockholm, and the sleep ended on the 21st there too.
    expect(suggested(entry, [lateSleep], TZ)).toEqual([[id(4), 'night_sleep']])
    // 12:30 in Tokyo is not morning.
    const noon = { entity_type: 'time' as const, start_time: new Date('2026-11-21T03:30:00Z') }
    expect(suggested(noon, [lateSleep], tokyo)).toEqual([])
  })

  test('a sleep ending after the entry, or on another day, is not suggested', () => {
    const early = { entity_type: 'time' as const, start_time: new Date('2026-11-20T05:00:00Z') }
    expect(suggested(early, [sleep])).toEqual([])
    const nextDay = { entity_type: 'time' as const, start_time: new Date('2026-11-21T07:00:00Z') }
    expect(suggested(nextDay, [sleep])).toEqual([])
  })

  test('of several sleeps, the one ending last; an afternoon entry gets none', () => {
    const first = activity(5, 'sleep', '2026-11-19T21:00:00Z', '2026-11-20T02:00:00Z')
    const entry = { entity_type: 'time' as const, start_time: new Date('2026-11-20T08:00:00Z') }
    expect(suggested(entry, [sleep, first])).toEqual([[id(1), 'night_sleep']])
    const afternoon = { entity_type: 'time' as const, start_time: new Date('2026-11-20T14:00:00Z') }
    expect(suggested(afternoon, [sleep, walk])).toEqual([[id(2), 'same_day']])
  })

  test('a day entry gets no sleep, only the activities starting on its date', () => {
    const entry = { date: '2026-11-20', entity_type: 'day' as const }
    const yesterday = activity(6, 'walking', '2026-11-19T15:00:00Z', '2026-11-19T16:00:00Z')
    expect(suggested(entry, [sleep, walk, run, yesterday])).toEqual([
      [id(3), 'same_day'],
      [id(2), 'same_day'],
    ])
  })

  test('location visits and screen-time spans are left out', () => {
    const entry = { date: '2026-11-20', entity_type: 'day' as const }
    const visit = activity(7, 'location_visit', '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z')
    const coding = activity(8, 'software_development', '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z', {
      data: { category_path: 'Work > Programming' },
    })
    const legacy = activity(9, 'screentime', '2026-11-20T10:00:00Z', '2026-11-20T11:00:00Z')
    expect(suggested(entry, [visit, coding, legacy, walk])).toEqual([[id(2), 'same_day']])
  })

  test('at most twelve of the day, and the linked or dismissed ones are skipped first', () => {
    const entry = { date: '2026-11-20', entity_type: 'day' as const }
    const many = Array.from({ length: 15 }, (_, i) =>
      activity(100 + i, 'walking', `2026-11-20T${String(i + 5).padStart(2, '0')}:00:00Z`, null),
    )
    const linked = new Set([suggestionKey('activity', id(100))])
    const dismissed = new Set([suggestionKey('activity', id(101))])
    const found = suggested(entry, many, 'UTC', linked, dismissed)
    expect(found).toHaveLength(12)
    expect(found[0]).toEqual([id(102), 'same_day'])
    const sleepDismissed = new Set([suggestionKey('activity', id(1))])
    const morning = { entity_type: 'time' as const, start_time: new Date('2026-11-20T07:30:00Z') }
    expect(suggested(morning, [sleep], TZ, NONE, sleepDismissed)).toEqual([])
  })
})

describe('dateRuns', () => {
  test('joins dates a few days apart and splits the rest', () => {
    expect(dateRuns([])).toEqual([])
    expect(dateRuns(['2026-11-20', '2024-01-01', '2026-11-17', '2026-11-20', '2026-11-25'])).toEqual([
      { from: '2024-01-01', to: '2024-01-01' },
      { from: '2026-11-17', to: '2026-11-20' },
      { from: '2026-11-25', to: '2026-11-25' },
    ])
  })
})
