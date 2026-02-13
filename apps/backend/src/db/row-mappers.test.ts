import { describe, expect, test } from 'vitest'
import {
  mapActivityRow,
  mapDetectedLocationRow,
  mapLastFmTagRuleRow,
  mapMcpSessionRow,
  mapNamedLocationRow,
  mapSyncStateRow,
  mapTagRow,
  parseActivityType,
  parseDataSource,
  parseGeocodeStatus,
  parseSyncStatus,
} from './row-mappers'

describe('type guards', () => {
  test('parseActivityType accepts valid types', () => {
    expect(parseActivityType('sleep')).toBe('sleep')
    expect(parseActivityType('exercise')).toBe('exercise')
    expect(parseActivityType('meditation')).toBe('meditation')
    expect(parseActivityType('nap')).toBe('nap')
  })

  test('parseActivityType throws on invalid type', () => {
    expect(() => parseActivityType('invalid')).toThrow('Invalid ActivityType')
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
      source: 'manual',
      start_time: '2024-01-15T10:00:00Z',
      title: 'Run',
    }

    const result = mapActivityRow(row)

    expect(result).toEqual({
      activityType: 'exercise',
      data: { hr: 150 },
      endTime: new Date('2024-01-15T11:00:00Z'),
      id: 'abc-123',
      notes: 'Morning run',
      source: 'manual',
      startTime: new Date('2024-01-15T10:00:00Z'),
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
    expect(result.endTime).toBeUndefined()
  })

  test('throws on invalid activity type', () => {
    const row = {
      activity_type: 'invalid',
      data: null,
      end_time: null,
      id: 'abc',
      notes: null,
      source: 'manual',
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
      createdAt: new Date('2024-01-15T10:00:00Z'),
      id: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      name: 'Home',
      radius: 200,
      updatedAt: new Date('2024-01-15T10:00:00Z'),
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
      createdAt: new Date('2024-01-15T10:00:00Z'),
      firstVisit: new Date('2024-01-10T08:00:00Z'),
      geocodeStatus: 'success',
      id: 'det-1',
      lastVisit: new Date('2024-01-15T08:00:00Z'),
      lat: 59.3293,
      lon: 18.0686,
      radius: 150,
      totalMinutes: 480,
      updatedAt: new Date('2024-01-15T10:00:00Z'),
      visitCount: 5,
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
      dataType: 'sleep',
      errorMessage: null,
      id: 'sync-1',
      lastSyncTime: new Date('2024-01-15T10:00:00Z'),
      provider: 'oura',
      retryAfter: undefined,
      status: 'idle',
      syncStartDate: new Date('2024-01-01T00:00:00Z'),
      updatedAt: new Date('2024-01-15T10:00:00Z'),
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
    expect(result.retryAfter).toEqual(new Date('2024-01-15T11:00:00Z'))
  })
})

describe('mapTagRow', () => {
  test('maps a database row to Tag', () => {
    const row = {
      end_time: '2024-01-15T11:00:00Z',
      external_id: 'ext-1',
      id: 'tag-1',
      source: 'manual',
      start_time: '2024-01-15T10:00:00Z',
      tag: 'coffee',
    }

    const result = mapTagRow(row)

    expect(result).toEqual({
      endTime: new Date('2024-01-15T11:00:00Z'),
      externalId: 'ext-1',
      id: 'tag-1',
      source: 'manual',
      startTime: new Date('2024-01-15T10:00:00Z'),
      tag: 'coffee',
    })
  })

  test('handles null end_time', () => {
    const row = {
      end_time: null,
      external_id: 'ext-1',
      id: 'tag-1',
      source: 'manual',
      start_time: '2024-01-15T10:00:00Z',
      tag: 'coffee',
    }

    const result = mapTagRow(row)
    expect(result.endTime).toBeUndefined()
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
      createdAt: new Date('2024-01-15T10:00:00Z'),
      lastActivity: new Date('2024-01-15T12:00:00Z'),
      sessionId: 'sess-1',
      username: 'testuser',
    })
  })
})

describe('mapLastFmTagRuleRow', () => {
  test('maps a database row to LastFmTagRule', () => {
    const row = {
      artist_name: 'Pink Floyd',
      created_at: '2024-01-15T10:00:00Z',
      id: 'rule-1',
      match_mode: 'exact',
      match_type: 'artist',
      rule_name: 'Pink Floyd tag',
      tag_name: 'psychedelic',
      track_name: null,
    }

    const result = mapLastFmTagRuleRow(row)

    expect(result).toEqual({
      artistName: 'Pink Floyd',
      createdAt: new Date('2024-01-15T10:00:00Z'),
      id: 'rule-1',
      matchMode: 'exact',
      matchType: 'artist',
      ruleName: 'Pink Floyd tag',
      tagName: 'psychedelic',
      trackName: undefined,
    })
  })
})
