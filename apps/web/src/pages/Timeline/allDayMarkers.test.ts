import type { Note } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  journalDayMarkers,
  layoutAllDayMarkers,
  markerGroupIcon,
  markerGroupTitle,
  startOfLocalDate,
} from './allDayMarkers'

const day = (id: string, date: string, extra: Partial<Note> = {}): Note => ({
  content: 'Walked to the lake',
  date,
  entity_type: 'day',
  id,
  ...extra,
})

describe('journalDayMarkers', () => {
  test('one marker per day entry, labelled by title or first line, opening the entry', () => {
    const markers = journalDayMarkers([
      day('a', '2026-11-20', { title: 'First snow' }),
      day('b', '2026-11-21'),
      { content: 'timed', entity_type: 'time', id: 'c', start_time: '2026-11-20T10:00:00Z' },
    ])
    expect(markers).toEqual([
      { date: '2026-11-20', href: '/journal/a', kind: 'journal', label: 'First snow' },
      { date: '2026-11-21', href: '/journal/b', kind: 'journal', label: 'Walked to the lake' },
    ])
  })
})

describe('layoutAllDayMarkers', () => {
  const origin = startOfLocalDate('2026-11-18').getTime()
  const hourPx = 10
  const toPos = (at: Date) => ((at.getTime() - origin) / 3_600_000) * hourPx
  const window = { from: startOfLocalDate('2026-11-18'), to: startOfLocalDate('2026-11-23') }
  const marker = (date: string, label = date) => ({ date, kind: 'journal' as const, label })

  test('one group per date at the start of the date, in date order', () => {
    const groups = layoutAllDayMarkers(
      [marker('2026-11-20'), marker('2026-11-19'), marker('2026-11-20', 'x')],
      toPos,
      window,
      20,
    )
    expect(groups.map((g) => [g.date, g.pos, g.markers.length])).toEqual([
      ['2026-11-19', 240, 1],
      ['2026-11-20', 480, 2],
    ])
  })

  test('dates too close together share a glyph when zoomed out', () => {
    const groups = layoutAllDayMarkers(
      [marker('2026-11-19'), marker('2026-11-20')],
      (at) => toPos(at) / 100,
      window,
      20,
    )
    expect(groups).toHaveLength(1)
    expect(groups[0]!.markers).toHaveLength(2)
  })

  test('a date under way at the window start sits at the start; dates outside are left out', () => {
    const midDay = { from: new Date(startOfLocalDate('2026-11-18').getTime() + 8 * 3_600_000), to: window.to }
    const groups = layoutAllDayMarkers(
      [marker('2026-11-18'), marker('2026-11-17'), marker('2026-11-24')],
      toPos,
      midDay,
      20,
    )
    expect(groups.map((g) => [g.date, g.pos])).toEqual([['2026-11-18', 80]])
  })
})

describe('group glyph and title', () => {
  test('a single marker shows its label; several show a count', () => {
    const one = {
      date: '2026-11-20',
      markers: [{ date: '2026-11-20', kind: 'journal' as const, label: 'A' }],
      pos: 0,
    }
    expect(markerGroupTitle(one)).toBe('A')
    expect(markerGroupIcon(one)).toBe('📓')
    expect(markerGroupTitle({ ...one, markers: [...one.markers, ...one.markers] })).toBe('2 entries')
  })
})
