import type { UpdateSettingsInput, UserSettingsResponse } from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Generate a fresh API token for the authenticated user (used for push agents like ActivityWatch)
export const generateApiToken = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; token: string }>(`${API_URL}/auth/token`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.token
}

// Fetch user settings (including HR zone thresholds)
export const fetchUserSettings = async (): Promise<UserSettingsResponse> => {
  const { token } = auth.value
  const response = await axios.get<UserSettingsResponse>(`${API_URL}/user/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data
}

// Update user settings
export const updateUserSettings = async (params: UpdateSettingsInput): Promise<UserSettingsResponse> => {
  const { token } = auth.value
  const response = await axios.patch<UserSettingsResponse>(`${API_URL}/user/settings`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data
}

// Upload an icon image, returns { id, url }
export const uploadIcon = async (file: File): Promise<{ id: string; url: string }> => {
  const { token } = auth.value
  const formData = new FormData()
  formData.append('icon', file)
  const response = await axios.post<{ id: string; success: boolean; url: string }>(
    `${API_URL}/icons`,
    formData,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } },
  )
  return { id: response.data.id, url: response.data.url }
}

/** Fetch item icons from user settings. */
export const fetchItemIcons = async (): Promise<Record<string, string>> => {
  const settings = await fetchUserSettings()
  return settings.item_icons ?? {}
}
