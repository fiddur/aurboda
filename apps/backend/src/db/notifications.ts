import type { NotificationPageRow, NotificationPreferenceRecord, NotificationRecord } from './types.ts'

import { query } from './connection.ts'

const NOTIFICATION_COLUMNS =
  'id, type, title, body, link, data, dedupe_key, in_app, push, read_at, created_at'

export interface NotificationInsert {
  type: string
  title: string
  body?: string | null
  link?: string | null
  data?: Record<string, unknown> | null
  dedupe_key?: string | null
  in_app: boolean
  push: boolean
}

/** Null when `dedupe_key` was already used: the earlier notification stands. */
export const insertNotification = async (
  user: string,
  input: NotificationInsert,
): Promise<NotificationRecord | null> => {
  const result = await query<NotificationRecord>(
    user,
    `INSERT INTO notifications (type, title, body, link, data, dedupe_key, in_app, push)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (dedupe_key) DO NOTHING
     RETURNING ${NOTIFICATION_COLUMNS}`,
    [
      input.type,
      input.title,
      input.body ?? null,
      input.link ?? null,
      input.data == null ? null : JSON.stringify(input.data),
      input.dedupe_key ?? null,
      input.in_app,
      input.push,
    ],
  )
  return result.rows[0] ?? null
}

export interface NotificationCursor {
  /** `created_at` as Postgres text (µs precision). */
  created_at: string
  id: string
}

export interface ListNotificationsOptions {
  limit: number
  before?: NotificationCursor
  unread_only?: boolean
  /** Rows meant for push (`push = true`) instead of the in-app ones. */
  push_only?: boolean
  after?: Date
}

/**
 * Newest first, keyset-paginated on `(created_at, id)`. `after` compares at millisecond
 * precision: a poller's high-water mark is the ISO `created_at` it was served, which has lost
 * the microseconds, and the row it came from must not be served again.
 */
export const listNotifications = async (
  user: string,
  options: ListNotificationsOptions,
): Promise<NotificationPageRow[]> => {
  const result = await query<NotificationPageRow>(
    user,
    `SELECT ${NOTIFICATION_COLUMNS}, created_at::text AS cursor_ts FROM notifications
     WHERE (CASE WHEN $2::boolean THEN push ELSE in_app END)
       AND (NOT $3::boolean OR read_at IS NULL)
       AND ($4::timestamptz IS NULL OR date_trunc('milliseconds', created_at) > $4::timestamptz)
       AND ($5::timestamptz IS NULL OR (created_at, id) < ($5::timestamptz, $6::uuid))
     ORDER BY created_at DESC, id DESC
     LIMIT $1`,
    [
      options.limit,
      options.push_only === true,
      options.unread_only === true,
      options.after ?? null,
      options.before?.created_at ?? null,
      options.before?.id ?? null,
    ],
  )
  return result.rows
}

export const countUnreadNotifications = async (user: string): Promise<number> => {
  const result = await query<{ count: string }>(
    user,
    'SELECT COUNT(*) AS count FROM notifications WHERE in_app AND read_at IS NULL',
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** Keeps the first `read_at` of an already read row. Null when there is no such row. */
export const markNotificationRead = async (user: string, id: string): Promise<NotificationRecord | null> => {
  const result = await query<NotificationRecord>(
    user,
    `UPDATE notifications SET read_at = COALESCE(read_at, NOW())
     WHERE id = $1
     RETURNING ${NOTIFICATION_COLUMNS}`,
    [id],
  )
  return result.rows[0] ?? null
}

export const markAllNotificationsRead = async (user: string): Promise<number> => {
  const result = await query(user, 'UPDATE notifications SET read_at = NOW() WHERE read_at IS NULL')
  return result.rowCount ?? 0
}

/** Deletes read rows created before `readBefore` and every row created before `anyBefore`. */
export const pruneNotifications = async (
  user: string,
  readBefore: Date,
  anyBefore: Date,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM notifications
     WHERE (read_at IS NOT NULL AND created_at < $1) OR created_at < $2`,
    [readBefore, anyBefore],
  )
  return result.rowCount ?? 0
}

export const listNotificationPreferences = async (user: string): Promise<NotificationPreferenceRecord[]> => {
  const result = await query<NotificationPreferenceRecord>(
    user,
    'SELECT type, in_app, push, updated_at FROM notification_preferences ORDER BY type',
  )
  return result.rows
}

export const getNotificationPreference = async (
  user: string,
  type: string,
): Promise<NotificationPreferenceRecord | null> => {
  const result = await query<NotificationPreferenceRecord>(
    user,
    'SELECT type, in_app, push, updated_at FROM notification_preferences WHERE type = $1',
    [type],
  )
  return result.rows[0] ?? null
}

export interface NotificationPreferencePatch {
  in_app?: boolean
  push?: boolean
}

/** A side left out keeps its stored value, or the default (on) for a new row. */
export const upsertNotificationPreference = async (
  user: string,
  type: string,
  patch: NotificationPreferencePatch,
): Promise<NotificationPreferenceRecord> => {
  const result = await query<NotificationPreferenceRecord>(
    user,
    `INSERT INTO notification_preferences (type, in_app, push)
     VALUES ($1, COALESCE($2::boolean, true), COALESCE($3::boolean, true))
     ON CONFLICT (type) DO UPDATE SET
       in_app = COALESCE($2::boolean, notification_preferences.in_app),
       push = COALESCE($3::boolean, notification_preferences.push),
       updated_at = NOW()
     RETURNING type, in_app, push, updated_at`,
    [type, patch.in_app ?? null, patch.push ?? null],
  )
  return result.rows[0]!
}
