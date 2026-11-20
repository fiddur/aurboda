import type {
  AddPushSubscriptionBody,
  BaseResponse,
  MarkAllNotificationsReadResponse,
  Notification,
  NotificationResponse,
  NotificationsResponse,
  NotificationTypeSetting,
  NotificationTypesResponse,
  PushConfigResponse,
  PushSubscription,
  PushSubscriptionResponse,
  PushSubscriptionsResponse,
  SendTestPushResponse,
  SetNotificationPreferenceBody,
  SetNotificationPreferenceResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'
import { apiErrorMessage } from './feed'

const authHeaders = (token = auth.value.token) => ({ Authorization: `Bearer ${token}` })

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

/** Runs one of a notification's actions; throws with the server's message when it cannot be done. */
export const runNotificationAction = async (id: string, key: string): Promise<Notification | undefined> => {
  try {
    const response = await axios.post<NotificationResponse>(
      `${API_URL}/notifications/${encodeURIComponent(id)}/actions/${encodeURIComponent(key)}`,
      undefined,
      { headers: authHeaders() },
    )
    return response.data.notification
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t do that. Please try again.'))
  }
}

export const fetchPushConfig = async (): Promise<PushConfigResponse> => {
  const response = await axios.get<PushConfigResponse>(`${API_URL}/notifications/push/config`, {
    headers: authHeaders(),
  })
  return response.data
}

/** `token` lets sign-out still reach the server after the session is cleared. */
export const fetchPushSubscriptions = async (
  endpoint?: string,
  token?: string,
): Promise<PushSubscription[]> => {
  const response = await axios.get<PushSubscriptionsResponse>(`${API_URL}/notifications/push/subscriptions`, {
    headers: authHeaders(token),
    params: endpoint === undefined ? undefined : { endpoint },
  })
  return response.data.subscriptions
}

export const addPushSubscription = async (
  body: AddPushSubscriptionBody,
): Promise<PushSubscription | undefined> => {
  try {
    const response = await axios.post<PushSubscriptionResponse>(
      `${API_URL}/notifications/push/subscriptions`,
      body,
      { headers: authHeaders() },
    )
    return response.data.subscription
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t turn on push for this browser.'))
  }
}

export const deletePushSubscription = async (id: string, token?: string): Promise<void> => {
  await axios.delete<BaseResponse>(`${API_URL}/notifications/push/subscriptions/${encodeURIComponent(id)}`, {
    headers: authHeaders(token),
  })
}

export const sendTestPush = async (): Promise<SendTestPushResponse> => {
  try {
    const response = await axios.post<SendTestPushResponse>(`${API_URL}/notifications/push/test`, undefined, {
      headers: authHeaders(),
    })
    return response.data
  } catch (error) {
    throw new Error(apiErrorMessage(error, 'Couldn’t send a test push.'))
  }
}
