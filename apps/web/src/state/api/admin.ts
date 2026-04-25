import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

export type SignupMode = 'open' | 'invite_only' | 'closed'

export interface AdminSettings {
  signup_mode: SignupMode
  admin_count: number
  lastfm_api_key_set: boolean
  oura_client_id_set: boolean
  oura_client_secret_set: boolean
  oura_webhook_available: boolean
  oura_webhook_enabled: boolean
  strava_client_id_set: boolean
  strava_client_secret_set: boolean
}

export interface InvitationResult {
  token: string
  url: string
  expires_at: Date
}

// Fetch admin settings
export const fetchAdminSettings = async (): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean } & AdminSettings>(`${API_URL}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return {
    admin_count: response.data.admin_count,
    lastfm_api_key_set: response.data.lastfm_api_key_set,
    oura_client_id_set: response.data.oura_client_id_set,
    oura_client_secret_set: response.data.oura_client_secret_set,
    oura_webhook_available: response.data.oura_webhook_available,
    oura_webhook_enabled: response.data.oura_webhook_enabled,
    signup_mode: response.data.signup_mode,
    strava_client_id_set: response.data.strava_client_id_set,
    strava_client_secret_set: response.data.strava_client_secret_set,
  }
}

// Update admin settings
export const updateAdminSettings = async (params: {
  signup_mode?: SignupMode
  lastfm_api_key?: string | null
  oura_client_id?: string | null
  oura_client_secret?: string | null
  oura_webhook_enabled?: boolean
  strava_client_id?: string | null
  strava_client_secret?: string | null
}): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean } & AdminSettings>(
    `${API_URL}/admin/settings`,
    params,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    admin_count: response.data.admin_count,
    lastfm_api_key_set: response.data.lastfm_api_key_set,
    oura_client_id_set: response.data.oura_client_id_set,
    oura_client_secret_set: response.data.oura_client_secret_set,
    oura_webhook_available: response.data.oura_webhook_available,
    oura_webhook_enabled: response.data.oura_webhook_enabled,
    signup_mode: response.data.signup_mode,
    strava_client_id_set: response.data.strava_client_id_set,
    strava_client_secret_set: response.data.strava_client_secret_set,
  }
}

// Generate invitation
export const generateInvitation = async (expiryHours?: number): Promise<InvitationResult> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    token: string
    url: string
    expires_at: string
  }>(
    `${API_URL}/admin/invitations`,
    { expiry_hours: expiryHours },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    expires_at: new Date(response.data.expires_at),
    token: response.data.token,
    url: response.data.url,
  }
}
