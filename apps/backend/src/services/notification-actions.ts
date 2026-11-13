import { isNotificationType, type NotificationType, UUID_RE } from '@aurboda/api-spec'

import type { NotificationRecord, NotificationRevisionPatch } from '../db/index.ts'

export interface NotificationRevision {
  title: string
  body?: string | null
  link?: string | null
}

export type NotificationActionResult =
  | { ok: true; revision: NotificationRevision }
  | { ok: false; message: string; revision?: NotificationRevision }

export type NotificationActionHandler = (
  user: string,
  notification: NotificationRecord,
) => Promise<NotificationActionResult>

export type NotificationActionHandlers = Partial<
  Record<NotificationType, Record<string, NotificationActionHandler>>
>

export type RunNotificationActionOutcome =
  | { status: 'ok'; notification: NotificationRecord }
  | { status: 'not_found' }
  | { status: 'conflict'; message: string }

export type RunNotificationAction = (
  user: string,
  id: string,
  key: string,
) => Promise<RunNotificationActionOutcome>

export interface RunNotificationActionDeps {
  get: (user: string, id: string) => Promise<NotificationRecord | null>
  revise: (user: string, id: string, patch: NotificationRevisionPatch) => Promise<NotificationRecord | null>
  handlers: NotificationActionHandlers
}

const handlerFor = (
  handlers: NotificationActionHandlers,
  notification: NotificationRecord,
  key: string,
): NotificationActionHandler | undefined => {
  if (!isNotificationType(notification.type)) return undefined
  if (!notification.actions.some((action) => action.key === key)) return undefined
  const byKey = handlers[notification.type]
  return byKey != null && Object.hasOwn(byKey, key) ? byKey[key] : undefined
}

/** Runs the action at most once: applying the result clears the notification's actions and marks it read. */
export const runNotificationAction =
  (deps: RunNotificationActionDeps): RunNotificationAction =>
  async (user, id, key) => {
    if (!UUID_RE.test(id)) return { status: 'not_found' }
    const notification = await deps.get(user, id)
    if (notification == null) return { status: 'not_found' }
    const handler = handlerFor(deps.handlers, notification, key)
    if (handler == null) return { status: 'not_found' }

    const result = await handler(user, notification)
    const apply = (revision: NotificationRevision) =>
      deps.revise(user, id, { ...revision, actions: [], mark_read: true })
    if (!result.ok) {
      if (result.revision != null) await apply(result.revision)
      return { message: result.message, status: 'conflict' }
    }
    const revised = await apply(result.revision)
    return revised == null ? { status: 'not_found' } : { notification: revised, status: 'ok' }
  }
