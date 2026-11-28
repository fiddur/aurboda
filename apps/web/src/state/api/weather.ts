import type { WeatherQuery, WeatherResponse, WeatherSummary } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

/** The weather of a span (`start`, `end`) or a day (`date`); its summary is null when no hour has weather. */
export const fetchWeather = async (
  query: { start: Date; end: Date } | { date: string; tz?: string },
): Promise<WeatherSummary | null> => {
  const { token } = auth.value
  const params: WeatherQuery =
    'date' in query
      ? { date: query.date, ...(query.tz ? { tz: query.tz } : {}) }
      : { end: query.end.toISOString(), start: query.start.toISOString() }
  const response = await axios.get<WeatherResponse>(`${API_URL}/weather`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return response.data.summary ?? null
}
