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

describe('formatEntryWindow', () => {
  // Node's default test timezone is the machine's; pin behaviour by comparing
  // structure rather than exact wall-clock times where the timezone matters.
  test('same-day window collapses the end to its time', () => {
    const label = formatEntryWindow('2026-08-02T10:00:00Z', '2026-08-02T11:30:00Z')
    // One date, an en-dash, and a bare end time (no second date).
    expect(label).toMatch(/^\w{3}, \d+ \w{3} \d{4}, \d{2}:\d{2}–\d{2}:\d{2}$/)
  })

  test('cross-day window spells out both ends', () => {
    const label = formatEntryWindow('2026-08-02T01:00:00Z', '2026-08-05T23:00:00Z')
    expect(label).toMatch(/^\w{3}, \d+ \w{3} \d{4}, \d{2}:\d{2} – \w{3}, \d+ \w{3} \d{4}, \d{2}:\d{2}$/)
  })

  test('open-ended window renders only the start', () => {
    const label = formatEntryWindow('2026-08-02T10:00:00Z')
    expect(label).toMatch(/^\w{3}, \d+ \w{3} \d{4}, \d{2}:\d{2}$/)
  })
})
