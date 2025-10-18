import axios from 'axios'
import { auth } from './auth'

// Fetch heart rate data for the specified date range
export const fetchHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const response = await axios.get<[string, number][]>('http://valhall/api/v2/heartrate', {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      start: start.toISOString(),
      end: end.toISOString(),
    },
  })

  return response.data.map(([time, rate]) => [new Date(time), rate])
}
