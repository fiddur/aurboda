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
