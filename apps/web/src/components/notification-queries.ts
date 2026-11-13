import type { NotificationsResponse } from '@aurboda/api-spec'

import { type InfiniteData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  fetchNotifications,
  markAllNotificationsRead,
  markNotificationRead,
  runNotificationAction,
} from '../state/api'
import { auth } from '../state/auth'
import { markAllReadInPage, markReadInPage } from './notifications'

export const LATEST_NOTIFICATIONS_KEY = ['notifications', 'latest'] as const
export const NOTIFICATION_PAGES_KEY = ['notifications', 'pages'] as const
const LATEST_LIMIT = 20

/** The newest notifications and the unread count, shared by the badge, the dropdown and the mobile bar. */
export const useLatestNotifications = () =>
  useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: () => fetchNotifications({ limit: LATEST_LIMIT }),
    queryKey: LATEST_NOTIFICATIONS_KEY,
    refetchInterval: 60_000,
    refetchOnWindowFocus: true,
    staleTime: 30_000,
  })

type Update = (page: NotificationsResponse) => NotificationsResponse

const useOptimisticNotifications = () => {
  const queryClient = useQueryClient()
  return async (update: Update) => {
    await queryClient.cancelQueries({ queryKey: ['notifications'] })
    queryClient.setQueryData<NotificationsResponse>(LATEST_NOTIFICATIONS_KEY, (page) => page && update(page))
    queryClient.setQueryData<InfiniteData<NotificationsResponse>>(
      NOTIFICATION_PAGES_KEY,
      (data) => data && { ...data, pages: data.pages.map(update) },
    )
  }
}

export const useMarkNotificationRead = () => {
  const queryClient = useQueryClient()
  const applyOptimistic = useOptimisticNotifications()
  return useMutation({
    mutationFn: (id: string) => markNotificationRead(id),
    onMutate: (id) => applyOptimistic((page) => markReadInPage(page, id, new Date().toISOString())),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export const useMarkAllNotificationsRead = () => {
  const queryClient = useQueryClient()
  const applyOptimistic = useOptimisticNotifications()
  return useMutation({
    mutationFn: () => markAllNotificationsRead(),
    onMutate: () => applyOptimistic((page) => markAllReadInPage(page, new Date().toISOString())),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}

export interface NotificationActionVariables {
  id: string
  key: string
}

export const useRunNotificationAction = () => {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, key }: NotificationActionVariables) => runNotificationAction(id, key),
    onSettled: () => queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  })
}
