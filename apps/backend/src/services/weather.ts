import {
  isPrecipitatingWeatherCode,
  unknownWeatherCondition,
  type Weather,
  weatherCondition,
  type WeatherHour,
  weatherMetrics,
  type WeatherQuery,
  weatherQuerySchema,
  type WeatherSummary,
} from '@aurboda/api-spec'

import type { TimeSeriesEntry } from '../db/time-series.ts'

import { getTimeSeriesEntriesMultiMetric } from '../db/index.ts'
import {
  cellKey,
  type Fix,
  floorHour,
  HOUR_MS,
  hourCells,
  MAX_FIX_CARRY_MS,
  type WeatherCell,
} from '../integrations/open-meteo/hours.ts'
import { dayEndInTz, dayStartInTz } from './day-keys.ts'
import { getLastFixBefore, getLocationPoints } from './locations.ts'
import { getUserTimezone } from './settings.ts'

export const WEATHER_SOURCE = 'open_meteo'

const DAY_MS = 24 * HOUR_MS
/** The local hours a day's condition is judged on, when any of them has a code. */
const DAYTIME_FIRST_HOUR = 7
const DAYTIME_LAST_HOUR = 21

export interface LocateHoursDeps {
  getLocationPoints: (user: string, start: Date, end: Date) => Promise<Fix[]>
  getLastFixBefore: (user: string, before: Date, notBefore: Date) => Promise<Fix | undefined>
}

const defaultLocateHoursDeps: LocateHoursDeps = { getLastFixBefore, getLocationPoints }

/**
 * `hourCells` over the user's location history, read a day at a time so a long window never
 * holds more than a day of fixes. `hours` ascending.
 */
export const locateHours = async (
  user: string,
  hours: readonly Date[],
  deps: LocateHoursDeps = defaultLocateHoursDeps,
): Promise<(WeatherCell | null)[]> => {
  if (hours.length === 0) return []
  const middle = (hour: Date): number => hour.getTime() + HOUR_MS / 2
  const firstMiddle = middle(hours[0])
  let carry = await deps.getLastFixBefore(
    user,
    new Date(firstMiddle),
    new Date(firstMiddle - MAX_FIX_CARRY_MS),
  )
  const cells: (WeatherCell | null)[] = []
  let index = 0
  while (index < hours.length) {
    const chunkStart = middle(hours[index])
    const chunkEnd = chunkStart + DAY_MS
    const chunkHours: Date[] = []
    while (index < hours.length && middle(hours[index]) < chunkEnd) chunkHours.push(hours[index++])
    const points = await deps.getLocationPoints(
      user,
      new Date(chunkStart),
      new Date(middle(chunkHours[chunkHours.length - 1])),
    )
    cells.push(...hourCells(carry ? [carry, ...points] : points, chunkHours))
    carry = points.at(-1) ?? carry
  }
  return cells
}

/**
 * Among the hours with a code: the most frequent precipitating code when at least a quarter of
 * them precipitate, else the most frequent code; a tie goes to the higher code.
 */
export const summaryWeatherCode = (codes: readonly number[]): number | null => {
  if (codes.length === 0) return null
  const precipitating = codes.filter(isPrecipitatingWeatherCode)
  const pool = precipitating.length > 0 && precipitating.length * 4 >= codes.length ? precipitating : codes
  const counts = new Map<number, number>()
  for (const code of pool) counts.set(code, (counts.get(code) ?? 0) + 1)
  return [...counts.entries()].reduce((best, entry) =>
    entry[1] > best[1] || (entry[1] === best[1] && entry[0] > best[0]) ? entry : best,
  )[0]
}

const values = (hours: readonly WeatherHour[], pick: (h: WeatherHour) => number | null): number[] =>
  hours.map(pick).filter((v): v is number => v !== null)

const roundTenth = (value: number): number => Math.round(value * 10) / 10

/** Null without hours. Temperatures, precipitation and wind use `hours`; the condition `conditionHours`. */
export const summariseWeather = (
  hours: readonly WeatherHour[],
  conditionHours: readonly WeatherHour[] = hours,
): WeatherSummary | null => {
  if (hours.length === 0) return null
  const code = summaryWeatherCode(values(conditionHours, (h) => h.code))
  const temperatures = values(hours, (h) => h.temperature)
  const precipitation = values(hours, (h) => h.precipitation)
  const wind = values(hours, (h) => h.wind_speed)
  const { condition, emoji } = code === null ? unknownWeatherCondition : weatherCondition(code)
  return {
    code,
    condition,
    emoji,
    hours: hours.length,
    precipitation_sum:
      precipitation.length > 0 ? roundTenth(precipitation.reduce((sum, v) => sum + v, 0)) : null,
    temperature_avg:
      temperatures.length > 0
        ? roundTenth(temperatures.reduce((sum, v) => sum + v, 0) / temperatures.length)
        : null,
    temperature_max: temperatures.length > 0 ? Math.max(...temperatures) : null,
    temperature_min: temperatures.length > 0 ? Math.min(...temperatures) : null,
    wind_speed_max: wind.length > 0 ? Math.max(...wind) : null,
  }
}

