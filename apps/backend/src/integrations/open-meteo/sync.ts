/**
 * One sync-state row, `provider = 'weather'`, `data_type = 'hourly'`. Each run assigns every hour
 * of its window the rounded cell of where the user was, asks Open-Meteo for those cells and stores
 * the hours as `time_series` rows with source `open_meteo`. Recent hours are model output that is
 * refined later, so the last 48 hours are fetched again on every run; older hours that are already
 * stored are skipped (unless a full resync), which is also how cells deferred by the per-run cap
 * are picked up by the next run.
 */

import { WEATHER_DEFAULT_SYNC_INTERVAL_MINUTES, type WeatherSyncResult } from '@aurboda/api-spec'
import { addDays, addMinutes, subDays, subHours } from 'date-fns'

import type { TimeSeriesEntry } from '../../db/time-series.ts'
import type { TimeSeriesPoint, UserSettings } from '../../db/types.ts'
import type { HourlyWeather } from './client.ts'

import {
  getAllSyncStates,
  getSyncState,
  getTimeSeriesEntriesMultiMetric,
  insertTimeSeries,
  resetSyncState,
  upsertSyncState,
} from '../../db/index.ts'
import { auditError, auditInfo } from '../../services/audit-log.ts'
import { getSettings } from '../../services/settings.ts'
import { withStaleSyncingAsIdle } from '../../services/stale-syncing.ts'
import { locateHours, WEATHER_SOURCE } from '../../services/weather.ts'
import { fetchHourlyWeather } from './client.ts'
import { type WeatherCell, type WeatherRequest, hourStarts, planWeatherRequests } from './hours.ts'

export const WEATHER_PROVIDER = 'weather'
export const WEATHER_DATA_TYPE = 'hourly'
export const WEATHER_HISTORY_DAYS = 90
export const WEATHER_REFRESH_HOURS = 48
/** The longest window one `start_date` run fetches; the rest is fetched by running again from its end. */
export const WEATHER_MAX_WINDOW_DAYS = 366
export const WEATHER_DEFAULT_INTERVAL_MINUTES = WEATHER_DEFAULT_SYNC_INTERVAL_MINUTES
/** How long the background poll leaves Open-Meteo alone after a failed run. */
export const WEATHER_ERROR_BACKOFF_MINUTES = 60
const INSERT_CHUNK = 2000

const WEATHER_METRICS: { metric: string; pick: (h: HourlyWeather) => number | undefined }[] = [
  { metric: 'weather_code', pick: (h) => h.code },
  { metric: 'weather_temperature', pick: (h) => h.temperature },
  { metric: 'weather_precipitation', pick: (h) => h.precipitation },
  { metric: 'weather_wind_speed', pick: (h) => h.wind_speed },
]

export interface WeatherSyncDeps {
  getSettings: (user: string) => Promise<UserSettings>
  getSyncState: typeof getSyncState
  upsertSyncState: typeof upsertSyncState
  insertTimeSeries: (user: string, points: TimeSeriesPoint[]) => Promise<void>
  getStoredEntries: (user: string, metrics: string[], start: Date, end: Date) => Promise<TimeSeriesEntry[]>
  locateHours: (user: string, hours: readonly Date[]) => Promise<(WeatherCell | null)[]>
  fetchHourly: (request: WeatherRequest) => Promise<HourlyWeather[]>
  auditInfo: typeof auditInfo
  auditError: typeof auditError
  now?: () => Date
}

export const defaultWeatherSyncDeps = (): WeatherSyncDeps => ({
  auditError,
  auditInfo,
  fetchHourly: (request) => fetchHourlyWeather(request),
  getSettings,
  getStoredEntries: getTimeSeriesEntriesMultiMetric,
  getSyncState,
  insertTimeSeries: (user, points) => insertTimeSeries(user, points),
  locateHours: (user, hours) => locateHours(user, hours),
  upsertSyncState,
})

export interface WeatherSyncOptions {
  fullResync?: boolean
  startDate?: Date
}

export const weatherWindowStart = (
  lastSyncTime: Date | undefined,
  now: Date,
  options: WeatherSyncOptions,
): Date => {
  const history = subDays(now, WEATHER_HISTORY_DAYS)
  if (options.startDate) {
    return lastSyncTime || options.startDate < history ? options.startDate : history
  }
  if (options.fullResync || !lastSyncTime) return history
  return subHours(lastSyncTime, WEATHER_REFRESH_HOURS)
}

/** `now`, or for a `start_date` run `WEATHER_MAX_WINDOW_DAYS` after `start` when that is earlier. */
export const weatherWindowEnd = (start: Date, now: Date, options: WeatherSyncOptions): Date => {
  if (!options.startDate) return now
  const cap = addDays(start, WEATHER_MAX_WINDOW_DAYS)
  return cap < now ? cap : now
}

const emptyResult = (): Omit<WeatherSyncResult, 'status'> => ({
  cells: 0,
  cells_deferred: 0,
  hours_stored: 0,
})

