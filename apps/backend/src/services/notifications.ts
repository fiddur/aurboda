import {
  isNotificationType,
  type Notification,
  type NotificationAction,
  type NotificationsQuery,
  type NotificationsResponse,
  type NotificationType,
  notificationGroupLabels,
  notificationGroups,
  notificationTypeInfo,
  notificationTypes,
  type NotificationTypeSetting,
} from '@aurboda/api-spec'

import {
  countUnreadNotifications,
  getNotificationById,
  getNotificationPreference,
  insertNotification,
  listNotificationPreferences,
  listNotifications,
  type ListNotificationsOptions,
  markAllNotificationsRead,
  markNotificationRead,
  type NotificationInsert,
  type NotificationPageRow,
  type NotificationPreferencePatch,
  type NotificationPreferenceRecord,
  type NotificationRecord,
  type NotificationRevisionPatch,
  type NotificationTarget,
  pruneNotifications,
  reviseNotification,
  upsertNotificationPreference,
} from '../db/index.ts'
import { decodeKeysetCursor, encodeKeysetCursor } from './keyset-cursor.ts'

const DAY_MS = 24 * 60 * 60 * 1000
export const READ_RETENTION_DAYS = 90
export const MAX_RETENTION_DAYS = 365

export interface RaiseNotificationInput {
  type: NotificationType
  title: string
  body?: string
  link?: string
  data?: Record<string, unknown>
  dedupe_key?: string
  actions?: NotificationAction[]
}

export interface NotifierDeps {
  getPreference: (
    user: string,
    type: string,
  ) => Promise<Pick<NotificationPreferenceRecord, 'in_app' | 'push'> | null>
  insert: (user: string, input: NotificationInsert) => Promise<NotificationRecord | null>
  prune: (user: string, readBefore: Date, anyBefore: Date) => Promise<number>
  revise: (
    user: string,
    target: NotificationTarget,
    patch: NotificationRevisionPatch,
  ) => Promise<NotificationRecord | null>
  now?: () => Date
  logError?: (message: string, error: unknown) => void
}

export interface Notifier {
  /** Stores the notification unless the user's preferences turn the type fully off or the dedupe key was already used. Resolves to the stored row or null. Throws on a database error. */
  raise: (user: string, input: RaiseNotificationInput) => Promise<NotificationRecord | null>
  /** `raise` for hot paths: logs and swallows every error (including a missing user database). */
  raiseBestEffort: (user: string, input: RaiseNotificationInput) => Promise<void>
  /** Updates the given fields of the notification with this dedupe key. Resolves to the row or null when there is none. */
  revise: (
    user: string,
    dedupeKey: string,
    patch: NotificationRevisionPatch,
  ) => Promise<NotificationRecord | null>
  /** `revise` that logs and swallows every error. */
  reviseBestEffort: (user: string, dedupeKey: string, patch: NotificationRevisionPatch) => Promise<void>
}

const validateLink = (link: string | null | undefined): void => {
  if (link != null && (!link.startsWith('/') || link.startsWith('//'))) {
    throw new Error(`Notification link must be an in-app path starting with '/': ${link}`)
  }
}

const validateInput = (input: RaiseNotificationInput): void => {
  if (input.title.trim() === '') throw new Error(`Notification ${input.type} needs a title`)
  validateLink(input.link)
}

export const validateRevision = (patch: NotificationRevisionPatch): void => {
  if (patch.title !== undefined && patch.title.trim() === '') throw new Error('Notification needs a title')
  validateLink(patch.link)
}

