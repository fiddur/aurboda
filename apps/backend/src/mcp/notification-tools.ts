import { notificationsQuerySchema, setNotificationPreferenceBodySchema, UUID_RE } from '@aurboda/api-spec'
import { z } from 'zod'

import type { RunNotificationAction } from '../services/notification-actions.ts'
import type { WebPush } from '../services/web-push.ts'

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
  {
    runAction,
    store = notificationStore,
    webPush,
  }: { runAction?: RunNotificationAction; store?: NotificationStore; webPush?: WebPush } = {},
) => {
  server.tool(
    'list_notifications',
    "List the user's notifications (the bell), newest first. `unread_count` counts every unread in-app notification whatever the filters. Page with `cursor` from `next_cursor`. `push_only` lists those meant for push delivery instead of the in-app ones. `ids` (comma-separated) re-reads given notifications, read or not, to see whether they were revised, read or deleted.",
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

  if (webPush) {
    server.tool(
      'list_push_subscriptions',
      "List the browsers subscribed to the user's push notifications (Web Push), oldest first, each with a readable browser label and when a push last reached it. Subscribing needs a browser: Settings → Notifications on the web.",
      {},
      async () => jsonResponse({ subscriptions: await webPush.list(user), success: true }),
    )

    server.tool(
      'delete_push_subscription',
      'Remove a subscribed browser by its ID (from list_push_subscriptions). It gets no more pushes.',
      { id: z.string().describe('The subscription ID') },
      async ({ id }) => {
        if (!UUID_RE.test(id) || !(await webPush.remove(user, id))) {
          return errorResponse('Subscription not found')
        }
        return jsonResponse({ success: true })
      },
    )

    server.tool(
      'send_test_push',
      'Send "Aurboda can reach this browser" to every subscribed browser at once (not stored as a notification). Answers how many browsers accepted it out of how many are subscribed.',
      {},
      async () => {
        const result = await webPush.sendTest(user)
        if (result === null) return errorResponse('This server does not offer browser push')
        return jsonResponse({ ...result, success: true })
      },
    )
  }
}
