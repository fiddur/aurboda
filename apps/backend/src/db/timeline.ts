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
import type { FeedStructuredPost, TimelineImage } from '@aurboda/api-spec'

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
  /** The `inReplyTo` object id when the post is a reply, or null for a top-level post. */
  in_reply_to_uri: string | null
  /** Native structured payload from an Aurboda peer, or null for non-Aurboda posts. */
  structured: FeedStructuredPost | null
  /** Image attachments (rendered chart / route map, or a Mastodon photo), or null. */
  images: TimelineImage[] | null
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
  /** The `inReplyTo` object id when the post is a reply. */
  in_reply_to_uri?: string | null
  /** Native structured payload fetched from an Aurboda peer on ingest, if any. */
  structured?: FeedStructuredPost | null
  /** Image attachments captured from the delivered Note, if any. */
  images?: TimelineImage[] | null
}

/** Opaque keyset cursor: the last row's `(published_at, id)`. */
export interface TimelineCursor {
  published_at: Date
  id: string
}

const TIMELINE_COLUMNS =
  'id, object_uri, actor_uri, handle, display_name, avatar_url, content, url, published_at, received_at, in_reply_to_uri, structured, images'

/**
 * Insert or update a received post by `object_uri`. A re-delivered or edited post
 * (same object id) refreshes the content/presentation in place; `received_at`
 * stays at first receipt while `published_at` tracks the remote timestamp.
 *
 * `inserted` distinguishes a brand-new post from an in-place refresh via the
 * `xmax = 0` trick (freshly-inserted tuples have xmax 0; the ON CONFLICT update
 * path locks the existing row, so its xmax is non-zero). The ingest path uses it
 * to notify live subscribers only about genuinely new posts, not edits.
 */
export const upsertTimelineEntry = async (
  user: string,
  input: TimelineEntryInput,
): Promise<TimelineEntryRecord & { inserted: boolean }> => {
  const result = await query<TimelineEntryRecord & { inserted: boolean }>(
    user,
    `INSERT INTO timeline_entry
       (object_uri, actor_uri, handle, display_name, avatar_url, content, url, published_at, in_reply_to_uri, structured, images)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     ON CONFLICT (object_uri)
     DO UPDATE SET actor_uri = EXCLUDED.actor_uri,
                   handle = EXCLUDED.handle,
                   display_name = EXCLUDED.display_name,
                   avatar_url = EXCLUDED.avatar_url,
                   content = EXCLUDED.content,
                   url = EXCLUDED.url,
                   published_at = EXCLUDED.published_at,
                   in_reply_to_uri = EXCLUDED.in_reply_to_uri,
                   -- Keep the last-known structured payload if a refresh/edit
                   -- couldn't re-fetch it (transient enrich failure), rather
                   -- than wiping a working chart.
                   structured = COALESCE(EXCLUDED.structured, timeline_entry.structured),
                   -- images always arrives as a concrete array from the ingest
                   -- path, so this COALESCE never actually preserves a prior value
                   -- (an edit that drops attachments clears them) -- it is defensive
                   -- parity with structured for any caller that omits the field.
                   images = COALESCE(EXCLUDED.images, timeline_entry.images)
     RETURNING ${TIMELINE_COLUMNS}, (xmax = 0) AS inserted`,
    [
      input.object_uri,
      input.actor_uri,
      input.handle ?? null,
      input.display_name ?? null,
      input.avatar_url ?? null,
      input.content,
      input.url ?? null,
      input.published_at,
      input.in_reply_to_uri ?? null,
      input.structured == null ? null : JSON.stringify(input.structured),
      input.images == null ? null : JSON.stringify(input.images),
    ],
  )
  return result.rows[0]
}

/** Reply visibility for a timeline page (from the `timeline_show_replies` setting). */
export interface TimelineReplyFilter {
  /** When false, replies to OTHER people's posts are excluded from the page. */
  show_replies: boolean
  /**
   * URI prefix of the reader's OWN post objects (`{origin}/users/{me}/feed/`):
   * a reply whose target starts with it is a reply to the reader and always
   * shows. LIKE wildcards in it are escaped here.
   */
  own_object_prefix: string
}

