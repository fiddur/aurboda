import type {
  MergeRoutesResponse,
  MergeRoutesResult,
  Route,
  RouteDetail,
  RouteDetailResponse,
  RouteResponse,
  RoutesResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const fetchRoutes = async (): Promise<Route[]> => {
  const response = await axios.get<RoutesResponse>(`${API_URL}/routes`, { headers: headers() })
  return response.data.data ?? []
}

export const fetchRoute = async (id: string): Promise<RouteDetail | null> => {
  try {
    const response = await axios.get<RouteDetailResponse>(`${API_URL}/routes/${encodeURIComponent(id)}`, {
      headers: headers(),
    })
    return response.data.data ?? null
  } catch (error) {
    if (axios.isAxiosError(error) && error.response?.status === 404) return null
    throw error
  }
}

export const updateRoute = async (id: string, body: { name: string }): Promise<Route> => {
  const response = await axios.patch<RouteResponse>(`${API_URL}/routes/${encodeURIComponent(id)}`, body, {
    headers: headers(),
  })
  return response.data.data!
}

export const deleteRoute = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/routes/${encodeURIComponent(id)}`, { headers: headers() })
}

/** Moves every run of `sourceId` onto `targetId`; the source route is deleted. */
export const mergeRoutes = async (targetId: string, sourceId: string): Promise<MergeRoutesResult> => {
  const response = await axios.post<MergeRoutesResponse>(
    `${API_URL}/routes/${encodeURIComponent(targetId)}/merge`,
    { source_route_id: sourceId },
    { headers: headers() },
  )
  return response.data.data!
}
