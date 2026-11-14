import { describe, expect, test } from 'vitest'

import type { ChallengeRecord } from '../db/index.ts'

import { frozenChange } from './challenge-update.ts'

const existing = {
  end_ts: new Date('2026-11-01T00:00:00Z'),
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: '1d',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
} as ChallengeRecord

describe('frozenChange', () => {
  test('nothing frozen changes with name, visibility or the values sent back as stored', () => {
    expect(frozenChange(existing, { is_public: false, name: 'Renamed' })).toBeNull()
    expect(
      frozenChange(existing, {
        end_ts: new Date('2026-11-01T00:00:00.000Z'),
        spec: { ...existing.spec },
        start_ts: new Date('2026-10-01T00:00:00.000Z'),
        timezone: 'UTC',
      }),
    ).toBeNull()
  })

  test('a different spec is a spec change, even alongside a window change', () => {
    const spec = { ...existing.spec, pattern: 'distance' }
    expect(frozenChange(existing, { spec })).toBe('spec')
    expect(frozenChange(existing, { spec, timezone: 'Europe/Stockholm' })).toBe('spec')
  })

  test('a moved start or end or another timezone is a window change', () => {
    expect(frozenChange(existing, { start_ts: new Date('2026-10-02T00:00:00Z') })).toBe('window')
    expect(frozenChange(existing, { end_ts: new Date('2026-11-15T00:00:00Z') })).toBe('window')
    expect(frozenChange(existing, { timezone: 'Europe/Stockholm' })).toBe('window')
  })
})
