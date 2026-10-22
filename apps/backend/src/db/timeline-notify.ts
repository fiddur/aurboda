/**
 * Postgres `LISTEN/NOTIFY` for the home timeline — the low-level transport behind
 * live updates. The ingest path emits a ping through the user's pool when a new
 * post arrives; an open channel listens on its own dedicated connection to the
 * user's database, because `LISTEN` is session state and a pooled connection is
 * handed to other callers between statements. `pg_notify` reaches every session
 * listening in the same database.
 *
 * The payload is intentionally empty: a ping means "your timeline changed, refetch
 * the newest page". Keeping it empty sidesteps NOTIFY's 8 kB payload limit and
 * avoids leaking post content through the notification channel.
 *
 * The per-user channel refcounting (open on the first subscriber, close on the
 * last) lives in the in-process `TimelineHub`; this module is the thin PG glue.
 */
import type { Client, Notification } from 'pg'

import { createUserListenClient, getDbForUser } from './connection.ts'

/** A fixed identifier (no interpolation of user input) — safe to inline in LISTEN/UNLISTEN. */
const CHANNEL = 'timeline_updates'

/** Emit a home-timeline "changed" ping on the user's DB. */
export const emitTimelineNotify = async (user: string): Promise<void> => {
  const db = await getDbForUser(user)
  await db.query('SELECT pg_notify($1, $2)', [CHANNEL, ''])
}

/**
 * Start listening for home-timeline pings on a dedicated connection to the user's
 * DB, invoking `onNotify` for each. Returns a teardown that issues `UNLISTEN` and
 * closes the connection. The caller opens exactly one channel per user (and tears
 * it down when the last subscriber leaves), so this doesn't refcount.
 */
export const openTimelineChannel = async (
  user: string,
  onNotify: () => void,
  makeClient: (user: string) => Client = createUserListenClient,
): Promise<() => Promise<void>> => {
  const client = makeClient(user)
  // Without a listener, a dropped connection would crash the process.
  client.on('error', (err) => console.error(`⚠️ Timeline LISTEN connection error for ${user}:`, err))
  client.on('notification', (msg: Notification) => {
    if (msg.channel === CHANNEL) onNotify()
  })
  try {
    await client.connect()
    await client.query(`LISTEN ${CHANNEL}`)
  } catch (err) {
    await client.end().catch(() => {})
    throw err
  }
  return async () => {
    // Best-effort: the connection may already be gone on shutdown.
    await client.query(`UNLISTEN ${CHANNEL}`).catch(() => {})
    await client.end().catch(() => {})
  }
}
