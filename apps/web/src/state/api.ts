import axios from 'axios'
import { API_URL } from '../config'
import { auth } from './auth'

// Fetch heart rate data for the specified date range
export const fetchHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const response = await axios.get<[string, number][]>(`${API_URL}/api/heartrate`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.map(([time, rate]) => [new Date(time), rate])
}
