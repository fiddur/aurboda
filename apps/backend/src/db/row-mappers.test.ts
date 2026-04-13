import { describe, expect, test } from 'vitest'

import {
  mapActivityRow,
  mapDetectedLocationRow,
  mapMcpSessionRow,
  mapNamedLocationRow,
  mapSyncStateRow,
  parseActivityType,
  parseDataSource,
  parseGeocodeStatus,
  parseSyncStatus,
} from './row-mappers.ts'

describe('type guards', () => {
  test('parseActivityType accepts built-in types', () => {
    expect(parseActivityType('sleep')).toBe('sleep')
    expect(parseActivityType('exercise')).toBe('exercise')
    expect(parseActivityType('meditation')).toBe('meditation')
    expect(parseActivityType('nap')).toBe('nap')
    expect(parseActivityType('rest')).toBe('rest')
  })

  test('parseActivityType accepts custom snake_case types', () => {
    expect(parseActivityType('sauna')).toBe('sauna')
    expect(parseActivityType('hot_bath')).toBe('hot_bath')
    expect(parseActivityType('yin_yoga')).toBe('yin_yoga')
  })

  test('parseActivityType throws on invalid format', () => {
    expect(() => parseActivityType('Invalid')).toThrow('Invalid ActivityType')
    expect(() => parseActivityType('has spaces')).toThrow('Invalid ActivityType')
    expect(() => parseActivityType('123start')).toThrow('Invalid ActivityType')
    expect(() => parseActivityType(null)).toThrow('Invalid ActivityType')
    expect(() => parseActivityType(undefined)).toThrow('Invalid ActivityType')
    expect(() => parseActivityType(42)).toThrow('Invalid ActivityType')
  })

  test('parseDataSource accepts valid sources', () => {
    expect(parseDataSource('health_connect')).toBe('health_connect')
    expect(parseDataSource('oura')).toBe('oura')
    expect(parseDataSource('manual')).toBe('manual')
    expect(parseDataSource('lastfm')).toBe('lastfm')
  })

  test('parseDataSource throws on invalid source', () => {
    expect(() => parseDataSource('invalid')).toThrow('Invalid DataSource')
  })

  test('parseGeocodeStatus accepts valid statuses', () => {
    expect(parseGeocodeStatus('pending')).toBe('pending')
    expect(parseGeocodeStatus('geocoding')).toBe('geocoding')
    expect(parseGeocodeStatus('success')).toBe('success')
    expect(parseGeocodeStatus('failed')).toBe('failed')
  })

  test('parseGeocodeStatus throws on invalid status', () => {
    expect(() => parseGeocodeStatus('invalid')).toThrow('Invalid GeocodeStatus')
  })

  test('parseSyncStatus accepts valid statuses including rate_limited', () => {
    expect(parseSyncStatus('idle')).toBe('idle')
    expect(parseSyncStatus('syncing')).toBe('syncing')
    expect(parseSyncStatus('error')).toBe('error')
    expect(parseSyncStatus('rate_limited')).toBe('rate_limited')
  })

  test('parseSyncStatus throws on invalid status', () => {
    expect(() => parseSyncStatus('invalid')).toThrow('Invalid SyncStatus')
  })
})

describe('mapActivityRow', () => {
  test('maps a database row to Activity', () => {
    const row = {
      activity_type: 'exercise',
      data: { hr: 150 },
      end_time: '2024-01-15T11:00:00Z',
      id: 'abc-123',
      notes: 'Morning run',
      source: 'aurboda',
      start_time: '2024-01-15T10:00:00Z',
      title: 'Run',
    }

    const result = mapActivityRow(row)

    expect(result).toEqual({
      activity_type: 'exercise',
      data: { hr: 150 },
      end_time: new Date('2024-01-15T11:00:00Z'),
      id: 'abc-123',
      notes: 'Morning run',
      source: 'aurboda',
      start_time: new Date('2024-01-15T10:00:00Z'),
      title: 'Run',
    })
  })

  test('handles null end_time', () => {
    const row = {
      activity_type: 'sleep',
      data: null,
      end_time: null,
      id: 'abc-123',
      notes: null,
      source: 'oura',
      start_time: '2024-01-15T23:00:00Z',
      title: null,
    }

    const result = mapActivityRow(row)
    expect(result.end_time).toBeUndefined()
  })

  test('accepts custom snake_case activity types', () => {
    const row = {
      activity_type: 'sauna',
      data: null,
      end_time: null,
      id: 'abc',
      notes: null,
      source: 'aurboda',
      start_time: '2024-01-15T10:00:00Z',
      title: null,
    }

    const result = mapActivityRow(row)
    expect(result.activity_type).toBe('sauna')
  })

  test('throws on invalid activity type format', () => {
    const row = {
      activity_type: 'Has Spaces',
      data: null,
      end_time: null,
      id: 'abc',
      notes: null,
      source: 'aurboda',
      start_time: '2024-01-15T10:00:00Z',
      title: null,
    }

    expect(() => mapActivityRow(row)).toThrow('Invalid ActivityType')
  })
})

