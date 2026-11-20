/**
 * Postgres `LISTEN/NOTIFY` behind a user's live updates: the home timeline and the
 * notification bell. A ping is emitted through the user's pool; an open channel
 * listens on its own dedicated connection to the user's database, because `LISTEN`
 * is session state and a pooled connection is handed to other callers between
 * statements. `pg_notify` reaches every session listening in the same database.
 *
 * The payload is intentionally empty: a ping means "refetch". That sidesteps
 * NOTIFY's 8 kB payload limit and keeps post and notification content off the
 * channel.
 */
import type { Client, Notification } from 'pg'

import { createUserListenClient, getDbForUser } from './connection.ts'

export type LiveEventKind = 'timeline' | 'notification'

/** Fixed identifiers (no interpolation of user input), so safe to inline in LISTEN/UNLISTEN. */
const CHANNELS: Record<LiveEventKind, string> = {
  notification: 'notification_updates',
  timeline: 'timeline_updates',
}

const KIND_BY_CHANNEL = new Map(
  (Object.entries(CHANNELS) as [LiveEventKind, string][]).map(([kind, channel]) => [channel, kind]),
)

export const emitLiveNotify = async (user: string, kind: LiveEventKind): Promise<void> => {
  const db = await getDbForUser(user)
  await db.query('SELECT pg_notify($1, $2)', [CHANNELS[kind], ''])
}

/**
 * Listen for every kind of ping on one dedicated connection to the user's DB.
 * Resolves to a teardown that issues `UNLISTEN` and closes the connection. The
 * caller opens exactly one channel per user, so this doesn't refcount.
 */
export const openLiveChannel = async (
  user: string,
  onEvent: (kind: LiveEventKind) => void,
  makeClient: (user: string) => Client = createUserListenClient,
): Promise<() => Promise<void>> => {
  const client = makeClient(user)
  // Without a listener, a dropped connection would crash the process.
  client.on('error', (err) => console.error(`⚠️ Live LISTEN connection error for ${user}:`, err))
  client.on('notification', (msg: Notification) => {
    const kind = KIND_BY_CHANNEL.get(msg.channel)
    if (kind) onEvent(kind)
  })
  try {
    await client.connect()
    for (const channel of Object.values(CHANNELS)) await client.query(`LISTEN ${channel}`)
  } catch (err) {
    await client.end().catch(() => {})
    throw err
  }
  return async () => {
    // Best-effort: the connection may already be gone on shutdown.
    await client.query('UNLISTEN *').catch(() => {})
    await client.end().catch(() => {})
  }
}
