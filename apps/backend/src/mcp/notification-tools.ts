import { notificationsQuerySchema, setNotificationPreferenceBodySchema, UUID_RE } from '@aurboda/api-spec'
import { z } from 'zod'

import {
  getNotificationTypeSettings,
  listNotificationsPage,
  type NotificationStore,
  notificationStore,
  serializeNotification,
  setNotificationTypePreference,
} from '../services/notifications.ts'
import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerNotificationTools = (
  server: McpServer,
  user: string,
  isAdmin: (user: string) => Promise<boolean>,
  store: NotificationStore = notificationStore,
) => {
  server.tool(
    'list_notifications',
    "List the user's notifications (the bell), newest first. `unread_count` counts every unread in-app notification whatever the filters. Page with `cursor` from `next_cursor`. `push_only` lists those meant for push delivery instead of the in-app ones.",
    { ...notificationsQuerySchema.shape },
    async (params) => jsonResponse({ ...(await listNotificationsPage(store, user, params)), success: true }),
  )

  server.tool(
    'mark_notification_read',
    'Mark one notification read by its ID. An already read one keeps its first read time.',
    { id: z.string().describe('The notification ID') },
    async ({ id }) => {
      const record = UUID_RE.test(id) ? await store.markRead(user, id) : null
      if (!record) return errorResponse('Notification not found')
      return jsonResponse({ notification: serializeNotification(record), success: true })
    },
  )

  server.tool('mark_all_notifications_read', 'Mark every unread notification read.', {}, async () =>
    jsonResponse({ success: true, updated: await store.markAllRead(user) }),
  )

  server.tool(
    'list_notification_types',
    "List the notification types this user can receive, each with the user's in-app and push switches (both default on).",
    {},
    async () =>
      jsonResponse({
        success: true,
        types: await getNotificationTypeSettings(store, user, await isAdmin(user)),
      }),
  )

  server.tool(
    'set_notification_preference',
    'Turn a notification type on or off in-app (the bell) and/or as a device push. Applies to notifications raised from now on; with both off the type is not stored at all. Give at least one of in_app and push.',
    {
      type: z.string().describe('The notification type, from list_notification_types'),
      ...setNotificationPreferenceBodySchema.shape,
    },
    async ({ type, in_app, push }) => {
      if (in_app === undefined && push === undefined) {
        return errorResponse('Give at least one of in_app or push')
      }
      const setting = await setNotificationTypePreference(store, user, type, await isAdmin(user), {
        in_app,
        push,
      })
      if (!setting) return errorResponse(`No such notification type: ${type}`)
      return jsonResponse({ success: true, type_setting: setting })
    },
  )
}
