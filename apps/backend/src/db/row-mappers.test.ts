import { describe, expect, test } from 'vitest'

import {
  mapActivityRow,
  mapDetectedLocationRow,
  mapMcpSessionRow,
  mapMealRow,
  mapNamedLocationRow,
  mapReportEntryRow,
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

  test('maps superseded_by when present', () => {
    const row = {
      activity_type: 'running',
      data: null,
      end_time: null,
      id: 'loser-id',
      notes: null,
      source: 'oura',
      start_time: '2024-01-15T10:00:00Z',
      superseded_by: 'winner-id',
      title: null,
    }

    const result = mapActivityRow(row)
    expect(result.superseded_by).toBe('winner-id')
  })

  test('leaves superseded_by undefined when null', () => {
    const row = {
      activity_type: 'running',
      data: null,
      end_time: null,
      id: 'winner-id',
      notes: null,
      source: 'garmin',
      start_time: '2024-01-15T10:00:00Z',
      superseded_by: null,
      title: null,
    }

    const result = mapActivityRow(row)
    expect(result.superseded_by).toBeUndefined()
  })
})

describe('mapNamedLocationRow', () => {
  test('maps a database row to NamedLocation', () => {
    const row = {
      auto_create_activity: false,
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
      auto_create_activity: false,
      created_at: new Date('2024-01-15T10:00:00Z'),
      id: 'loc-1',
      lat: 59.3293,
      lon: 18.0686,
      name: 'Home',
      radius: 200,
      updated_at: new Date('2024-01-15T10:00:00Z'),
    })
  })

  test('defaults auto_create_activity to false when missing/null', () => {
    const row = {
      created_at: '2024-01-15T10:00:00Z',
      id: 'loc-2',
      lat: 0,
      lon: 0,
      name: 'X',
      radius: 200,
      updated_at: '2024-01-15T10:00:00Z',
    }
    expect(mapNamedLocationRow(row).auto_create_activity).toBe(false)
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

describe('mapMealRow', () => {
  test('maps a row with all optional fields null', () => {
    const row = {
      calories: null,
      carbs: null,
      created_at: '2024-01-15T10:00:00Z',
      fat: null,
      fiber: null,
      food_items: null,
      id: 'meal-1',
      meal_type: null,
      micros: null,
      name: null,
      notes: null,
      protein: null,
      sensitivities: null,
      source: 'manual',
      time: '2024-01-15T12:00:00Z',
    }
    const result = mapMealRow(row)
    expect(result.id).toBe('meal-1')
    expect(result.calories).toBeUndefined()
    expect(result.food_items).toBeUndefined()
    expect(result.micros).toBeUndefined()
  })

  test('maps a row with all optional fields present', () => {
    const row = {
      calories: 500,
      carbs: 60,
      created_at: '2024-01-15T10:00:00Z',
      fat: 20,
      fiber: 5,
      food_items: [{ name: 'Rice' }],
      id: 'meal-2',
      meal_type: 'lunch',
      micros: { iron: 2 },
      name: 'Lunch',
      notes: 'Good',
      protein: 30,
      sensitivities: ['gluten'],
      source: 'manual',
      time: '2024-01-15T12:00:00Z',
    }
    const result = mapMealRow(row)
    expect(result.calories).toBe(500)
    expect(result.food_items).toEqual([{ name: 'Rice' }])
    expect(result.micros).toEqual({ iron: 2 })
  })
})

describe('mapReportEntryRow', () => {
  test('maps a row with valid confidence and flag', () => {
    const row = {
      confidence: 'measured',
      flag: 'high',
      id: 'entry-1',
      method: 'ELISA',
      metric: 'vitamin_d',
      reference_high: 100,
      reference_low: 30,
      report_id: 'report-1',
      unit: 'ng/mL',
      value: 45,
    }
    const result = mapReportEntryRow(row)
    expect(result.confidence).toBe('measured')
    expect(result.flag).toBe('high')
    expect(result.method).toBe('ELISA')
  })

  test('maps a row with null optional fields', () => {
    const row = {
      confidence: null,
      flag: null,
      id: 'entry-2',
      method: null,
      metric: 'iron',
      reference_high: null,
      reference_low: null,
      report_id: 'report-1',
      unit: 'mg/dL',
      value: 80,
    }
    const result = mapReportEntryRow(row)
    expect(result.confidence).toBeUndefined()
    expect(result.flag).toBeUndefined()
    expect(result.method).toBeUndefined()
  })

  test('returns undefined for invalid confidence/flag values', () => {
    const row = {
      confidence: 'invalid',
      flag: 'invalid',
      id: 'entry-3',
      method: null,
      metric: 'test',
      reference_high: null,
      reference_low: null,
      report_id: 'report-1',
      unit: 'x',
      value: 1,
    }
    const result = mapReportEntryRow(row)
    expect(result.confidence).toBeUndefined()
    expect(result.flag).toBeUndefined()
  })
})
