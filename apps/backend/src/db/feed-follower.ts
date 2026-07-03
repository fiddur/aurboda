/**
 * Remote followers of a user's ActivityPub actor.
 *
 * Stored per-user (in the followed user's database), keyed by the follower's
 * actor URI. We cache the follower's inbox (and optional shared inbox) so the
 * delivery slice can fan a user's public posts out to them, and record whether
 * we have accepted their Follow.
 */
import { query } from './connection.ts'

export interface FeedFollowerRecord {
  actor_uri: string
  inbox_uri: string
  shared_inbox_uri: string | null
  accepted: boolean
  created_at: Date
}

export interface FeedFollowerInput {
  actor_uri: string
  inbox_uri: string
  shared_inbox_uri?: string | null
  accepted?: boolean
}

const FEED_FOLLOWER_COLUMNS = 'actor_uri, inbox_uri, shared_inbox_uri, accepted, created_at'

/**
 * Insert or update a follower by actor URI. Re-following (or a re-delivered
 * Follow) updates the cached inboxes and acceptance flag without duplicating.
 */
export const upsertFeedFollower = async (
  user: string,
  input: FeedFollowerInput,
): Promise<FeedFollowerRecord> => {
  const result = await query<FeedFollowerRecord>(
    user,
    `INSERT INTO feed_follower (actor_uri, inbox_uri, shared_inbox_uri, accepted)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (actor_uri)
     DO UPDATE SET inbox_uri = EXCLUDED.inbox_uri,
                   shared_inbox_uri = EXCLUDED.shared_inbox_uri,
                   accepted = EXCLUDED.accepted
     RETURNING ${FEED_FOLLOWER_COLUMNS}`,
    [input.actor_uri, input.inbox_uri, input.shared_inbox_uri ?? null, input.accepted ?? false],
  )
  return result.rows[0]
}

export const listFeedFollowers = async (user: string): Promise<FeedFollowerRecord[]> => {
  const result = await query<FeedFollowerRecord>(
    user,
    `SELECT ${FEED_FOLLOWER_COLUMNS} FROM feed_follower ORDER BY created_at ASC`,
  )
  return result.rows
}

/** Count followers without loading their rows (for the followers-collection counter). */
export const countFeedFollowers = async (user: string): Promise<number> => {
  const result = await query<{ count: string }>(user, `SELECT COUNT(*)::text AS count FROM feed_follower`)
  return Number(result.rows[0].count)
}

/** Remove a follower by actor URI (e.g. on an Undo{Follow}). */
export const removeFeedFollower = async (user: string, actorUri: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM feed_follower WHERE actor_uri = $1`, [actorUri])
  return (result.rowCount ?? 0) > 0
}
