/**
 * The user's home timeline: posts received from the actors they follow (inbound
 * ActivityPub `Create`, replaced on `Update`, removed on `Delete`).
 *
 * Stored per-user, keyed by a local `id`, with the remote Note's id as a UNIQUE
 * `object_uri` so a re-delivery or edit upserts rather than duplicating. `content`
 * is the remote HTML **after** server-side sanitisation (the ingest path is
 * responsible for cleaning untrusted fediverse HTML before it reaches here).
 * Ordering + pagination is keyset by `(published_at DESC, id DESC)`.
 */
import { query } from './connection.ts'

export interface TimelineEntryRecord {
  id: string
  object_uri: string
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  content: string
  url: string | null
  published_at: Date
  received_at: Date
}

export interface TimelineEntryInput {
  object_uri: string
  actor_uri: string
  handle?: string | null
  display_name?: string | null
  avatar_url?: string | null
  /** Already-sanitised HTML. */
  content: string
  url?: string | null
  published_at: Date
}

/** Opaque keyset cursor: the last row's `(published_at, id)`. */
export interface TimelineCursor {
  published_at: Date
  id: string
}

const TIMELINE_COLUMNS =
  'id, object_uri, actor_uri, handle, display_name, avatar_url, content, url, published_at, received_at'

/**
 * Insert or update a received post by `object_uri`. A re-delivered or edited post
 * (same object id) refreshes the content/presentation in place; `received_at`
 * stays at first receipt while `published_at` tracks the remote timestamp.
 */
export const upsertTimelineEntry = async (
  user: string,
  input: TimelineEntryInput,
): Promise<TimelineEntryRecord> => {
  const result = await query<TimelineEntryRecord>(
    user,
    `INSERT INTO timeline_entry
       (object_uri, actor_uri, handle, display_name, avatar_url, content, url, published_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (object_uri)
     DO UPDATE SET actor_uri = EXCLUDED.actor_uri,
                   handle = EXCLUDED.handle,
                   display_name = EXCLUDED.display_name,
                   avatar_url = EXCLUDED.avatar_url,
                   content = EXCLUDED.content,
                   url = EXCLUDED.url,
                   published_at = EXCLUDED.published_at
     RETURNING ${TIMELINE_COLUMNS}`,
    [
      input.object_uri,
      input.actor_uri,
      input.handle ?? null,
      input.display_name ?? null,
      input.avatar_url ?? null,
      input.content,
      input.url ?? null,
      input.published_at,
    ],
  )
  return result.rows[0]
}

/**
 * A page of the home timeline, newest first. Keyset-paginated: pass the previous
 * page's last `(published_at, id)` as `before` to get the next page. Returns up
 * to `limit` rows.
 */
export const listTimelineEntries = async (
  user: string,
  limit: number,
  before?: TimelineCursor,
): Promise<TimelineEntryRecord[]> => {
  const result = await query<TimelineEntryRecord>(
    user,
    `SELECT ${TIMELINE_COLUMNS} FROM timeline_entry
     WHERE ($1::timestamptz IS NULL OR (published_at, id) < ($1::timestamptz, $2::uuid))
     ORDER BY published_at DESC, id DESC
     LIMIT $3`,
    [before?.published_at ?? null, before?.id ?? null, limit],
  )
  return result.rows
}

/**
 * Remove a received post by its remote object id (on an inbound `Delete`), scoped
 * to the actor that authored it. The `actor_uri` guard is an authorization check:
 * an inbound `Delete` is only signed by *some* actor, so without it any actor
 * could evict another author's post from the timeline by its (guessable) id.
 */
export const deleteTimelineEntryByUri = async (
  user: string,
  objectUri: string,
  actorUri: string,
): Promise<boolean> => {
  const result = await query(user, `DELETE FROM timeline_entry WHERE object_uri = $1 AND actor_uri = $2`, [
    objectUri,
    actorUri,
  ])
  return (result.rowCount ?? 0) > 0
}

/**
 * Remove every received post authored by an actor (on `Undo{Follow}`/unfollow, so
 * an unfollowed actor's posts leave the timeline).
 */
export const deleteTimelineEntriesByActor = async (user: string, actorUri: string): Promise<number> => {
  const result = await query(user, `DELETE FROM timeline_entry WHERE actor_uri = $1`, [actorUri])
  return result.rowCount ?? 0
}