export const createNotifier = (deps: NotifierDeps): Notifier => {
  const now = deps.now ?? (() => new Date())
  const logError = deps.logError ?? ((message, error) => console.error(message, error))

  const raise = async (user: string, input: RaiseNotificationInput): Promise<NotificationRecord | null> => {
    validateInput(input)
    const preference = await deps.getPreference(user, input.type)
    const inApp = preference?.in_app ?? true
    const push = preference?.push ?? true
    if (!inApp && !push) return null

    const row = await deps.insert(user, {
      body: input.body ?? null,
      data: input.data ?? null,
      dedupe_key: input.dedupe_key ?? null,
      in_app: inApp,
      link: input.link ?? null,
      push,
      title: input.title,
      type: input.type,
      actions: input.actions ?? [],
    })
    if (row) {
      const at = now().getTime()
      await deps.prune(
        user,
        new Date(at - READ_RETENTION_DAYS * DAY_MS),
        new Date(at - MAX_RETENTION_DAYS * DAY_MS),
      )
    }
    return row
  }

  const raiseBestEffort = async (user: string, input: RaiseNotificationInput): Promise<void> => {
    try {
      await raise(user, input)
    } catch (error) {
      logError(`⚠️ Failed to raise ${input.type} notification for ${user}:`, error)
    }
  }

  const revise = async (
    user: string,
    dedupeKey: string,
    patch: NotificationRevisionPatch,
  ): Promise<NotificationRecord | null> => {
    validateRevision(patch)
    return deps.revise(user, { dedupe_key: dedupeKey }, patch)
  }

  const reviseBestEffort = async (
    user: string,
    dedupeKey: string,
    patch: NotificationRevisionPatch,
  ): Promise<void> => {
    try {
      await revise(user, dedupeKey, patch)
    } catch (error) {
      logError(`⚠️ Failed to revise notification ${dedupeKey} for ${user}:`, error)
    }
  }

  return { raise, raiseBestEffort, revise, reviseBestEffort }
}

export const notifier: Notifier = createNotifier({
  getPreference: (user, type) => getNotificationPreference(user, type),
  insert: (user, input) => insertNotification(user, input),
  prune: (user, readBefore, anyBefore) => pruneNotifications(user, readBefore, anyBefore),
  revise: (user, target, patch) => reviseNotification(user, target, patch),
})

export const serializeNotification = (record: NotificationRecord): Notification => ({
  actions: record.actions,
  body: record.body,
  created_at: record.created_at.toISOString(),
  data: record.data,
  id: record.id,
  in_app: record.in_app,
  link: record.link,
  push: record.push,
  read_at: record.read_at?.toISOString() ?? null,
  title: record.title,
  type: record.type,
})

/** Group by group, then registry order within each. */
const settingsOrder = notificationGroups.flatMap((group) =>
  notificationTypes.filter((type) => notificationTypeInfo[type].group === group),
)

/** The registry entries this user can receive, joined with their stored switches (both default on), grouped. */
export const listNotificationTypeSettings = (
  isAdmin: boolean,
  preferences: readonly Pick<NotificationPreferenceRecord, 'in_app' | 'push' | 'type'>[],
): NotificationTypeSetting[] => {
  const byType = new Map(preferences.map((p) => [p.type, p]))
  return settingsOrder
    .filter((type) => isAdmin || !notificationTypeInfo[type].admin_only)
    .map((type) => {
      const info = notificationTypeInfo[type]
      const stored = byType.get(type)
      return {
        admin_only: info.admin_only,
        description: info.description,
        group: info.group,
        group_label: notificationGroupLabels[info.group],
        in_app: stored?.in_app ?? true,
        label: info.label,
        push: stored?.push ?? true,
        type,
      }
    })
}

/** Whether `type` is a notification type this user can receive and so configure. */
export const canConfigureNotificationType = (type: string, isAdmin: boolean): type is NotificationType =>
  isNotificationType(type) && (isAdmin || !notificationTypeInfo[type].admin_only)

export interface NotifyAdminsOfSignupDeps {
  getAdmins: () => Promise<string[]>
  raiseBestEffort: Notifier['raiseBestEffort']
  logError?: (message: string, error: unknown) => void
}

