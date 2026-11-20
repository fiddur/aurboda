import { query } from './connection.ts'

export interface PushSubscriptionRecord {
  id: string
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
  created_at: Date
  last_success_at: Date | null
  failure_count: number
}

export interface PushSubscriptionInsert {
  endpoint: string
  p256dh: string
  auth: string
  user_agent: string | null
}

const COLUMNS = 'id, endpoint, p256dh, auth, user_agent, created_at, last_success_at, failure_count'

/** Subscribing the same endpoint again replaces its keys and user agent and clears its failures. */
export const upsertPushSubscription = async (
  user: string,
  input: PushSubscriptionInsert,
): Promise<PushSubscriptionRecord> => {
  const result = await query<PushSubscriptionRecord>(
    user,
    `INSERT INTO push_subscriptions (endpoint, p256dh, auth, user_agent)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (endpoint) DO UPDATE SET
       p256dh = EXCLUDED.p256dh,
       auth = EXCLUDED.auth,
       user_agent = EXCLUDED.user_agent,
       failure_count = 0
     RETURNING ${COLUMNS}`,
    [input.endpoint, input.p256dh, input.auth, input.user_agent],
  )
  return result.rows[0]!
}

export const listPushSubscriptions = async (user: string): Promise<PushSubscriptionRecord[]> => {
  const result = await query<PushSubscriptionRecord>(
    user,
    `SELECT ${COLUMNS} FROM push_subscriptions ORDER BY created_at, id`,
  )
  return result.rows
}

export const deletePushSubscription = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM push_subscriptions WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Keeps `keepId` and the `max - 1` others most recently reached (or, never reached, created) and
 * deletes the rest. Resolves to how many were deleted.
 */
export const trimPushSubscriptions = async (user: string, keepId: string, max: number): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM push_subscriptions
     WHERE id <> $1 AND id NOT IN (
       SELECT id FROM push_subscriptions
       WHERE id <> $1
       ORDER BY COALESCE(last_success_at, created_at) DESC, id DESC
       LIMIT $2
     )`,
    [keepId, Math.max(max - 1, 0)],
  )
  return result.rowCount ?? 0
}

export const recordPushSuccess = async (user: string, id: string): Promise<void> => {
  await query(
    user,
    'UPDATE push_subscriptions SET last_success_at = NOW(), failure_count = 0 WHERE id = $1',
    [id],
  )
}

/** Resolves to the subscription's consecutive failures after this one, or null when it is gone. */
export const recordPushFailure = async (user: string, id: string): Promise<number | null> => {
  const result = await query<{ failure_count: number }>(
    user,
    'UPDATE push_subscriptions SET failure_count = failure_count + 1 WHERE id = $1 RETURNING failure_count',
    [id],
  )
  return result.rows[0]?.failure_count ?? null
}
