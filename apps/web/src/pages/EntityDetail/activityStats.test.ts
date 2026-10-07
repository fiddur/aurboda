import { describe, expect, test } from 'vitest'

import type { Activity } from '../../state/api'

import { buildActivityStatRows, buildFieldRows, sourceDataEntries } from './activityStats'

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
  })

  test('emits Asleep row when sleepMinutes provided', () => {
    const rows = buildActivityStatRows(input({ sleepMinutes: 425 }))
    expect(rows.find((r) => r.label === 'Asleep')?.value).toBe('7h 5m')
  })
})

describe('buildActivityStatRows: source summary fields', () => {
  test('total calories with the active part, steps only when walked, body battery and elevation', () => {
    const rows = buildActivityStatRows(
      input({
        activity: baseActivity({
          body_battery_after: 54,
          body_battery_before: 56,
          calories: 51,
          elevation_gain: 120.4,
          elevation_loss: 118,
          steps: 0,
        }),
        totalCalories: 12,
      }),
    )
    const value = (label: string) => rows.find((r) => r.label === label)?.value
    expect(value('Calories')).toBe('51 kcal · 12 active')
    expect(value('Active Calories')).toBeUndefined()
    expect(value('Steps')).toBeUndefined()
    expect(value('Body Battery')).toBe('56 → 54')
    expect(value('Elevation')).toBe('+120 m / −118 m')
  })
})

describe('buildFieldRows', () => {
  const schema = {
    fields: [
      { is_categorical: true, label: 'Session name', name: 'session_name', type: 'string' as const },
      { name: 'props', type: 'boolean' as const },
      { name: 'weight', type: 'number' as const, unit: 'kg' },
      { is_categorical: true, name: 'partner', type: 'string' as const },
    ],
  }

  test('declared values in schema order, an empty categorical field to fill in, and rule links', () => {
    const rows = buildFieldRows(
      schema,
      { _enriched_by: 'rule-1234567890', partner: '  ', props: true, session_name: 'Flow', weight: 4 },
      { 'rule-1234567890': 'Morning yoga' },
    )
    expect(rows).toEqual([
      { label: 'Session name', value: 'Flow' },
      { label: 'Props', value: 'Yes' },
      { label: 'Weight', value: '4 kg' },
      { label: 'Partner', missingField: 'partner', value: '' },
      { href: '/deduction-rules/rule-1234567890', label: 'Enriched by', value: 'Morning yoga' },
    ])
  })

  test('no schema and no rules: nothing', () => {
    expect(buildFieldRows(undefined, { anything: 1 }, undefined)).toEqual([])
  })
})

describe('sourceDataEntries', () => {
  test('drops declared fields, values the summary shows and blanks; formats objects and long arrays', () => {
    const entries = sourceDataEntries(
      {
        average_hr: 71,
        calories: 51,
        detail_synced: true,
        endTime: '2026-10-07T10:25:31.094Z',
        garmin_activity_id: 24637616891,
        max_hr: 97,
        metadata: { device: { type: 1 } },
        note: '',
        session_name: 'Flow',
        stages: Array.from({ length: 40 }, (_, i) => i),
        startTime: '2026-10-07T10:05:01Z',
        steps: 0,
      },
      { fields: [{ name: 'session_name', type: 'string' }] },
    )
    expect(entries).toEqual([
      { key: 'garmin_activity_id', label: 'Garmin activity id', value: '24637616891' },
      { key: 'metadata', label: 'Metadata', value: '{\n  "device": {\n    "type": 1\n  }\n}' },
      { key: 'stages', label: 'Stages', value: '40 items' },
    ])
  })
})