const storedHours = async (
  user: string,
  deps: WeatherSyncDeps,
  start: Date,
  end: Date,
): Promise<Set<number>> => {
  const entries = await deps.getStoredEntries(user, ['weather_code', 'weather_temperature'], start, end)
  return new Set(entries.filter((e) => e.source === WEATHER_SOURCE).map((e) => e.time.getTime()))
}

const toPoints = (hours: HourlyWeather[], keep: ReadonlySet<number>): TimeSeriesPoint[] =>
  hours
    .filter((h) => keep.has(h.time.getTime()))
    .flatMap((h) =>
      WEATHER_METRICS.flatMap(({ metric, pick }) => {
        const value = pick(h)
        return value === undefined ? [] : [{ metric, source: 'open_meteo' as const, time: h.time, value }]
      }),
    )

const storePoints = async (user: string, deps: WeatherSyncDeps, points: TimeSeriesPoint[]): Promise<void> => {
  for (let i = 0; i < points.length; i += INSERT_CHUNK) {
    await deps.insertTimeSeries(user, points.slice(i, i + INSERT_CHUNK))
  }
}

const recordFailure = async (
  user: string,
  deps: WeatherSyncDeps,
  now: Date,
  message: string,
): Promise<void> => {
  try {
    await deps.upsertSyncState(user, {
      data_type: WEATHER_DATA_TYPE,
      error_message: message,
      provider: WEATHER_PROVIDER,
      retry_after: addMinutes(now, WEATHER_ERROR_BACKOFF_MINUTES),
      status: 'error',
    })
  } catch (stateError) {
    console.error(`⚠️ Failed to record weather sync error for ${user}:`, stateError)
  }
  void deps.auditError(user, 'sync', 'Weather sync failed', { error: message })
}

export const syncWeather = async (
  user: string,
  deps: WeatherSyncDeps,
  options: WeatherSyncOptions = {},
): Promise<WeatherSyncResult> => {
  const result = emptyResult()
  const settings = await deps.getSettings(user)
  if (settings.weather_enabled !== true) {
    return { ...result, error: 'Weather is not enabled', status: 'skipped' }
  }

  const now = (deps.now ?? (() => new Date()))()
  try {
    const state = await deps.getSyncState(user, WEATHER_PROVIDER, WEATHER_DATA_TYPE)
    const start = weatherWindowStart(state?.last_sync_time, now, options)
    const end = weatherWindowEnd(start, now, options)
    const capped = end < now
    await deps.upsertSyncState(user, {
      data_type: WEATHER_DATA_TYPE,
      provider: WEATHER_PROVIDER,
      status: 'syncing',
      sync_start_date: start,
    })

    const refreshFrom = subHours(now, WEATHER_REFRESH_HOURS).getTime()
    const stored = options.fullResync ? new Set<number>() : await storedHours(user, deps, start, end)
    const hours = hourStarts(start, end).filter((h) => h.getTime() >= refreshFrom || !stored.has(h.getTime()))
    const cells = await deps.locateHours(user, hours)
    const assigned = hours.flatMap((hour, i) => {
      const cell = cells[i]
      return cell ? [{ cell, hour, refresh: stored.has(hour.getTime()) }] : []
    })
    const plan = planWeatherRequests(assigned, now)
    result.cells = plan.cells
    result.cells_deferred = plan.cells_deferred
    if (capped) result.window_end = end.toISOString()

    for (const request of plan.requests) {
      const points = toPoints(await deps.fetchHourly(request), request.hours)
      await storePoints(user, deps, points)
      result.hours_stored += new Set(points.map((p) => p.time.getTime())).size
    }

    await deps.upsertSyncState(user, {
      data_type: WEATHER_DATA_TYPE,
      error_message: undefined,
      ...(plan.cells_deferred_missing === 0 && !capped && { last_sync_time: now }),
      provider: WEATHER_PROVIDER,
      status: 'idle',
    })
    if (result.hours_stored > 0) {
      void deps.auditInfo(user, 'sync', `Weather: ${result.hours_stored} hour(s) stored`, {
        cells: plan.cells,
        cells_deferred: plan.cells_deferred,
      })
    }
    return { ...result, status: 'success' }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    await recordFailure(user, deps, now, message)
    return { ...result, error: message, status: 'error' }
  }
}

export const getWeatherSyncStates = async (user: string) => {
  const states = withStaleSyncingAsIdle(await getAllSyncStates(user, WEATHER_PROVIDER), new Date())
  return states.map((s) => ({
    error_message: s.error_message ?? null,
    last_sync_time: s.last_sync_time?.toISOString() ?? null,
    provider: WEATHER_PROVIDER,
    retry_after: s.retry_after?.toISOString() ?? null,
    status: s.status === 'rate_limited' ? ('error' as const) : (s.status ?? 'idle'),
  }))
}

/** Forgets the last sync time too, so the next run is a first sync: the same as `reset_sync_state` over MCP. */
export const resetWeatherSyncState = (user: string): Promise<void> =>
  resetSyncState(user, WEATHER_PROVIDER, WEATHER_DATA_TYPE)
