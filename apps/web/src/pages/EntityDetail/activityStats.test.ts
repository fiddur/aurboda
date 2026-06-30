import { describe, expect, test } from 'vitest'

import type { Activity } from '../../state/api'

import { buildActivityStatRows } from './activityStats'

const baseActivity = (overrides: Partial<Activity> = {}): Activity =>
  ({
    id: 'a1',
    activity_type: 'running',
    start_time: new Date('2026-06-01T09:57:00Z'),
    ...overrides,
  }) as Activity

const input = (overrides: Partial<Parameters<typeof buildActivityStatRows>[0]> = {}) => ({
  activity: baseActivity(),
  displayStart: new Date('2026-06-01T09:57:00Z'),
  displayEnd: new Date('2026-06-01T10:28:00Z'),
  durationLabel: 'Duration',
  totalCalories: undefined,
  sleepMinutes: undefined,
  notes: '',
  ...overrides,
})

describe('buildActivityStatRows', () => {
  test('always emits a Time row', () => {
    const rows = buildActivityStatRows(input({ displayEnd: undefined }))
    expect(rows[0]?.label).toBe('Time')
    expect(rows.find((r) => r.label === 'Duration')).toBeUndefined()
  })

  test('emits Duration row only when displayEnd is present', () => {
    const rows = buildActivityStatRows(input())
    expect(rows.find((r) => r.label === 'Duration')?.value).toBe('31m')
  })

  test('uses custom duration label (e.g. "In Bed" for sleep)', () => {
    const rows = buildActivityStatRows(input({ durationLabel: 'In Bed' }))
    expect(rows.find((r) => r.label === 'In Bed')).toBeDefined()
    expect(rows.find((r) => r.label === 'Duration')).toBeUndefined()
  })

  test('emits all populated metric rows in order', () => {
    const rows = buildActivityStatRows(
      input({
        activity: baseActivity({
          distance: 2770,
          avg_pace: 651,
          avg_cadence: 153,
          avg_hr: 122,
          max_hr: 136,
          avg_hrv: 45,
        }),
        totalCalories: 193,
      }),
    )
    expect(rows.map((r) => r.label)).toEqual([
      'Time',
      'Duration',
      'Distance',
      'Avg Pace',
      'Avg Cadence',
      'Avg HR',
      'Max HR',
      'Active Calories',
      'Avg HRV',
    ])
    expect(rows.find((r) => r.label === 'Distance')?.value).toBe('2.77 km')
    expect(rows.find((r) => r.label === 'Avg Cadence')?.value).toBe('153 spm')
    expect(rows.find((r) => r.label === 'Avg HR')?.value).toBe('122 bpm')
    expect(rows.find((r) => r.label === 'Max HR')?.value).toBe('136 bpm')
    expect(rows.find((r) => r.label === 'Active Calories')?.value).toBe('193 kcal')
  })

  test('omits rows whose underlying data is missing', () => {
    const rows = buildActivityStatRows(input())
    expect(rows.find((r) => r.label === 'Distance')).toBeUndefined()
    expect(rows.find((r) => r.label === 'Avg Pace')).toBeUndefined()
    expect(rows.find((r) => r.label === 'Avg Cadence')).toBeUndefined()
    expect(rows.find((r) => r.label === 'Active Calories')).toBeUndefined()
    expect(rows.find((r) => r.label === 'Notes')).toBeUndefined()
  })

  test('emits Asleep row when sleepMinutes provided', () => {
    const rows = buildActivityStatRows(input({ sleepMinutes: 425 }))
    expect(rows.find((r) => r.label === 'Asleep')?.value).toBe('7h 5m')
  })

  test('emits Notes row when notes are non-empty', () => {
    const rows = buildActivityStatRows(input({ notes: 'Felt great' }))
    expect(rows.at(-1)).toEqual({ label: 'Notes', value: 'Felt great' })
  })
})
