import type { DashboardConfig, DashboardDataResponse, DashboardResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.get<DashboardResponse>(`${API_URL}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

export const saveDashboard = async (dashboard: DashboardConfig): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.put<DashboardResponse>(`${API_URL}/dashboard`, dashboard, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

export const resetDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.post<DashboardResponse>(`${API_URL}/dashboard/reset`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

const periodParams = (period: string | undefined) => (period ? { period } : undefined)

export const fetchDashboardData = async (period?: string): Promise<DashboardDataResponse> => {
  const { token } = auth.value
  const response = await axios.get<DashboardDataResponse>(`${API_URL}/dashboard/data`, {
    headers: { Authorization: `Bearer ${token}` },
    params: periodParams(period),
  })

  return response.data
}

export const fetchSharedDashboardData = async (
  id: string,
  period?: string,
): Promise<DashboardDataResponse> => {
  const { token } = auth.value
  const response = await axios.get<DashboardDataResponse>(
    `${API_URL}/shared-dashboards/${encodeURIComponent(id)}/data`,
    { headers: { Authorization: `Bearer ${token}` }, params: periodParams(period) },
  )

  return response.data
}
