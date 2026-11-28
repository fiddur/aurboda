import { describe, expect, test, vi } from 'vitest'

import type { TimeSeriesEntry } from '../../db/time-series.ts'
import type { SyncState, TimeSeriesPoint } from '../../db/types.ts'
import type { HourlyWeather } from './client.ts'
import type { WeatherCell, WeatherRequest } from './hours.ts'

import { syncWeather, type WeatherSyncDeps, weatherWindowEnd, weatherWindowStart } from './sync.ts'

const now = new Date('2026-11-28T12:30:00Z')
const stockholm: WeatherCell = { lat: 59.3, lon: 18.1 }

const syncState = (lastSyncTime: Date): SyncState => ({
  data_type: 'hourly',
  last_sync_time: lastSyncTime,
  provider: 'weather',
  status: 'idle',
})

const hourlyFor = (request: WeatherRequest): HourlyWeather[] =>
  [...request.hours].map((t) => ({
    code: 3,
    precipitation: 0,
    temperature: 4,
    time: new Date(t),
    wind_speed: 2,
  }))

const makeDeps = (overrides: Partial<WeatherSyncDeps> = {}) => {
  const inserted: TimeSeriesPoint[] = []
  const states: SyncState[] = []
  const deps: WeatherSyncDeps = {
    auditError: vi.fn(),
    auditInfo: vi.fn(),
    fetchHourly: vi.fn(async (request: WeatherRequest) => hourlyFor(request)),
    getSettings: async () => ({ weather_enabled: true }),
    getStoredEntries: async () => [],
    getSyncState: async () => null,
    insertTimeSeries: async (_user, points) => {
      inserted.push(...points)
    },
    locateHours: async (_user, hours) => hours.map(() => stockholm),
    now: () => now,
    upsertSyncState: async (_user, state) => {
      states.push(state)
    },
    ...overrides,
  }
  return { deps, inserted, states }
}

describe('weatherWindowStart', () => {
  test('the first sync covers the last 90 days', () => {
    expect(weatherWindowStart(undefined, now, {})).toEqual(new Date('2026-08-30T12:30:00Z'))
  })

  test('a later sync starts 48 hours before the last one', () => {
    expect(weatherWindowStart(new Date('2026-11-28T09:00:00Z'), now, {})).toEqual(
      new Date('2026-11-26T09:00:00Z'),
    )
  })

  test('a full resync goes back 90 days again', () => {
    expect(weatherWindowStart(new Date('2026-11-28T09:00:00Z'), now, { fullResync: true })).toEqual(
      new Date('2026-08-30T12:30:00Z'),
    )
  })

  test('start_date reaches any date', () => {
    const startDate = new Date('2024-01-01T00:00:00Z')
    expect(weatherWindowStart(new Date('2026-11-28T09:00:00Z'), now, { startDate })).toEqual(startDate)
  })

  test('a recent start_date after an earlier sync starts there', () => {
    const startDate = new Date('2026-11-20T00:00:00Z')
    expect(weatherWindowStart(new Date('2026-11-28T09:00:00Z'), now, { startDate })).toEqual(startDate)
  })

  test('a first sync with a recent start_date still covers the last 90 days', () => {
    const startDate = new Date('2026-11-20T00:00:00Z')
    expect(weatherWindowStart(undefined, now, { startDate })).toEqual(new Date('2026-08-30T12:30:00Z'))
  })

  test('a first sync with an older start_date starts there', () => {
    const startDate = new Date('2026-01-01T00:00:00Z')
    expect(weatherWindowStart(undefined, now, { startDate })).toEqual(startDate)
  })
})

describe('weatherWindowEnd', () => {
  test('is now without a start_date', () => {
    expect(weatherWindowEnd(new Date('2020-01-01T00:00:00Z'), now, {})).toEqual(now)
  })

  test('caps a start_date run at 366 days', () => {
    const startDate = new Date('2024-01-01T00:00:00Z')
    expect(weatherWindowEnd(startDate, now, { startDate })).toEqual(new Date('2025-01-01T00:00:00Z'))
  })

  test('is now when start_date is less than 366 days back', () => {
    const startDate = new Date('2026-01-01T00:00:00Z')
    expect(weatherWindowEnd(startDate, now, { startDate })).toEqual(now)
  })
})