const escapeLike = (s: string): string => s.replaceAll(/[%_\\]/g, (c) => `\\${c}`)

/**
 * A page of the home timeline, newest first. Keyset-paginated: pass the previous
 * page's last `(published_at, id)` as `before` to get the next page. Returns up
 * to `limit` rows. Filtering happens in SQL (not post-hoc) so pages stay full
 * and cursors stable whatever the reply setting.
 */
export const listTimelineEntries = async (
  user: string,
  limit: number,
  before?: TimelineCursor,
  replies?: TimelineReplyFilter,
): Promise<TimelineEntryRecord[]> => {
  const result = await query<TimelineEntryRecord>(
    user,
    `SELECT ${TIMELINE_COLUMNS} FROM timeline_entry
     WHERE ($1::timestamptz IS NULL OR (published_at, id) < ($1::timestamptz, $2::uuid))
       AND ($4::boolean OR in_reply_to_uri IS NULL OR in_reply_to_uri LIKE $5)
     ORDER BY published_at DESC, id DESC
     LIMIT $3`,
    [
      before?.published_at ?? null,
      before?.id ?? null,
      limit,
      replies?.show_replies ?? true,
      replies == null ? '' : `${escapeLike(replies.own_object_prefix)}%`,
    ],
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

/** The fields a lazy retro-enrichment attempt needs (#996). */
export interface UnenrichedTimelineEntry {
  id: string
  object_uri: string
  images: TimelineImage[] | null
}

/**
 * Aurboda-shaped entries with no structured payload and no retro-enrichment
 * attempt yet, newest first (#996): entries ingested before enrichment shipped,
 * or whose ingest-time enrichment failed transiently. The LIKE is a coarse SQL
 * prefilter — the service re-validates with `parseAurbodaFeedUrl` before
 * fetching anything.
 */
export const listUnenrichedAurbodaEntries = async (
  user: string,
  limit: number,
): Promise<UnenrichedTimelineEntry[]> => {
  const result = await query<UnenrichedTimelineEntry>(
    user,
    `SELECT id, object_uri, images FROM timeline_entry
     WHERE structured IS NULL AND enrich_attempted_at IS NULL
       AND object_uri LIKE '%/users/%/feed/%'
     ORDER BY published_at DESC, id DESC
     LIMIT $1`,
    [limit],
  )
  return result.rows
}

/**
 * Record a retro-enrichment attempt (#996): store the payload when one was
 * obtained (never overwrite an existing one with NULL) and stamp
 * `enrich_attempted_at` either way, so an entry is retried at most once — a
 * later `Update` redelivery still re-enriches through the ingest path.
 */
export const setTimelineEntryStructured = async (
  user: string,
  id: string,
  structured: FeedStructuredPost | null,
): Promise<void> => {
  await query(
    user,
    `UPDATE timeline_entry
     SET structured = COALESCE($2, structured), enrich_attempted_at = NOW()
     WHERE id = $1`,
    [id, structured == null ? null : JSON.stringify(structured)],
  )
}

/**
 * Record a TRANSIENT retro-enrichment failure (#1014): bump the attempt counter
 * and, once `maxAttempts` is reached, stamp `enrich_attempted_at` so the entry
 * leaves the candidate set — a permanently unreachable peer must not hold the
 * head of the newest-first retry queue forever. Below the cap the entry stays
 * eligible for a later read's retry.
 */
export const markEnrichTransientFailure = async (
  user: string,
  id: string,
  maxAttempts: number,
): Promise<void> => {
  await query(
    user,
    `UPDATE timeline_entry
     SET enrich_attempts = enrich_attempts + 1,
         enrich_attempted_at = CASE WHEN enrich_attempts + 1 >= $2 THEN NOW() ELSE enrich_attempted_at END
     WHERE id = $1`,
    [id, maxAttempts],
  )
}
