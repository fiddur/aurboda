import type {
  GarminSyncResponse,
  GarminSyncStatusResponse,
  OuraSyncResponse,
  OuraSyncStatusResponse,
  StravaSyncResponse,
  StravaSyncStatusResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Check if ActivityWatch has ever pushed data (returns sync states per device)
export const fetchActivityWatchStatus = async (): Promise<{ last_sync_time: string | null }[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    states?: { last_sync_time: string | null }[]
  }>(`${API_URL}/sync/activitywatch/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.states ?? []
}

// Oura OAuth
export const getOuraConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; url: string }>(`${API_URL}/auth/oura/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.url
}

// Trigger Oura sync
export const syncOura = async (fullResync?: boolean): Promise<OuraSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<OuraSyncResponse>(
    `${API_URL}/sync/oura`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchOuraSyncStatus = async (): Promise<OuraSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<OuraSyncStatusResponse>(`${API_URL}/sync/oura/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Garmin Connect auth + sync
export const connectGarmin = async (
  email: string,
  password: string,
): Promise<{ success: boolean; mfa_required?: boolean; error?: string }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/login`,
    { email, password },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const verifyGarminMfa = async (mfaCode: string): Promise<{ success: boolean; error?: string }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/mfa`,
    { mfa_code: mfaCode },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const disconnectGarmin = async (): Promise<{ success: boolean }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const syncGarmin = async (fullResync?: boolean): Promise<GarminSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<GarminSyncResponse>(
    `${API_URL}/sync/garmin`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchGarminSyncStatus = async (): Promise<GarminSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<GarminSyncStatusResponse>(`${API_URL}/sync/garmin/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Strava OAuth + sync
export const getStravaConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; url: string }>(`${API_URL}/auth/strava/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.url
}

export const disconnectStrava = async (): Promise<{ success: boolean }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/strava/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const syncStrava = async (fullResync?: boolean): Promise<StravaSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<StravaSyncResponse>(
    `${API_URL}/sync/strava`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchStravaSyncStatus = async (): Promise<StravaSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<StravaSyncStatusResponse>(`${API_URL}/sync/strava/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}
