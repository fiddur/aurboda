/**
 * Postgres `LISTEN/NOTIFY` for the home timeline — the low-level transport behind
 * live updates. Each user has one long-lived per-user DB connection (see
 * `getDbForUser`); the ingest path emits a ping on it when a new post arrives, and
 * an open SSE stream listens on that same connection and receives its own ping.
 *
 * The payload is intentionally empty: a ping means "your timeline changed, refetch
 * the newest page". Keeping it empty sidesteps NOTIFY's 8 kB payload limit and
 * avoids leaking post content through the notification channel.
 *
 * The per-user channel refcounting (open on the first subscriber, close on the
 * last) lives in the in-process `TimelineHub`; this module is the thin PG glue.
 */
import type { Client, Notification } from 'pg'

import { getDbForUser } from './connection.ts'

/** A fixed identifier (no interpolation of user input) — safe to inline in LISTEN/UNLISTEN. */
const CHANNEL = 'timeline_updates'

/** Emit a home-timeline "changed" ping on the user's DB. */
export const emitTimelineNotify = async (user: string): Promise<void> => {
  const client = await getDbForUser(user)
  await client.query('SELECT pg_notify($1, $2)', [CHANNEL, ''])
}

/**
 * Start listening for home-timeline pings on the user's DB connection, invoking
 * `onNotify` for each. Returns a teardown that detaches the listener and issues
 * `UNLISTEN`. The caller opens exactly one channel per user (and tears it down when
 * the last subscriber leaves), so this doesn't refcount.
 */
export const openTimelineChannel = async (
  user: string,
  onNotify: () => void,
): Promise<() => Promise<void>> => {
  const client: Client = await getDbForUser(user)
  const handler = (msg: Notification) => {
    if (msg.channel === CHANNEL) onNotify()
  }
  client.on('notification', handler)
  await client.query(`LISTEN ${CHANNEL}`)
  return async () => {
    client.removeListener('notification', handler)
    // Best-effort: the connection may already be gone on shutdown.
    await client.query(`UNLISTEN ${CHANNEL}`).catch(() => {})
  }
}
