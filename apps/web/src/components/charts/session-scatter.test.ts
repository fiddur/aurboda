import type { ActivitySession, ActivitySessionGroup } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { SERIES_COLORS } from './breakdown'
import {
  buildLegend,
  buildSessionPoints,
  collapsedRadius,
  collapsePoints,
  isHighlighted,
  median,
  missingCaption,
  NONE_KEY,
  OTHER_COLOR,
  OTHER_KEY,
  parseScatterY,
  type ScatterPoint,
  scatterDomain,
  sessionGroupKeys,
  tooltipLines,
} from './session-scatter'

const zones = (z3Secs: number) => ({ 0: 0, 1: 600, 2: 0, 3: z3Secs, 4: 0, 5: 0 })

const session = (id: string, over: Partial<ActivitySession> = {}): ActivitySession => ({
  activity_type: 'yoga',
  fields: {},
  id,
  start_time: '2026-11-01T08:00:00Z',
  ...over,
})

const group = (value: ActivitySessionGroup['value'], session_ids: string[]): ActivitySessionGroup => ({
  avg_hr_count: 0,
  count: session_ids.length,
  first_start_time: '2026-10-01T08:00:00Z',
  last_start_time: '2026-11-01T08:00:00Z',
  session_ids,
  value,
})

const point = (id: string, x: number, y: number, g?: string): ScatterPoint => ({
  count: 1,
  id,
  x,
  y,
  ...(g === undefined ? {} : { group: g }),
})

describe('parseScatterY', () => {
  it('defaults to Z3+ minutes', () => {
    expect(parseScatterY(undefined)).toBe('z3_minutes')
    expect(parseScatterY('nonsense')).toBe('z3_minutes')
    expect(parseScatterY('avg_hr')).toBe('avg_hr')
  })
})

describe('buildSessionPoints', () => {
  const sessions = [
    session('a', { avg_hr: 120, duration: 30, hr_zone_secs: zones(300), title: 'Flow' }),
    session('b', { avg_hr: 90, duration: 20 }),
    session('c', { duration: 45 }),
    session('d', { avg_hr: 100, hr_zone_secs: zones(60) }),
  ]

  it('takes Z3+ minutes from the zones and counts the sessions without them', () => {
    const result = buildSessionPoints(sessions, 'z3_minutes')
    expect(result.points).toEqual([
      { count: 1, id: 'a', start_time: '2026-11-01T08:00:00Z', title: 'Flow', x: 30, y: 5 },
    ])
    expect(result.missing_y).toBe(2)
    expect(result.missing_duration).toBe(1)
  })

  it('takes the average heart rate', () => {
    const result = buildSessionPoints(sessions, 'avg_hr')
    expect(result.points.map((p) => [p.id, p.x, p.y])).toEqual([
      ['a', 30, 120],
      ['b', 20, 90],
    ])
    expect(result.missing_y).toBe(1)
    expect(result.missing_duration).toBe(1)
  })

  it('tags each point with its group, sessions outside every group as none', () => {
    const groupOf = sessionGroupKeys([group('Yin', ['a']), group(null, ['b'])])
    const result = buildSessionPoints(sessions, 'avg_hr', groupOf)
    expect(result.points.map((p) => p.group)).toEqual(['Yin', NONE_KEY])
  })
})

describe('sessionGroupKeys', () => {
  it('maps numbers and booleans to strings and null to none', () => {
    const keys = sessionGroupKeys([group(3, ['a']), group(true, ['b']), group(null, ['c'])])
    expect([...keys]).toEqual([
      ['a', '3'],
      ['b', 'true'],
      ['c', NONE_KEY],
    ])
  })

  it('is empty without groups', () => {
    expect(sessionGroupKeys(undefined).size).toBe(0)
  })
})

describe('median', () => {
  it('takes the middle value, or the mean of the two middle ones', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([4, 1, 3, 2])).toBe(2.5)
  })
})

describe('collapsePoints', () => {
  it('gives one point per group at the medians, with the session count', () => {
    const collapsed = collapsePoints([
      point('a', 10, 1, 'Yin'),
      point('b', 30, 5, 'Yin'),
      point('c', 20, 3, 'Yin'),
      point('d', 60, 20, 'Flow'),
    ])
    expect(collapsed).toEqual([
      { count: 3, group: 'Yin', id: 'Yin', x: 20, y: 3 },
      { count: 1, group: 'Flow', id: 'Flow', x: 60, y: 20 },
    ])
  })
})