describe('syncWeather', () => {
  test('does nothing while weather is not enabled', async () => {
    const { deps, states } = makeDeps({ getSettings: async () => ({}) })
    const result = await syncWeather('alice', deps)
    expect(result).toMatchObject({ hours_stored: 0, status: 'skipped' })
    expect(states).toEqual([])
    expect(deps.fetchHourly).not.toHaveBeenCalled()
  })

  test('stores every located hour of the window as four open_meteo metrics', async () => {
    const lastSync = new Date('2026-11-28T09:00:00Z')
    const { deps, inserted, states } = makeDeps({
      getSyncState: async () => syncState(lastSync),
    })
    const result = await syncWeather('alice', deps)

    expect(result).toEqual({ cells: 1, cells_deferred: 0, hours_stored: 52, status: 'success' })
    expect(new Set(inserted.map((p) => p.metric))).toEqual(
      new Set(['weather_code', 'weather_temperature', 'weather_precipitation', 'weather_wind_speed']),
    )
    expect(inserted.every((p) => p.source === 'open_meteo')).toBe(true)
    expect(states.at(-1)).toMatchObject({ last_sync_time: now, status: 'idle' })
  })

  test('skips stored hours older than 48 hours, but fetches recent ones again', async () => {
    const stored: TimeSeriesEntry[] = [
      {
        metric: 'weather_code',
        source: 'open_meteo',
        time: new Date('2026-11-25T00:00:00Z'),
        unit: 'wmo',
        value: 3,
      },
      {
        metric: 'weather_code',
        source: 'open_meteo',
        time: new Date('2026-11-28T10:00:00Z'),
        unit: 'wmo',
        value: 3,
      },
    ]
    const located: Date[] = []
    const { deps } = makeDeps({
      getStoredEntries: async () => stored,
      getSyncState: async () => syncState(new Date('2026-11-27T00:00:00Z')),
      locateHours: async (_user, hours) => {
        located.push(...hours)
        return hours.map(() => stockholm)
      },
    })
    await syncWeather('alice', deps)
    const isoHours = located.map((h) => h.toISOString())
    expect(isoHours).not.toContain('2026-11-25T00:00:00.000Z')
    expect(isoHours).toContain('2026-11-28T10:00:00.000Z')
  })

  test('hours without a location get no weather', async () => {
    const { deps, inserted } = makeDeps({ locateHours: async (_user, hours) => hours.map(() => null) })
    const result = await syncWeather('alice', deps)
    expect(result).toMatchObject({ cells: 0, hours_stored: 0, status: 'success' })
    expect(inserted).toEqual([])
    expect(deps.fetchHourly).not.toHaveBeenCalled()
  })

  test('with cells deferred the last sync time stays, so the next run picks them up', async () => {
    const { deps, states } = makeDeps({
      locateHours: async (_user, hours) => hours.map((_, i) => ({ lat: 40 + (i % 25) / 10, lon: 10 })),
    })
    const result = await syncWeather('alice', deps)
    expect(result).toMatchObject({ cells: 20, cells_deferred: 5, status: 'success' })
    expect(states.at(-1)).toMatchObject({ status: 'idle' })
    expect(states.at(-1)?.last_sync_time).toBeUndefined()
  })

  test('cells deferred only for a refresh do not hold the last sync time back', async () => {
    const lastSync = new Date('2026-11-28T09:00:00Z')
    const refreshHours = new Set(
      Array.from({ length: 30 }, (_, i) => new Date('2026-11-26T10:00:00Z').getTime() + i * 3_600_000),
    )
    const stored: TimeSeriesEntry[] = [...refreshHours].map((t) => ({
      metric: 'weather_code',
      source: 'open_meteo',
      time: new Date(t),
      unit: 'wmo',
      value: 3,
    }))
    const { deps, states } = makeDeps({
      getStoredEntries: async () => stored,
      getSyncState: async () => syncState(lastSync),
      locateHours: async (_user, hours) =>
        hours.map((h, i) => (refreshHours.has(h.getTime()) ? { lat: 40 + i / 10, lon: 10 } : stockholm)),
    })
    const result = await syncWeather('alice', deps)
    expect(result.cells_deferred).toBeGreaterThan(0)
    expect(states.at(-1)).toMatchObject({ last_sync_time: now, status: 'idle' })
  })

  test('a start_date run longer than 366 days stops there, says so and keeps the last sync time', async () => {
    const located: Date[] = []
    const { deps, states } = makeDeps({
      getSyncState: async () => syncState(new Date('2026-11-28T09:00:00Z')),
      locateHours: async (_user, hours) => {
        located.push(...hours)
        return hours.map(() => stockholm)
      },
    })
    const result = await syncWeather('alice', deps, { startDate: new Date('2024-01-01T00:00:00Z') })
    expect(result).toMatchObject({ status: 'success', window_end: '2025-01-01T00:00:00.000Z' })
    expect(located.at(-1)).toEqual(new Date('2025-01-01T00:00:00Z'))
    expect(states.at(-1)?.last_sync_time).toBeUndefined()
  })

  test('a failure records an error with a retry time and keeps what was stored', async () => {
    const { deps, states } = makeDeps({
      fetchHourly: vi.fn(async () => {
        throw new Error('Open-Meteo answered 429')
      }),
    })
    const result = await syncWeather('alice', deps)
    expect(result).toMatchObject({ error: 'Open-Meteo answered 429', status: 'error' })
    expect(states.at(-1)).toMatchObject({
      error_message: 'Open-Meteo answered 429',
      retry_after: new Date('2026-11-28T13:30:00Z'),
      status: 'error',
    })
    expect(deps.auditError).toHaveBeenCalled()
  })
})
