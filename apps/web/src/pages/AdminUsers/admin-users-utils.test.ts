import type { AdminUserOverview } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import {
  DEFAULT_SORT,
  formatBytes,
  formatPerDay,
  formatRelative,
  nextSort,
  sortUsers,
  stackDaily,
} from './admin-users-utils'

const NOW = new Date('2026-11-06T12:00:00Z')

const idle = { active_days_30d: 0, last_at: null, reads_30d: 0, writes_30d: 0 }

const user = (username: string, overrides: Partial<AdminUserOverview> = {}): AdminUserOverview => ({
  created_at: null,
  ingest: { items_30d: 0, last_at: null, per_day_30d: 0, per_day_7d: 0, sources: [] },
  is_admin: false,
  last_api_at: null,
  last_ui_at: null,
  pre_existing: false,
  storage_bytes: null,
  use: { android: idle, api: idle, mcp: idle, web: idle },
  username,
  ...overrides,
})

describe('formatBytes', () => {
  test.each([
    [null, '–'],
    [0, '0 B'],
    [512, '512 B'],
    [1536, '1.5 KB'],
    [15 * 1024 * 1024, '15 MB'],
    [1.2 * 1024 ** 3, '1.2 GB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected)
  })
})

describe('formatRelative', () => {
  test.each([
    [null, 'never'],
    ['2026-11-06T11:59:30Z', 'just now'],
    ['2026-11-06T11:15:00Z', '45 min ago'],
    ['2026-11-06T02:00:00Z', '10h ago'],
    ['2026-11-01T12:00:00Z', '5d ago'],
    ['2026-07-01T12:00:00Z', '4 mo ago'],
  ])('%s → %s', (iso, expected) => {
    expect(formatRelative(iso, NOW)).toBe(expected)
  })
})

describe('formatPerDay', () => {
  test('one decimal under ten, whole numbers above', () => {
    expect(formatPerDay(0)).toBe('0')
    expect(formatPerDay(0.43)).toBe('0.4')
    expect(formatPerDay(123.4)).toBe('123')
  })
})

describe('sortUsers', () => {
  const users = [
    user('carol', { last_ui_at: '2026-11-01T00:00:00Z', storage_bytes: 30 }),
    user('alice', { last_ui_at: null, storage_bytes: 10 }),
    user('bob', { last_ui_at: '2026-11-05T00:00:00Z', storage_bytes: null }),
  ]

  test('defaults to last UI use, newest first, never-used last', () => {
    expect(sortUsers(users, DEFAULT_SORT).map((u) => u.username)).toEqual(['bob', 'carol', 'alice'])
  })

  test('keeps missing values last in either direction', () => {
    expect(sortUsers(users, { descending: false, key: 'last_ui' }).map((u) => u.username)).toEqual([
      'carol',
      'bob',
      'alice',
    ])
    expect(sortUsers(users, { descending: false, key: 'storage' }).map((u) => u.username)).toEqual([
      'alice',
      'carol',
      'bob',
    ])
  })

  test('sorts by username', () => {
    expect(sortUsers(users, { descending: false, key: 'username' }).map((u) => u.username)).toEqual([
      'alice',
      'bob',
      'carol',
    ])
  })
})

describe('nextSort', () => {
  test('flips the current column and starts another descending, names ascending', () => {
    expect(nextSort(DEFAULT_SORT, 'last_ui')).toEqual({ descending: false, key: 'last_ui' })
    expect(nextSort(DEFAULT_SORT, 'storage')).toEqual({ descending: true, key: 'storage' })
    expect(nextSort(DEFAULT_SORT, 'username')).toEqual({ descending: false, key: 'username' })
  })
})

describe('stackDaily', () => {
  test('fills every day of the range and orders keys by total', () => {
    const result = stackDaily(
      [
        { channel: 'oura', count: 2, day: '2026-11-04', items: 10, kind: 'ingest' },
        { channel: 'garmin', count: 5, day: '2026-11-06', items: 1, kind: 'ingest' },
        { channel: 'oura', count: 1, day: '2026-11-06', items: 3, kind: 'ingest' },
        { channel: 'web', count: 9, day: '2026-11-06', items: 0, kind: 'read' },
      ],
      (row) => row.kind === 'ingest',
      '2026-11-04',
      '2026-11-06',
    )
    expect(result).toEqual({
      days: ['2026-11-04', '2026-11-05', '2026-11-06'],
      keys: ['garmin', 'oura'],
      rows: [
        { garmin: 0, oura: 2 },
        { garmin: 0, oura: 0 },
        { garmin: 5, oura: 1 },
      ],
    })
  })

  test('sums reads and writes of a channel on the same day', () => {
    const result = stackDaily(
      [
        { channel: 'web', count: 3, day: '2026-11-06', items: 0, kind: 'read' },
        { channel: 'web', count: 2, day: '2026-11-06', items: 0, kind: 'write' },
      ],
      (row) => row.kind !== 'ingest',
      '2026-11-06',
      '2026-11-06',
    )
    expect(result.rows).toEqual([{ web: 5 }])
  })
})
