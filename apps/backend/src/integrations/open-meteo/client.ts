/**
 * Open-Meteo hourly weather, no API key. Free for non-commercial use with attribution
 * (https://open-meteo.com/en/terms). Every request carries a cell's rounded coordinates only.
 */

import { z } from 'zod'

import type { WeatherRequest } from './hours.ts'

import { offUserAgent } from '../../services/imports/openfoodfacts.ts'
import { safeFetchGet } from '../../services/safe-fetch.ts'

export const OPEN_METEO_FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'
export const OPEN_METEO_ARCHIVE_URL = 'https://archive-api.open-meteo.com/v1/archive'
const OPEN_METEO_TIMEOUT_MS = 20_000
const HOURLY_VARIABLES = 'weather_code,temperature_2m,precipitation,wind_speed_10m'

export interface HourlyWeather {
  time: Date
  code?: number
  temperature?: number
  precipitation?: number
  wind_speed?: number
}

const series = z.array(z.number().nullable())

const responseSchema = z.object({
  hourly: z.object({
    precipitation: series,
    temperature_2m: series,
    time: z.array(z.string()),
    weather_code: series,
    wind_speed_10m: series,
  }),
})

export interface OpenMeteoDeps {
  get?: typeof safeFetchGet
  forecastUrl?: string
  archiveUrl?: string
  userAgent?: string
}

export const openMeteoUrl = (request: WeatherRequest, deps: OpenMeteoDeps = {}): string => {
  const base =
    request.api === 'archive'
      ? (deps.archiveUrl ?? OPEN_METEO_ARCHIVE_URL)
      : (deps.forecastUrl ?? OPEN_METEO_FORECAST_URL)
  const params = new URLSearchParams({
    end_date: request.end_date,
    hourly: HOURLY_VARIABLES,
    latitude: request.cell.lat.toFixed(1),
    longitude: request.cell.lon.toFixed(1),
    start_date: request.start_date,
    timezone: 'UTC',
    wind_speed_unit: 'ms',
  })
  return `${base}?${params.toString()}`
}

const valueAt = (values: (number | null)[], i: number): number | undefined => values[i] ?? undefined

/** The hours of the answer that carry at least one value; nulls are skipped. Throws on an unexpected shape. */
export const fetchHourlyWeather = async (
  request: WeatherRequest,
  deps: OpenMeteoDeps = {},
): Promise<HourlyWeather[]> => {
  const get = deps.get ?? safeFetchGet
  const res = await get(openMeteoUrl(request, deps), {
    headers: { Accept: 'application/json', 'User-Agent': deps.userAgent ?? offUserAgent() },
    timeout: OPEN_METEO_TIMEOUT_MS,
  })
  const parsed = responseSchema.safeParse(res.data)
  if (!parsed.success) throw new Error('Open-Meteo answered with an unexpected shape')
  const { hourly } = parsed.data
  return hourly.time.flatMap((time, i) => {
    const hour: HourlyWeather = {
      code: valueAt(hourly.weather_code, i),
      precipitation: valueAt(hourly.precipitation, i),
      temperature: valueAt(hourly.temperature_2m, i),
      time: new Date(`${time}Z`),
      wind_speed: valueAt(hourly.wind_speed_10m, i),
    }
    const hasValue = [hour.code, hour.precipitation, hour.temperature, hour.wind_speed].some(
      (v) => v !== undefined,
    )
    return hasValue && !Number.isNaN(hour.time.getTime()) ? [hour] : []
  })
}
