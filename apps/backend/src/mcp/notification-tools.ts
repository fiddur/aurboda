import { notificationsQuerySchema, setNotificationPreferenceBodySchema, UUID_RE } from '@aurboda/api-spec'
import { z } from 'zod'

import type { RunNotificationAction } from '../services/notification-actions.ts'

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
  runAction?: RunNotificationAction,
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

  if (runAction) {
    server.tool(
      'run_notification_action',
      "Run one of a notification's actions (e.g. `skip` on an `autoshare_pending` notification stops that auto-share). The keys a notification offers are in its `actions` from list_notifications. Running one marks the notification read and clears its actions, so it runs at most once.",
      {
        id: z.string().uuid().describe('The notification ID'),
        key: z.string().describe("The action key, from the notification's `actions`"),
      },
      async ({ id, key }) => {
        const outcome = await runAction(user, id, key)
        if (outcome.status === 'not_found') return errorResponse('Notification action not found')
        if (outcome.status === 'conflict') return errorResponse(outcome.message)
        return jsonResponse({ notification: serializeNotification(outcome.notification), success: true })
      },
    )
  }

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
