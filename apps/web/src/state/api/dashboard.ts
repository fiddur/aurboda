import type { DashboardConfig, DashboardResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch user's dashboard configuration
export const fetchDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.get<DashboardResponse>(`${API_URL}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

// Save dashboard configuration
export const saveDashboard = async (dashboard: DashboardConfig): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.put<DashboardResponse>(`${API_URL}/dashboard`, dashboard, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

// Reset dashboard to default configuration
export const resetDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.post<DashboardResponse>(`${API_URL}/dashboard/reset`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}
