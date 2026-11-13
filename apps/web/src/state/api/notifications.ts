import type {
  MarkAllNotificationsReadResponse,
  Notification,
  NotificationResponse,
  NotificationsResponse,
  NotificationTypeSetting,
  NotificationTypesResponse,
  SetNotificationPreferenceBody,
  SetNotificationPreferenceResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export interface FetchNotificationsParams {
  limit?: number
  cursor?: string
  unread_only?: boolean
}

export const fetchNotifications = async (
  params: FetchNotificationsParams = {},
): Promise<NotificationsResponse> => {
  const response = await axios.get<NotificationsResponse>(`${API_URL}/notifications`, {
    headers: authHeaders(),
    params,
  })
  return response.data
}

export const markNotificationRead = async (id: string): Promise<Notification | undefined> => {
  const response = await axios.post<NotificationResponse>(
    `${API_URL}/notifications/${encodeURIComponent(id)}/read`,
    undefined,
    { headers: authHeaders() },
  )
  return response.data.notification
}

export const markAllNotificationsRead = async (): Promise<number> => {
  const response = await axios.post<MarkAllNotificationsReadResponse>(
    `${API_URL}/notifications/read-all`,
    undefined,
    { headers: authHeaders() },
  )
  return response.data.updated
}

export const fetchNotificationTypes = async (): Promise<NotificationTypeSetting[]> => {
  const response = await axios.get<NotificationTypesResponse>(`${API_URL}/notifications/types`, {
    headers: authHeaders(),
  })
  return response.data.types
}

export const setNotificationPreference = async (
  type: string,
  patch: SetNotificationPreferenceBody,
): Promise<NotificationTypeSetting | undefined> => {
  const response = await axios.put<SetNotificationPreferenceResponse>(
    `${API_URL}/notifications/types/${encodeURIComponent(type)}`,
    patch,
    { headers: authHeaders() },
  )
  return response.data.type_setting
}
