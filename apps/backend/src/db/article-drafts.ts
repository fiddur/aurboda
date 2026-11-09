import type { ArticleDraftContent, FeedVisibility } from '@aurboda/api-spec'

import type { ArticlePostInput, FeedPostRecord } from './feed.ts'

import { query, withUserTransaction } from './connection.ts'
import { createArticlePost } from './feed.ts'

export interface ArticleDraftRecord {
  id: string
  article: ArticleDraftContent
  visibility: FeedVisibility
  created_at: Date
  updated_at: Date
}

export interface ArticleDraftInput {
  article: ArticleDraftContent
  visibility: FeedVisibility
}

export interface ArticleDraftPatch {
  article?: ArticleDraftContent
  visibility?: FeedVisibility
}

const COLUMNS = 'id, article, visibility, created_at, updated_at'

export const createArticleDraft = async (
  user: string,
  input: ArticleDraftInput,
): Promise<ArticleDraftRecord> => {
  const result = await query<ArticleDraftRecord>(
    user,
    `INSERT INTO article_drafts (article, visibility) VALUES ($1, $2) RETURNING ${COLUMNS}`,
    [JSON.stringify(input.article), input.visibility],
  )
  return result.rows[0]
}

export const getArticleDraft = async (user: string, id: string): Promise<ArticleDraftRecord | null> => {
  const result = await query<ArticleDraftRecord>(
    user,
    `SELECT ${COLUMNS} FROM article_drafts WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export const listArticleDrafts = async (user: string): Promise<ArticleDraftRecord[]> => {
  const result = await query<ArticleDraftRecord>(
    user,
    `SELECT ${COLUMNS} FROM article_drafts ORDER BY updated_at DESC, id DESC`,
  )
  return result.rows
}

/** Replace the provided columns and bump `updated_at`; null when the draft does not exist. */
export const updateArticleDraft = async (
  user: string,
  id: string,
  patch: ArticleDraftPatch,
): Promise<ArticleDraftRecord | null> => {
  const result = await query<ArticleDraftRecord>(
    user,
    `UPDATE article_drafts
        SET article = COALESCE($2::jsonb, article),
            visibility = COALESCE($3, visibility),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [id, patch.article === undefined ? null : JSON.stringify(patch.article), patch.visibility ?? null],
  )
  return result.rows[0] ?? null
}

export const deleteArticleDraft = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM article_drafts WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

export type DraftPostPreparation = { ok: true; input: ArticlePostInput } | { ok: false; error: string }

export type DraftPublishOutcome =
  | { status: 'published'; post: FeedPostRecord }
  | { status: 'missing' }
  | { status: 'rejected'; error: string }

const ROLLBACK = new Error('article draft publish rejected')

/**
 * Turn a draft into an article post in one transaction: the draft is removed
 * (`DELETE … RETURNING`, so of concurrent publishes exactly one gets it),
 * `prepare` derives the post from the removed row, and the post is inserted.
 * A rejection from `prepare`, or any failure before commit, rolls back and
 * leaves the draft as it was. `prepare` runs while the transaction holds a
 * connection, so it must not wait on the network and should not take further
 * connections from the pool.
 */
export const publishArticleDraftPost = async (
  user: string,
  id: string,
  prepare: (draft: ArticleDraftRecord) => Promise<DraftPostPreparation>,
): Promise<DraftPublishOutcome> => {
  let rejection: string | undefined
  try {
    return await withUserTransaction(user, async (tx): Promise<DraftPublishOutcome> => {
      const claimed = await query<ArticleDraftRecord>(
        tx,
        `DELETE FROM article_drafts WHERE id = $1 RETURNING ${COLUMNS}`,
        [id],
      )
      const draft = claimed.rows[0]
      if (!draft) return { status: 'missing' }
      const prepared = await prepare(draft)
      if (!prepared.ok) {
        rejection = prepared.error
        throw ROLLBACK
      }
      return { post: await createArticlePost(tx, prepared.input), status: 'published' }
    })
  } catch (error) {
    if (error === ROLLBACK && rejection !== undefined) return { error: rejection, status: 'rejected' }
    throw error
  }
}
