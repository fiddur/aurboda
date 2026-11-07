import type { ArticleDraftContent, FeedVisibility } from '@aurboda/api-spec'

import { query } from './connection.ts'

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

/** Remove a draft and return it, so of concurrent publishes exactly one gets it; null when it is gone. */
export const claimArticleDraft = async (user: string, id: string): Promise<ArticleDraftRecord | null> => {
  const result = await query<ArticleDraftRecord>(
    user,
    `DELETE FROM article_drafts WHERE id = $1 RETURNING ${COLUMNS}`,
    [id],
  )
  return result.rows[0] ?? null
}

/** Put a claimed draft back as it was, same id and timestamps, after its publish failed. */
export const restoreArticleDraft = async (user: string, draft: ArticleDraftRecord): Promise<void> => {
  await query(
    user,
    `INSERT INTO article_drafts (id, article, visibility, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO NOTHING`,
    [draft.id, JSON.stringify(draft.article), draft.visibility, draft.created_at, draft.updated_at],
  )
}
