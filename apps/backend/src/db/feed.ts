import type { ArticleContent, FeedPostKind, FeedVisibility } from '@aurboda/api-spec'

/**
 * Feed posts — activities a user published to their federated feed.
 *
 * Posts live in the user's own database. Each records the explicit metric
 * selection that bounds what leaves the instance: `included_metrics` (scalar
 * summaries) and `series_metrics` (high-resolution opt-in). The latter is the
 * authorization set the public `/series` endpoint checks against.
 *
 * `activity_id` is a soft reference (no FK): activities are soft-deleted and the
 * series lookup re-checks `deleted_at`, so a removed activity simply stops
 * resolving rather than cascading a delete.
 */
import { query } from './connection.ts'

export interface FeedPostRecord {
  id: string
  /** `activity` (shares an activity) or `article` (long-form prose + chart blocks). */
  kind: FeedPostKind
  activity_id: string | null
  included_metrics: string[]
  series_metrics: string[]
  visibility: FeedVisibility
  include_map: boolean
  include_chart: boolean
  /** Stored article payload (title + default window + blocks); null for `activity` posts. */
  article: ArticleContent | null
  /** The author's personal message (plain text), or null when none was shared. */
  message: string | null
  /** Unguessable capability token for `followers`-only image URLs (see schema). */
  image_token: string
  created_at: Date
  updated_at: Date
}

export interface FeedPostInput {
  activity_id: string | null
  included_metrics: string[]
  series_metrics: string[]
  visibility: FeedVisibility
  include_map: boolean
  include_chart: boolean
  /** The author's personal message; omitted/undefined stores NULL. */
  message?: string | null
}

/** Input for creating an `article` post (no activity anchor / shared metrics). */
export interface ArticlePostInput {
  visibility: FeedVisibility
  article: ArticleContent
}

export interface FeedPostPatch {
  included_metrics?: string[]
  series_metrics?: string[]
  visibility?: FeedVisibility
  include_map?: boolean
  include_chart?: boolean
  /** Replacement article payload (whole `article` JSONB), for editing an article post. */
  article?: ArticleContent
  /** Replacement personal message; `null` clears it, `undefined` leaves it unchanged. */
  message?: string | null
}

const FEED_POST_COLUMNS =
  'id, kind, activity_id, included_metrics, series_metrics, visibility, include_map, include_chart, article, message, image_token, created_at, updated_at'

interface FeedPostRow {
  id: string
  kind: FeedPostKind
  activity_id: string | null
  included_metrics: string[]
  series_metrics: string[]
  visibility: FeedVisibility
  include_map: boolean
  include_chart: boolean
  // pg parses a jsonb column to its JS value on read (null for `activity` posts).
  article: ArticleContent | null
  message: string | null
  image_token: string
  created_at: Date
  updated_at: Date
}

const mapFeedPost = (row: FeedPostRow): FeedPostRecord => ({ ...row })

export const createFeedPost = async (user: string, input: FeedPostInput): Promise<FeedPostRecord> => {
  const result = await query<FeedPostRow>(
    user,
    `INSERT INTO feed_posts
       (activity_id, included_metrics, series_metrics, visibility, include_map, include_chart, message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING ${FEED_POST_COLUMNS}`,
    [
      input.activity_id,
      input.included_metrics,
      input.series_metrics,
      input.visibility,
      input.include_map,
      input.include_chart,
      input.message ?? null,
    ],
  )
  return mapFeedPost(result.rows[0])
}

/**
 * Create an `article` post: no activity anchor and no shared metrics, just the
 * article payload (title + default window + blocks) in the `article` JSONB. The
 * `kind`/`activity_id`/metric columns fall to their table defaults where not set.
 */
export const createArticlePost = async (user: string, input: ArticlePostInput): Promise<FeedPostRecord> => {
  const result = await query<FeedPostRow>(
    user,
    `INSERT INTO feed_posts (kind, visibility, article)
     VALUES ('article', $1, $2)
     RETURNING ${FEED_POST_COLUMNS}`,
    [input.visibility, JSON.stringify(input.article)],
  )
  return mapFeedPost(result.rows[0])
}

export const listFeedPosts = async (user: string): Promise<FeedPostRecord[]> => {
  const result = await query<FeedPostRow>(
    user,
    // `id` tiebreaker keeps ordering deterministic when two posts share a
    // `created_at` (microsecond collision on rapid inserts).
    `SELECT ${FEED_POST_COLUMNS} FROM feed_posts ORDER BY created_at DESC, id DESC`,
  )
  return result.rows.map(mapFeedPost)
}

/**
 * Posts that appear on the public outbox / actor profile: `public` and
 * `unlisted` (both addressed to the AS2 Public collection). `followers`-only
 * posts are never listed here. Same deterministic newest-first ordering as
 * `listFeedPosts`.
 */
export const listPublicFeedPosts = async (user: string): Promise<FeedPostRecord[]> => {
  const result = await query<FeedPostRow>(
    user,
    `SELECT ${FEED_POST_COLUMNS} FROM feed_posts
      WHERE visibility IN ('public', 'unlisted')
      ORDER BY created_at DESC, id DESC`,
  )
  return result.rows.map(mapFeedPost)
}

/**
 * One page of public outbox posts, newest-first, for the cursor-paginated
 * ActivityPub outbox. `limit`/`offset` are clamped by the caller.
 */
