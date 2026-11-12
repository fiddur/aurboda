/**
 * FEP-044f quote approvals on the user's own posts. A row is written when a
 * remote server's `QuoteRequest` for a public/unlisted post is accepted; its
 * `id` mints the `QuoteAuthorization` stamp URL served under the user's actor,
 * which is what other servers fetch to verify the quote is allowed.
 */
import { query } from './connection.ts'

export interface FeedQuoteAuthorizationRecord {
  id: string
  post_id: string
  quote_uri: string
  actor_uri: string
  request_uri: string | null
  created_at: Date
}

export interface FeedQuoteAuthorizationInput {
  post_id: string
  quote_uri: string
  actor_uri: string
  request_uri: string | null
}

const FEED_QUOTE_AUTHORIZATION_COLUMNS = 'id, post_id, quote_uri, actor_uri, request_uri, created_at'

/**
 * A redelivered request for the same quote returns the same row, so the same stamp id. The
 * first request's actor and request id stay: a later one cannot re-attribute the approval.
 * The no-op `DO UPDATE` (not `DO NOTHING`) is what makes `RETURNING` yield the existing row.
 */
export const upsertFeedQuoteAuthorization = async (
  user: string,
  input: FeedQuoteAuthorizationInput,
): Promise<FeedQuoteAuthorizationRecord> => {
  const result = await query<FeedQuoteAuthorizationRecord>(
    user,
    `INSERT INTO feed_quote_authorization (post_id, quote_uri, actor_uri, request_uri)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (post_id, quote_uri) DO UPDATE SET post_id = feed_quote_authorization.post_id
     RETURNING ${FEED_QUOTE_AUTHORIZATION_COLUMNS}`,
    [input.post_id, input.quote_uri, input.actor_uri, input.request_uri],
  )
  return result.rows[0]
}

export const getFeedQuoteAuthorization = async (
  user: string,
  id: string,
): Promise<FeedQuoteAuthorizationRecord | null> => {
  const result = await query<FeedQuoteAuthorizationRecord>(
    user,
    `SELECT ${FEED_QUOTE_AUTHORIZATION_COLUMNS} FROM feed_quote_authorization WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export const listFeedQuoteAuthorizations = async (
  user: string,
  postId: string,
): Promise<FeedQuoteAuthorizationRecord[]> => {
  const result = await query<FeedQuoteAuthorizationRecord>(
    user,
    `SELECT ${FEED_QUOTE_AUTHORIZATION_COLUMNS} FROM feed_quote_authorization
     WHERE post_id = $1 ORDER BY created_at ASC, id ASC`,
    [postId],
  )
  return result.rows
}

export interface FeedPostQuoteRecord {
  actor_uri: string
  quote_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  created_at: Date
}

const QUOTER_PRESENTATION_SOURCES = [
  'feed_follower',
  'feed_following',
  'feed_post_reaction',
  'timeline_entry',
]

const quoterPresentationFrom = (table: string, handleRequired: boolean) =>
  `(SELECT jsonb_build_object('handle', handle, 'display_name', display_name, 'avatar_url', avatar_url)
    FROM ${table} WHERE actor_uri = q.actor_uri${handleRequired ? ' AND handle IS NOT NULL' : ''} LIMIT 1)`

/**
 * `COALESCE` evaluates its arguments lazily, so a later source is only read when every earlier one
 * came up empty: a row with a handle in priority order first, then any row at all.
 */
const QUOTER_PRESENTATION = `COALESCE(${[true, false]
  .flatMap((handleRequired) =>
    QUOTER_PRESENTATION_SOURCES.map((table) => quoterPresentationFrom(table, handleRequired)),
  )
  .join(', ')})`

/**
 * Who quoted one of the user's posts, newest first (capped by `limit`). The approval row stores no
 * presentation: the quoting actor's handle, name and avatar are read from whichever local row
 * already caches that actor (follower, followee, reactor, timeline author), so an `Update{Person}`
 * refreshing those is reflected here with nothing to keep in step.
 */
export const listFeedPostQuotes = async (
  user: string,
  postId: string,
  limit: number,
): Promise<FeedPostQuoteRecord[]> => {
  const result = await query<FeedPostQuoteRecord>(
    user,
    `SELECT q.actor_uri, q.quote_uri, q.created_at,
            p.presentation->>'handle' AS handle,
            p.presentation->>'display_name' AS display_name,
            p.presentation->>'avatar_url' AS avatar_url
     FROM feed_quote_authorization q
     CROSS JOIN LATERAL (SELECT ${QUOTER_PRESENTATION} AS presentation) p
     WHERE q.post_id = $1
     ORDER BY q.created_at DESC, q.id DESC
     LIMIT $2`,
    [postId, limit],
  )
  return result.rows
}

/** Revokes every approval on a post, returning the removed rows so their quoting actors can be told. */
export const deleteFeedQuoteAuthorizationsForPost = async (
  user: string,
  postId: string,
): Promise<FeedQuoteAuthorizationRecord[]> => {
  const result = await query<FeedQuoteAuthorizationRecord>(
    user,
    `DELETE FROM feed_quote_authorization WHERE post_id = $1 RETURNING ${FEED_QUOTE_AUTHORIZATION_COLUMNS}`,
    [postId],
  )
  return result.rows
}

/**
 * Drops the approvals of a quoting Note its author deleted. Scoped to the approval's own actor, so a
 * signed `Delete` from anyone else cannot revoke another actor's stamp.
 */
export const deleteFeedQuoteAuthorizationsByQuote = async (
  user: string,
  quoteUri: string,
  actorUri: string,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM feed_quote_authorization WHERE quote_uri = $1 AND actor_uri = $2`,
    [quoteUri, actorUri],
  )
  return result.rowCount ?? 0
}

/** Drops every approval held by an actor, for when the actor itself is deleted. */
export const deleteFeedQuoteAuthorizationsByActor = async (
  user: string,
  actorUri: string,
): Promise<number> => {
  const result = await query(user, `DELETE FROM feed_quote_authorization WHERE actor_uri = $1`, [actorUri])
  return result.rowCount ?? 0
}