const METRIC_FIELDS: Record<string, keyof Omit<WeatherHour, 'time'>> = {
  weather_code: 'code',
  weather_precipitation: 'precipitation',
  weather_temperature: 'temperature',
  weather_wind_speed: 'wind_speed',
}

/** One `WeatherHour` per stored hour that overlaps `start`..`end`, ascending. */
export const weatherHours = (entries: readonly TimeSeriesEntry[], start: Date, end: Date): WeatherHour[] => {
  const overlaps = (t: number): boolean =>
    t + HOUR_MS > start.getTime() && (t < end.getTime() || t <= start.getTime())
  const byTime = new Map<number, WeatherHour>()
  for (const entry of entries) {
    const field = METRIC_FIELDS[entry.metric]
    const t = entry.time.getTime()
    if (entry.source !== WEATHER_SOURCE || !field || !overlaps(t)) continue
    const hour = byTime.get(t) ?? {
      code: null,
      precipitation: null,
      temperature: null,
      time: entry.time.toISOString(),
      wind_speed: null,
    }
    hour[field] = entry.value
    byTime.set(t, hour)
  }
  return [...byTime.entries()].sort(([a], [b]) => a - b).map(([, hour]) => hour)
}

const localHour = (time: string, tz: string): number =>
  Number(
    new Intl.DateTimeFormat('en-GB', { hour: '2-digit', hourCycle: 'h23', timeZone: tz }).format(
      new Date(time),
    ),
  )

/** The cell with the most of the hours, ties to the one seen first; null when no hour has one. */
export const dominantCell = (cells: readonly (WeatherCell | null)[]): string | null => {
  const counts = new Map<string, number>()
  for (const cell of cells) if (cell) counts.set(cellKey(cell), (counts.get(cellKey(cell)) ?? 0) + 1)
  let best: [string, number] | null = null
  for (const entry of counts) if (!best || entry[1] > best[1]) best = entry
  return best?.[0] ?? null
}

/**
 * A day's summary follows where most of the day was spent: only the dominant cell's hours count
 * (all of them when no cell can be told), and its condition the daytime hours when any has a code.
 */
export const summariseDay = (
  hours: readonly WeatherHour[],
  cells: readonly (WeatherCell | null)[],
  tz: string,
): WeatherSummary | null => {
  const dominant = dominantCell(cells)
  const dayHours =
    dominant === null ? hours : hours.filter((_, i) => cells[i] && cellKey(cells[i]) === dominant)
  const daytime = dayHours.filter((h) => {
    const hour = localHour(h.time, tz)
    return h.code !== null && hour >= DAYTIME_FIRST_HOUR && hour <= DAYTIME_LAST_HOUR
  })
  return summariseWeather(dayHours, daytime.length > 0 ? daytime : dayHours)
}

export interface WeatherDeps {
  getEntries: (user: string, metrics: string[], start: Date, end: Date) => Promise<TimeSeriesEntry[]>
  locateHours: (user: string, hours: readonly Date[]) => Promise<(WeatherCell | null)[]>
  getUserTimezone: (user: string) => Promise<string>
}

export const defaultWeatherDeps = (): WeatherDeps => ({
  getEntries: (user, metrics, start, end) => getTimeSeriesEntriesMultiMetric(user, metrics, start, end),
  getUserTimezone: (user) => getUserTimezone(user),
  locateHours: (user, hours) => locateHours(user, hours),
})

export type WeatherResult = { ok: true; weather: Weather; tz?: string } | { ok: false; error: string }

export const getWeather = async (
  user: string,
  query: WeatherQuery,
  deps: WeatherDeps = defaultWeatherDeps(),
): Promise<WeatherResult> => {
  const parsed = weatherQuerySchema.safeParse(query)
  if (!parsed.success) return { error: parsed.error.issues.map((i) => i.message).join('; '), ok: false }
  const { date, end, start, tz } = parsed.data

  if (start && end) {
    const spanStart = new Date(start)
    const spanEnd = new Date(end)
    const entries = await deps.getEntries(user, [...weatherMetrics], floorHour(spanStart), spanEnd)
    const hours = weatherHours(entries, spanStart, spanEnd)
    return { ok: true, tz, weather: { hours, summary: summariseWeather(hours) } }
  }
  if (!date) return { error: 'Give either date, or start and end', ok: false }

  const zone = tz ?? (await deps.getUserTimezone(user))
  const dayStart = dayStartInTz(date, zone)
  const dayEnd = dayEndInTz(date, zone)
  const entries = await deps.getEntries(user, [...weatherMetrics], floorHour(dayStart), dayEnd)
  const hours = weatherHours(entries, dayStart, dayEnd)
  const cells = await deps.locateHours(
    user,
    hours.map((h) => new Date(h.time)),
  )
  return { ok: true, tz: zone, weather: { hours, summary: summariseDay(hours, cells, zone) } }
}
