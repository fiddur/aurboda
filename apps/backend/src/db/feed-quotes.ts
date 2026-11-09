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

/** A redelivered request for the same quote returns the same row, so the same stamp id. */
export const upsertFeedQuoteAuthorization = async (
  user: string,
  input: FeedQuoteAuthorizationInput,
): Promise<FeedQuoteAuthorizationRecord> => {
  const result = await query<FeedQuoteAuthorizationRecord>(
    user,
    `INSERT INTO feed_quote_authorization (post_id, quote_uri, actor_uri, request_uri)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (post_id, quote_uri) DO UPDATE SET actor_uri = EXCLUDED.actor_uri, request_uri = EXCLUDED.request_uri
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
