import { useQuery } from '@tanstack/react-query'

import { fetchWeather } from '../../state/api'
import { weatherLine } from './weatherLine'

const WEATHER_STALE_TIME_MS = 5 * 60_000

/** The weather during `start`..`end`; nothing at all when there is none or it cannot be read. */
export const WeatherStatRow = ({ start, end }: { start: Date; end: Date }) => {
  const { data } = useQuery({
    queryFn: () => fetchWeather({ end, start }),
    queryKey: ['entity-weather', start.toISOString(), end.toISOString()],
    retry: false,
    staleTime: WEATHER_STALE_TIME_MS,
  })
  const line = data ? weatherLine(data) : ''
  if (!line) return null
  return (
    <tr>
      <th scope="row">Weather</th>
      <td>{line}</td>
    </tr>
  )
}
