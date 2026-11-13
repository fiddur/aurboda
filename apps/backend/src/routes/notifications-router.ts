import {
  type MarkAllNotificationsReadResponse,
  type NotificationResponse,
  type NotificationsQuery,
  notificationsQuerySchema,
  type NotificationsResponse,
  type NotificationTypesResponse,
  type SetNotificationPreferenceBody,
  setNotificationPreferenceBodySchema,
  type SetNotificationPreferenceResponse,
  UUID_RE,
} from '@aurboda/api-spec'

import type { RunNotificationAction } from '../services/notification-actions.ts'

import {
  getNotificationTypeSettings,
  listNotificationsPage,
  type NotificationStore,
  notificationStore,
  serializeNotification,
  setNotificationTypePreference,
} from '../services/notifications.ts'
import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

export interface NotificationsRouterDeps {
  isAdmin: (user: string) => Promise<boolean>
  runAction: RunNotificationAction
  store?: NotificationStore
}

export const createNotificationsRouter = (
  authMiddleware: AnyMiddleware,
  { isAdmin, runAction, store = notificationStore }: NotificationsRouterDeps,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, NotificationsResponse, unknown, NotificationsQuery>(
    '/',
    authMiddleware,
    validateQuery(notificationsQuerySchema),
    async (req, res) => {
      const page = await listNotificationsPage(store, req.user!, req.query)
      res.json({ ...page, success: true })
    },
  )

  router.get<Record<string, never>, NotificationTypesResponse>('/types', authMiddleware, async (req, res) => {
    const user = req.user!
    const types = await getNotificationTypeSettings(store, user, await isAdmin(user))
    res.json({ success: true, types })
  })

  router.put<{ type: string }, SetNotificationPreferenceResponse, SetNotificationPreferenceBody>(
    '/types/:type',
    authMiddleware,
    validateBody(setNotificationPreferenceBodySchema),
    async (req, res) => {
      const user = req.user!
      const setting = await setNotificationTypePreference(
        store,
        user,
        req.params.type,
        await isAdmin(user),
        req.body,
      )
      if (!setting) {
        return res.status(404).json({ error: 'No such notification type', success: false })
      }
      res.json({ success: true, type_setting: setting })
    },
  )

  router.post<Record<string, never>, MarkAllNotificationsReadResponse>(
    '/read-all',
    authMiddleware,
    async (req, res) => {
      const updated = await store.markAllRead(req.user!)
      res.json({ success: true, updated })
    },
  )

  router.post<{ id: string }, NotificationResponse>('/:id/read', authMiddleware, async (req, res) => {
    if (!UUID_RE.test(req.params.id)) {
      return res.status(404).json({ error: 'Notification not found', success: false })
    }
    const record = await store.markRead(req.user!, req.params.id)
    if (!record) {
      return res.status(404).json({ error: 'Notification not found', success: false })
    }
    res.json({ notification: serializeNotification(record), success: true })
  })

  router.post<{ id: string; key: string }, NotificationResponse>(
    '/:id/actions/:key',
    authMiddleware,
    async (req, res) => {
      const outcome = await runAction(req.user!, req.params.id, req.params.key)
      switch (outcome.status) {
        case 'not_found':
          return res.status(404).json({ error: 'Notification action not found', success: false })
        case 'conflict':
          return res.status(409).json({ error: outcome.message, success: false })
        case 'ok':
          return res.json({ notification: serializeNotification(outcome.notification), success: true })
      }
    },
  )

  return router
}