/** Best-effort: never throws, whatever fails. The new account itself is never notified. */
export const notifyAdminsOfSignup =
  (deps: NotifyAdminsOfSignupDeps) =>
  async (username: string): Promise<void> => {
    let admins: string[]
    try {
      admins = await deps.getAdmins()
    } catch (error) {
      const logError = deps.logError ?? ((message, e) => console.error(message, e))
      logError(`⚠️ Could not list admins to notify of ${username}'s signup:`, error)
      return
    }
    await Promise.all(
      admins
        .filter((admin) => admin !== username)
        .map((admin) =>
          deps.raiseBestEffort(admin, {
            body: `${username} created an account.`,
            data: { username },
            dedupe_key: `admin_signup:${username}`,
            link: `/admin/users/${username}`,
            title: `New signup: ${username}`,
            type: 'admin_signup',
          }),
        ),
    )
  }

export interface NotificationStore {
  get: (user: string, id: string) => Promise<NotificationRecord | null>
  revise: (user: string, id: string, patch: NotificationRevisionPatch) => Promise<NotificationRecord | null>
  list: (user: string, options: ListNotificationsOptions) => Promise<NotificationPageRow[]>
  countUnread: (user: string) => Promise<number>
  markRead: (user: string, id: string) => Promise<NotificationRecord | null>
  markAllRead: (user: string) => Promise<number>
  listPreferences: (user: string) => Promise<NotificationPreferenceRecord[]>
  upsertPreference: (
    user: string,
    type: string,
    patch: NotificationPreferencePatch,
  ) => Promise<NotificationPreferenceRecord>
}

/** Resolved at call time, so importing this module never touches the db module's bindings. */
export const notificationStore: NotificationStore = {
  countUnread: (user) => countUnreadNotifications(user),
  get: (user, id) => getNotificationById(user, id),
  list: (user, options) => listNotifications(user, options),
  listPreferences: (user) => listNotificationPreferences(user),
  markAllRead: (user) => markAllNotificationsRead(user),
  markRead: (user, id) => markNotificationRead(user, id),
  revise: (user, id, patch) => reviseNotification(user, { id }, patch),
  upsertPreference: (user, type, patch) => upsertNotificationPreference(user, type, patch),
}

export type NotificationsPage = Required<
  Pick<NotificationsResponse, 'next_cursor' | 'notifications' | 'unread_count'>
>

export const listNotificationsPage = async (
  store: NotificationStore,
  user: string,
  params: Pick<NotificationsQuery, 'after' | 'cursor' | 'push_only' | 'unread_only'> & { limit: number },
): Promise<NotificationsPage> => {
  const cursor = decodeKeysetCursor(params.cursor)
  const [rows, unreadCount] = await Promise.all([
    store.list(user, {
      after: params.after === undefined ? undefined : new Date(params.after),
      before: cursor && { created_at: cursor.ts, id: cursor.id },
      limit: params.limit + 1,
      push_only: params.push_only,
      unread_only: params.unread_only,
    }),
    store.countUnread(user),
  ])
  const hasMore = rows.length > params.limit
  const page = hasMore ? rows.slice(0, params.limit) : rows
  const last = page[page.length - 1]
  return {
    next_cursor: hasMore && last ? encodeKeysetCursor(last.cursor_ts, last.id) : null,
    notifications: page.map(serializeNotification),
    unread_count: unreadCount,
  }
}

export const getNotificationTypeSettings = async (
  store: NotificationStore,
  user: string,
  isAdmin: boolean,
): Promise<NotificationTypeSetting[]> =>
  listNotificationTypeSettings(isAdmin, await store.listPreferences(user))

/** Null when `type` is not one this user can receive. */
export const setNotificationTypePreference = async (
  store: NotificationStore,
  user: string,
  type: string,
  isAdmin: boolean,
  patch: NotificationPreferencePatch,
): Promise<NotificationTypeSetting | null> => {
  if (!canConfigureNotificationType(type, isAdmin)) return null
  const stored = await store.upsertPreference(user, type, patch)
  return listNotificationTypeSettings(isAdmin, [stored]).find((setting) => setting.type === type) ?? null
}
