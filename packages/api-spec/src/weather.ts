import type { MetricType } from './schemas/common.ts'

/** The hourly metrics the weather source stores, all with source `open_meteo`. */
export const weatherMetrics = [
  'weather_code',
  'weather_temperature',
  'weather_precipitation',
  'weather_wind_speed',
] as const satisfies readonly MetricType[]

export const WEATHER_DEFAULT_SYNC_INTERVAL_MINUTES = 180

export type WeatherMetric = (typeof weatherMetrics)[number]

export interface WeatherCondition {
  condition: string
  emoji: string
}

/** WMO weather interpretation codes, as Open-Meteo documents them. */
export const wmoWeatherConditions: Readonly<Record<number, WeatherCondition>> = {
  0: { condition: 'Clear sky', emoji: '☀️' },
  1: { condition: 'Mainly clear', emoji: '🌤️' },
  2: { condition: 'Partly cloudy', emoji: '⛅' },
  3: { condition: 'Overcast', emoji: '☁️' },
  45: { condition: 'Fog', emoji: '🌫️' },
  48: { condition: 'Depositing rime fog', emoji: '🌫️' },
  51: { condition: 'Light drizzle', emoji: '🌦️' },
  53: { condition: 'Moderate drizzle', emoji: '🌦️' },
  55: { condition: 'Dense drizzle', emoji: '🌧️' },
  56: { condition: 'Light freezing drizzle', emoji: '🌧️' },
  57: { condition: 'Dense freezing drizzle', emoji: '🌧️' },
  61: { condition: 'Slight rain', emoji: '🌦️' },
  63: { condition: 'Moderate rain', emoji: '🌧️' },
  65: { condition: 'Heavy rain', emoji: '🌧️' },
  66: { condition: 'Light freezing rain', emoji: '🌧️' },
  67: { condition: 'Heavy freezing rain', emoji: '🌧️' },
  71: { condition: 'Slight snowfall', emoji: '🌨️' },
  73: { condition: 'Moderate snowfall', emoji: '🌨️' },
  75: { condition: 'Heavy snowfall', emoji: '❄️' },
  77: { condition: 'Snow grains', emoji: '🌨️' },
  80: { condition: 'Slight rain showers', emoji: '🌦️' },
  81: { condition: 'Moderate rain showers', emoji: '🌧️' },
  82: { condition: 'Violent rain showers', emoji: '⛈️' },
  85: { condition: 'Slight snow showers', emoji: '🌨️' },
  86: { condition: 'Heavy snow showers', emoji: '❄️' },
  95: { condition: 'Thunderstorm', emoji: '⛈️' },
  96: { condition: 'Thunderstorm with slight hail', emoji: '⛈️' },
  99: { condition: 'Thunderstorm with heavy hail', emoji: '⛈️' },
}

export const unknownWeatherCondition: WeatherCondition = { condition: 'Unknown', emoji: '🌡️' }

export const weatherCondition = (code: number): WeatherCondition =>
  wmoWeatherConditions[code] ?? unknownWeatherCondition

/** WMO codes from 51 up are drizzle, rain, snow, showers or thunderstorms. */
export const isPrecipitatingWeatherCode = (code: number): boolean => code >= 51

const wholeDegrees = (value: number): number => Math.round(value) + 0

/** Whole degrees, "4–6 °C", or one value ("5 °C") when the lowest and highest round alike; undefined without both. */
export const weatherTemperatureText = (min: number | null, max: number | null): string | undefined => {
  if (min === null || max === null) return undefined
  const low = wholeDegrees(min)
  const high = wholeDegrees(max)
  return low === high ? `${low} °C` : `${low}–${high} °C`
}
