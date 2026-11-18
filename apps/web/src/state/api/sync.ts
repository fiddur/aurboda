import type {
  AuthActionResponse,
  CompleteOAuthBody,
  ConnectGarminPersonalKeyBody,
  GarminLoginResponse,
  OAuthConnectUrlResponse,
  GarminSyncResponse,
  GarminSyncStatusResponse,
  OuraSyncResponse,
  OuraSyncStatusResponse,
  StravaSyncResponse,
  StravaSyncStatusResponse,
  GravlSyncResponse,
  GravlSyncStatusResponse,
  HomeAssistantEntitiesResponse,
  HomeAssistantSyncResponse,
  HomeAssistantSyncStatusResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

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

export const getOuraConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; url: string }>(`${API_URL}/auth/oura/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.url
}

export const disconnectOura = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/oura/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

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

export const connectGarmin = async (email: string, password: string): Promise<GarminLoginResponse> => {
  const { token } = auth.value
  const response = await axios.post<GarminLoginResponse>(
    `${API_URL}/auth/garmin/login`,
    { email, password },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const verifyGarminMfa = async (mfaCode: string): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/garmin/mfa`,
    { mfa_code: mfaCode },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const disconnectGarmin = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/garmin/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const connectGarminPersonalKey = async (
  apiKey: string,
  expiresAt: string,
): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const body: ConnectGarminPersonalKeyBody = { api_key: apiKey, expires_at: expiresAt }
  const response = await axios.post<AuthActionResponse>(`${API_URL}/auth/garmin/personal-key`, body, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  })
  return response.data
}

export const disconnectGarminPersonalKey = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/garmin/personal-key/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const getGarminOAuthConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<OAuthConnectUrlResponse>(`${API_URL}/auth/garmin/oauth/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.data.url) throw new Error(response.data.error ?? 'Garmin sign-in is not available')
  return response.data.url
}

export type OAuthProvider = 'garmin' | 'gravl' | 'oura' | 'strava'

const OAUTH_COMPLETE_PATHS: Record<OAuthProvider, string> = {
  garmin: '/auth/garmin/oauth/complete',
  gravl: '/auth/gravl/complete',
  oura: '/auth/oura/complete',
  strava: '/auth/strava/complete',
}

/** Finishes a sign-in the provider's callback handed to the page, as the signed-in user. */
export const completeOAuth = async (
  provider: OAuthProvider,
  code: string,
  state: string,
): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const body: CompleteOAuthBody = { code, state }
  const response = await axios.post<AuthActionResponse>(`${API_URL}${OAUTH_COMPLETE_PATHS[provider]}`, body, {
    headers: { Authorization: `Bearer ${token}` },
    validateStatus: () => true,
  })
  return response.data
}

export const disconnectGarminOAuth = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/garmin/oauth/disconnect`,
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

export const getStravaConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; url: string }>(`${API_URL}/auth/strava/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.url
}

export const disconnectStrava = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
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

export const getGravlConnectUrl = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; url: string }>(`${API_URL}/auth/gravl/connect`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.url
}

export const disconnectGravl = async (): Promise<AuthActionResponse> => {
  const { token } = auth.value
  const response = await axios.post<AuthActionResponse>(
    `${API_URL}/auth/gravl/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const syncGravl = async (fullResync?: boolean): Promise<GravlSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<GravlSyncResponse>(
    `${API_URL}/sync/gravl`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchGravlSyncStatus = async (): Promise<GravlSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<GravlSyncStatusResponse>(`${API_URL}/sync/gravl/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const syncHomeAssistant = async (fullResync?: boolean): Promise<HomeAssistantSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<HomeAssistantSyncResponse>(
    `${API_URL}/sync/home-assistant`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchHomeAssistantSyncStatus = async (): Promise<HomeAssistantSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<HomeAssistantSyncStatusResponse>(`${API_URL}/sync/home-assistant/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const fetchHomeAssistantEntities = async (): Promise<HomeAssistantEntitiesResponse> => {
  const { token } = auth.value
  const response = await axios.get<HomeAssistantEntitiesResponse>(`${API_URL}/home-assistant/entities`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}