export const listPublicFeedPostsPage = async (
  user: string,
  limit: number,
  offset: number,
): Promise<FeedPostRecord[]> => {
  const result = await query<FeedPostRow>(
    user,
    `SELECT ${FEED_POST_COLUMNS} FROM feed_posts
      WHERE visibility IN ('public', 'unlisted')
      ORDER BY created_at DESC, id DESC
      LIMIT $1 OFFSET $2`,
    [limit, offset],
  )
  return result.rows.map(mapFeedPost)
}

/** Total number of posts on the public outbox (see `listPublicFeedPosts`). */
export const countPublicFeedPosts = async (user: string): Promise<number> => {
  const result = await query<{ count: number }>(
    user,
    `SELECT count(*)::int AS count FROM feed_posts WHERE visibility IN ('public', 'unlisted')`,
  )
  return Number(result.rows[0]?.count ?? 0)
}

export const getFeedPostById = async (user: string, id: string): Promise<FeedPostRecord | null> => {
  const result = await query<FeedPostRow>(user, `SELECT ${FEED_POST_COLUMNS} FROM feed_posts WHERE id = $1`, [
    id,
  ])
  return result.rows.length ? mapFeedPost(result.rows[0]) : null
}

export const updateFeedPost = async (
  user: string,
  id: string,
  patch: FeedPostPatch,
): Promise<FeedPostRecord | null> => {
  const sets: string[] = []
  const params: unknown[] = []
  let idx = 1
  const set = (col: string, value: unknown) => {
    sets.push(`${col} = $${idx++}`)
    params.push(value)
  }

  if (patch.included_metrics !== undefined) set('included_metrics', patch.included_metrics)
  if (patch.series_metrics !== undefined) set('series_metrics', patch.series_metrics)
  if (patch.visibility !== undefined) set('visibility', patch.visibility)
  if (patch.include_map !== undefined) set('include_map', patch.include_map)
  if (patch.include_chart !== undefined) set('include_chart', patch.include_chart)
  if (patch.article !== undefined) set('article', JSON.stringify(patch.article))
  if (patch.message !== undefined) set('message', patch.message)

  if (sets.length === 0) return getFeedPostById(user, id)

  sets.push('updated_at = NOW()')
  params.push(id)
  const result = await query<FeedPostRow>(
    user,
    `UPDATE feed_posts SET ${sets.join(', ')} WHERE id = $${idx} RETURNING ${FEED_POST_COLUMNS}`,
    params,
  )
  return result.rows.length ? mapFeedPost(result.rows[0]) : null
}

/**
 * Delete a feed post and, if it was `public`/`unlisted` (so its object id was
 * publicly dereferenceable), record a tombstone in the same statement so a later
 * GET of that id can return `410 Gone` instead of `404`. Atomic: the delete and
 * the tombstone insert commit together. `followers`-only posts leave no tombstone
 * — their id never resolved publicly, so a 410 would leak that a post existed.
 * Idempotent via `ON CONFLICT` (re-deleting a since-recreated id is a no-op).
 */
export const deleteFeedPost = async (user: string, id: string): Promise<boolean> => {
  const result = await query<{ id: string }>(
    user,
    `WITH deleted AS (
       DELETE FROM feed_posts WHERE id = $1
       RETURNING id, visibility
     ), tomb AS (
       INSERT INTO feed_tombstone (post_id)
       SELECT id FROM deleted WHERE visibility IN ('public', 'unlisted')
       ON CONFLICT (post_id) DO NOTHING
     )
     SELECT id FROM deleted`,
    [id],
  )
  return result.rows.length > 0
}

/**
 * The tombstone for a deleted public/unlisted post, or null if the id was never
 * publicly shared (or is still live). Backs the `410 Gone` object dereference.
 */
export const getFeedTombstone = async (
  user: string,
  postId: string,
): Promise<{ deleted_at: Date } | null> => {
  const result = await query<{ deleted_at: Date }>(
    user,
    `SELECT deleted_at FROM feed_tombstone WHERE post_id = $1`,
    [postId],
  )
  return result.rows.length ? result.rows[0] : null
}

/**
 * The window of a shared activity that authorizes a public series request, or
 * null if none does. Resolves only when some non-`followers` feed post shared
 * `metric` as a series for a non-deleted, bounded activity whose window covers
 * `[start, end]`. This is the whole privacy boundary for the unauthenticated
 * `/series` endpoint, so the conditions are strict:
 *
 * - the metric must be in `series_metrics` (scalar sharing alone never exposes a series),
 * - the post must be `public` or `unlisted` (`followers` posts have no public series),
 * - the activity must not be soft-deleted and must have an `end_time`,
 * - the activity window must fully cover the requested range.
 */
export const findCoveringSharedSeriesWindow = async (
  user: string,
  metric: string,
  start: Date,
  end: Date,
): Promise<{ start_time: Date; end_time: Date } | null> => {
  const result = await query<{ start_time: Date; end_time: Date }>(
    user,
    `SELECT a.start_time, a.end_time
       FROM feed_posts f
       JOIN activities a ON a.id = f.activity_id
      WHERE $1 = ANY(f.series_metrics)
        AND f.visibility IN ('public', 'unlisted')
        AND a.deleted_at IS NULL
        AND a.end_time IS NOT NULL
        AND a.start_time <= $2
        AND a.end_time >= $3
      ORDER BY a.start_time
      LIMIT 1`,
    [metric, start, end],
  )
  return result.rows.length ? result.rows[0] : null
}
