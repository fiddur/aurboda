import type {
  CreateSharedDashboardBody,
  PublicProfileResponse,
  PublicSharedDashboardResponse,
  SharedDashboard,
  SharedDashboardResponse,
  SharedDashboardsResponse,
  UpdateSharedDashboardBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

// ===========================================================================
// Owner-facing CRUD (authenticated)
// ===========================================================================

export const listSharedDashboards = async (): Promise<SharedDashboard[]> => {
  const response = await axios.get<SharedDashboardsResponse>(`${API_URL}/shared-dashboards`, {
    headers: authHeaders(),
  })
  return response.data.dashboards
}

export const createSharedDashboard = async (body: CreateSharedDashboardBody): Promise<SharedDashboard> => {
  const response = await axios.post<SharedDashboardResponse>(`${API_URL}/shared-dashboards`, body, {
    headers: authHeaders(),
  })
  if (!response.data.dashboard) throw new Error(response.data.error ?? 'Failed to create shared dashboard')
  return response.data.dashboard
}

export const updateSharedDashboard = async (
  id: string,
  body: UpdateSharedDashboardBody,
): Promise<SharedDashboard> => {
  const response = await axios.put<SharedDashboardResponse>(`${API_URL}/shared-dashboards/${id}`, body, {
    headers: authHeaders(),
  })
  if (!response.data.dashboard) throw new Error(response.data.error ?? 'Failed to update shared dashboard')
  return response.data.dashboard
}

export const deleteSharedDashboard = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/shared-dashboards/${id}`, { headers: authHeaders() })
}

// ===========================================================================
// Public viewing (unauthenticated — no Authorization header)
// ===========================================================================

export const fetchPublicProfile = async (username: string): Promise<PublicProfileResponse> => {
  const response = await axios.get<PublicProfileResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/dashboards`,
  )
  return response.data
}

export const fetchPublicSharedDashboard = async (
  username: string,
  slug: string,
): Promise<PublicSharedDashboardResponse> => {
  const response = await axios.get<PublicSharedDashboardResponse>(
    `${API_URL}/public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`,
  )
  return response.data
}
