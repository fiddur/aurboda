import { weatherQuerySchema } from '@aurboda/api-spec'

import { defaultWeatherDeps, getWeather, type WeatherDeps } from '../services/weather.ts'
import { errorResponse, jsonResponse, type McpServer, tzJsonResponse } from './helpers.ts'

export const registerWeatherTools = (
  server: McpServer,
  user: string,
  deps: WeatherDeps = defaultWeatherDeps(),
) => {
  server.tool(
    'get_weather',
    "The stored hourly weather where you were (WMO code, temperature °C, precipitation mm, wind speed m/s), for a calendar day (date, with tz) or a span (start and end: every hour that overlaps it), with a summary: condition, emoji, temperature avg/min/max, precipitation sum, max wind. A day's summary follows the rounded location where most of its hours were spent, and its condition the hours 07:00–21:59. Needs weather_enabled and a weather sync; the same as GET /weather.",
    { ...weatherQuerySchema.shape },
    async (query) => {
      const result = await getWeather(user, query, deps)
      if (!result.ok) return errorResponse(result.error)
      const body = { ...result.weather, success: true }
      return result.tz ? tzJsonResponse(body, result.tz) : jsonResponse(body)
    },
  )
}