describe('buildLegend', () => {
  const label = (key: string) => (key === NONE_KEY ? 'No name' : key)

  it('orders values by count and colours them in palette order', () => {
    const { entries, colorOf } = buildLegend(
      [
        point('a', 1, 1, 'Yin'),
        point('b', 1, 1, 'Flow'),
        point('c', 1, 1, 'Flow'),
        point('d', 1, 1, NONE_KEY),
      ],
      label,
    )
    expect(entries.map((e) => [e.label, e.count, e.color])).toEqual([
      ['Flow', 2, SERIES_COLORS[0]],
      ['Yin', 1, SERIES_COLORS[1]],
      ['No name', 1, SERIES_COLORS[2]],
    ])
    expect(colorOf('Flow')).toBe(SERIES_COLORS[0])
  })

  it('caps the legend with an Other entry for the rest', () => {
    const points = ['a', 'b', 'c', 'd', 'e'].map((g, i) => ({ ...point(g, 1, 1, g), count: 10 - i }))
    const { entries, colorOf } = buildLegend(points, label, 3)
    expect(entries.map((e) => [e.key, e.count])).toEqual([
      ['a', 10],
      ['b', 9],
      [OTHER_KEY, 8 + 7 + 6],
    ])
    expect(entries[2].label).toBe('Other (3)')
    expect(colorOf('e')).toBe(OTHER_COLOR)
  })

  it('needs no Other entry when the values fit', () => {
    const points = ['a', 'b', 'c'].map((g) => point(g, 1, 1, g))
    expect(buildLegend(points, label, 3).entries.map((e) => e.key)).toEqual(['a', 'b', 'c'])
  })

  it('is empty for uncoloured points', () => {
    expect(buildLegend([point('a', 1, 1)], label).entries).toEqual([])
  })
})

describe('isHighlighted', () => {
  const entries = [
    { color: '', count: 1, key: 'Yin', label: 'Yin' },
    { color: '', count: 1, key: OTHER_KEY, label: 'Other' },
  ]

  it('marks everything without a highlight', () => {
    expect(isHighlighted(point('a', 1, 1, 'Flow'), undefined, entries)).toBe(true)
  })

  it('marks only the highlighted value', () => {
    expect(isHighlighted(point('a', 1, 1, 'Yin'), 'Yin', entries)).toBe(true)
    expect(isHighlighted(point('a', 1, 1, 'Flow'), 'Yin', entries)).toBe(false)
  })

  it('marks every value folded into Other', () => {
    expect(isHighlighted(point('a', 1, 1, 'Flow'), OTHER_KEY, entries)).toBe(true)
    expect(isHighlighted(point('a', 1, 1, 'Yin'), OTHER_KEY, entries)).toBe(false)
  })
})

describe('scatterDomain', () => {
  it('starts at 0 and ends at a nice value with some room above the largest', () => {
    expect(scatterDomain([12, 47])).toEqual([0, 50])
    expect(scatterDomain([78])).toEqual([0, 90])
    expect(scatterDomain([])).toEqual([0, 1])
    expect(scatterDomain([0])).toEqual([0, 1])
  })
})

describe('collapsedRadius', () => {
  it('grows with the square root of the count and stays within bounds', () => {
    expect(collapsedRadius(1, 1)).toBe(5)
    expect(collapsedRadius(1, 100)).toBe(5)
    expect(collapsedRadius(100, 100)).toBe(20)
    expect(collapsedRadius(25, 100)).toBeCloseTo(5 + 15 * Math.sqrt(24 / 99))
  })
})

describe('missingCaption', () => {
  it('says how many sessions are left out and why', () => {
    expect(missingCaption({ missing_duration: 0, missing_y: 12 }, 'z3_minutes')).toEqual([
      '12 sessions without heart rate zone data are not shown.',
    ])
    expect(missingCaption({ missing_duration: 1, missing_y: 1 }, 'avg_hr')).toEqual([
      '1 session without an average heart rate is not shown.',
      '1 session without a duration is not shown.',
    ])
    expect(missingCaption({ missing_duration: 0, missing_y: 0 }, 'avg_hr')).toEqual([])
  })
})

describe('tooltipLines', () => {
  const labelOf = (key: string) => (key === NONE_KEY ? 'No name' : key)

  it('shows a session with its title, date, length, y and value', () => {
    const p = { ...point('a', 32, 5, 'Yin'), start_time: '2026-11-01T08:00:00', title: 'Morning' }
    expect(tooltipLines(p, { collapsed: false, labelOf, y: 'z3_minutes' })).toEqual([
      'Morning',
      '2026-11-01 08:00',
      '32 min',
      'Z3+ 5 min',
      'Yin',
    ])
  })

  it('heads an untitled session with its value, once', () => {
    const p = { ...point('a', 75, 121.4, 'Yin'), start_time: '2026-11-01T08:00:00' }
    expect(tooltipLines(p, { collapsed: false, labelOf, y: 'avg_hr' })).toEqual([
      'Yin',
      '2026-11-01 08:00',
      '1 h 15 min',
      'Avg HR 121 bpm',
    ])
  })

  it('shows a collapsed dot with its count and medians', () => {
    const p = { ...point(NONE_KEY, 20, 3, NONE_KEY), count: 4 }
    expect(tooltipLines(p, { collapsed: true, labelOf, y: 'z3_minutes' })).toEqual([
      'No name',
      '4 sessions',
      'Median 20 min',
      'Median Z3+ 3 min',
    ])
  })
})
