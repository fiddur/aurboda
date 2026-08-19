// Pin the timezone BEFORE anything formats a date, so the same-day/cross-day
// cases are deterministic on any machine (10:00–11:30Z crosses midnight in a
// UTC+13 test environment otherwise). Node propagates the change to Intl.
process.env.TZ = 'UTC'

import { describe, expect, test } from 'vitest'

import { formatEntryWindow, splitStats } from './activity-stats'

describe('splitStats', () => {
  test('maps scalars to labelled cells, humanizing seconds and appending units', () => {
    const { cells, zones } = splitStats([
      { key: 'duration', unit: 'seconds', value: 8895 },
      { key: 'heart_rate_avg', unit: 'bpm', value: 107 },
      { key: 'distance', unit: 'km', value: 8.235 },
    ])
    expect(cells).toEqual([
      { key: 'duration', label: 'Duration', value: '2h 28m 15s' },
      { key: 'heart_rate_avg', label: 'Avg HR', value: '107 bpm' },
      { key: 'distance', label: 'Distance', value: '8.24 km' },
    ])
    expect(zones).toEqual([])
  })

  test('splits an HR-zone record into the compact zones row', () => {
    const { cells, zones } = splitStats([{ key: 'hr_zone_minutes', value: { z0: 13, z1: 71, z2: 61 } }])
    expect(cells).toEqual([])
    expect(zones).toEqual([
      { minutes: 13, zone: 'Rest' },
      { minutes: 71, zone: 'Z1' },
      { minutes: 61, zone: 'Z2' },
    ])
  })

  test('falls back to the raw key as label for an unknown metric', () => {
    const { cells } = splitStats([{ key: 'mystery_metric', value: 5 }])
    expect(cells[0]?.label).toBe('mystery_metric')
    expect(cells[0]?.value).toBe('5')
  })
})

describe('formatEntryWindow (TZ pinned to UTC)', () => {
  test('same-day window collapses the end to its time', () => {
    expect(formatEntryWindow('2026-08-02T10:00:00Z', '2026-08-02T11:30:00Z')).toBe(
      'Sun, 2 Aug 2026, 10:00–11:30',
    )
  })

  test('cross-day window spells out both ends', () => {
    expect(formatEntryWindow('2026-08-02T01:00:00Z', '2026-08-05T23:00:00Z')).toBe(
      'Sun, 2 Aug 2026, 01:00 – Wed, 5 Aug 2026, 23:00',
    )
  })

  test('open-ended window renders only the start', () => {
    expect(formatEntryWindow('2026-08-02T10:00:00Z')).toBe('Sun, 2 Aug 2026, 10:00')
  })
})