describe('mapNamedLocationRow', () => {
  test('maps a database row to NamedLocation', () => {
    const row = {
      created_at: '2024-01-15T10:00:00Z',
      id: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      name: 'Home',
      radius: 200,
      updated_at: '2024-01-15T10:00:00Z',
    }

    const result = mapNamedLocationRow(row)

    expect(result).toEqual({
      created_at: new Date('2024-01-15T10:00:00Z'),
      id: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      name: 'Home',
      radius: 200,
      updated_at: new Date('2024-01-15T10:00:00Z'),
    })
  })
})

describe('mapDetectedLocationRow', () => {
  test('maps a database row to DetectedLocation', () => {
    const row = {
      address: '123 Main St',
      created_at: '2024-01-15T10:00:00Z',
      first_visit: '2024-01-10T08:00:00Z',
      geocode_status: 'success',
      id: 'det-1',
      last_visit: '2024-01-15T08:00:00Z',
      lat: 59.3293,
      lon: 18.0686,
      radius: 150,
      total_minutes: 480,
      updated_at: '2024-01-15T10:00:00Z',
      visit_count: 5,
    }

    const result = mapDetectedLocationRow(row)

    expect(result).toEqual({
      address: '123 Main St',
      created_at: new Date('2024-01-15T10:00:00Z'),
      first_visit: new Date('2024-01-10T08:00:00Z'),
      geocode_status: 'success',
      id: 'det-1',
      last_visit: new Date('2024-01-15T08:00:00Z'),
      lat: 59.3293,
      lon: 18.0686,
      radius: 150,
      total_minutes: 480,
      updated_at: new Date('2024-01-15T10:00:00Z'),
      visit_count: 5,
    })
  })

  test('throws on invalid geocode status', () => {
    const row = {
      address: null,
      created_at: '2024-01-15T10:00:00Z',
      first_visit: '2024-01-10T08:00:00Z',
      geocode_status: 'bogus',
      id: 'det-1',
      last_visit: '2024-01-15T08:00:00Z',
      lat: 59.3293,
      lon: 18.0686,
      radius: 150,
      total_minutes: 480,
      updated_at: '2024-01-15T10:00:00Z',
      visit_count: 5,
    }

    expect(() => mapDetectedLocationRow(row)).toThrow('Invalid GeocodeStatus')
  })
})

describe('mapSyncStateRow', () => {
  test('maps a database row to SyncState', () => {
    const row = {
      data_type: 'sleep',
      error_message: null,
      id: 'sync-1',
      last_sync_time: '2024-01-15T10:00:00Z',
      provider: 'oura',
      retry_after: null,
      status: 'idle',
      sync_start_date: '2024-01-01T00:00:00Z',
      updated_at: '2024-01-15T10:00:00Z',
    }

    const result = mapSyncStateRow(row)

    expect(result).toEqual({
      data_type: 'sleep',
      error_message: null,
      id: 'sync-1',
      last_sync_time: new Date('2024-01-15T10:00:00Z'),
      provider: 'oura',
      retry_after: undefined,
      status: 'idle',
      sync_start_date: new Date('2024-01-01T00:00:00Z'),
      updated_at: new Date('2024-01-15T10:00:00Z'),
    })
  })

  test('handles rate_limited status', () => {
    const row = {
      data_type: 'sleep',
      error_message: 'Rate limited',
      id: 'sync-1',
      last_sync_time: null,
      provider: 'oura',
      retry_after: '2024-01-15T11:00:00Z',
      status: 'rate_limited',
      sync_start_date: null,
      updated_at: '2024-01-15T10:00:00Z',
    }

    const result = mapSyncStateRow(row)
    expect(result.status).toBe('rate_limited')
    expect(result.retry_after).toEqual(new Date('2024-01-15T11:00:00Z'))
  })
})

describe('mapMcpSessionRow', () => {
  test('maps a database row to McpSessionRecord', () => {
    const row = {
      created_at: '2024-01-15T10:00:00Z',
      last_activity: '2024-01-15T12:00:00Z',
      session_id: 'sess-1',
      username: 'testuser',
    }

    const result = mapMcpSessionRow(row)

    expect(result).toEqual({
      created_at: new Date('2024-01-15T10:00:00Z'),
      last_activity: new Date('2024-01-15T12:00:00Z'),
      session_id: 'sess-1',
      username: 'testuser',
    })
  })
})
