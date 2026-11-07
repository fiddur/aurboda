/**
 * Article drafts, shared by the REST `/feed/article-drafts` routes and the MCP
 * draft tools. A draft is private and may be incomplete; publishing validates
 * it exactly like `POST /feed/articles` and only then turns it into a post.
 */
import type {
  ArticleDraft,
  ArticleDraftContent,
  CreateArticleBody,
  FeedVisibility,
  PublishArticleDraftBody,
  UpdateArticleDraftBody,
} from '@aurboda/api-spec'

import { createArticleBodySchema } from '@aurboda/api-spec'

import type { ArticleDraftPatch, ArticleDraftRecord, ArticlePostInput, FeedPostRecord } from '../db/index.ts'

import { createArticlePost, deleteArticleDraft, getArticleDraft } from '../db/index.ts'
import { buildArticleContent, mergeArticleContent } from './article.ts'

export const emptyArticleDraftContent = (): ArticleDraftContent => ({ blocks: [], title: '' })

export const serializeArticleDraft = (record: ArticleDraftRecord): ArticleDraft => ({
  article: record.article,
  created_at: record.created_at.toISOString(),
  id: record.id,
  updated_at: record.updated_at.toISOString(),
  visibility: record.visibility,
})

/**
 * The DB patch for an update body: the merged content when any content field is
 * given, plus visibility. A `null` default window bound clears the stored one;
 * an omitted one keeps it.
 */
export const articleDraftPatch = (
  existing: ArticleDraftContent,
  body: UpdateArticleDraftBody,
): ArticleDraftPatch => {
  const { default_end, default_start, visibility, ...rest } = body
  const touchesContent = [...Object.values(rest), default_start, default_end].some((v) => v !== undefined)
  if (!touchesContent) return visibility ? { visibility } : {}
  const merged: ArticleDraftContent = mergeArticleContent(existing, {
    ...rest,
    ...(default_start ? { default_start } : {}),
    ...(default_end ? { default_end } : {}),
  })
  if (default_start === null) delete merged.default_start
  if (default_end === null) delete merged.default_end
  return { article: merged, ...(visibility ? { visibility } : {}) }
}

/** The friendliest message for what keeps a draft from publishing, before the schema's own wording. */
const incompleteDraftError = (content: ArticleDraftContent): string | null => {
  if (!content.title.trim()) return 'Give the article a title before publishing.'
  for (const [i, block] of content.blocks.entries()) {
    if (block.type === 'chart' && block.metric === undefined) {
      return `Chart block ${i + 1} has no metric — pick one before publishing.`
    }
    if (block.type === 'correlation' && (block.trigger === undefined || block.outcome === undefined)) {
      return `Correlation block ${i + 1} needs both a trigger and an outcome before publishing.`
    }
  }
  return null
}

export type PublishableResult = { ok: true; input: ArticlePostInput } | { ok: false; error: string }

/**
 * Validate draft content as a publishable article: the same schema and window
 * checks `POST /feed/articles` applies. Pure.
 */
export const publishableArticle = (
  content: ArticleDraftContent,
  visibility: FeedVisibility,
): PublishableResult => {
  const incomplete = incompleteDraftError(content)
  if (incomplete) return { error: incomplete, ok: false }
  const parsed = createArticleBodySchema.safeParse({ ...content, title: content.title.trim(), visibility })
  if (!parsed.success) {
    const error = parsed.error.issues
      .map((issue) => (issue.path.length ? `${issue.path.join('.')}: ${issue.message}` : issue.message))
      .join('; ')
    return { error, ok: false }
  }
  const body: CreateArticleBody = parsed.data
  const built = buildArticleContent({
    blocks: body.blocks,
    default_end: body.default_end,
    default_start: body.default_start,
    title: body.title,
  })
  if (!built.ok) return built
  return { input: { article: built.article, visibility: body.visibility }, ok: true }
}

export interface PublishDraftDeps {
  getDraft: (user: string, id: string) => Promise<ArticleDraftRecord | null>
  createPost: (user: string, input: ArticlePostInput) => Promise<FeedPostRecord>
  deleteDraft: (user: string, id: string) => Promise<boolean>
  logError: (message: string, error: unknown) => void
}

const defaultDeps: PublishDraftDeps = {
  createPost: (user, input) => createArticlePost(user, input),
  deleteDraft: (user, id) => deleteArticleDraft(user, id),
  getDraft: (user, id) => getArticleDraft(user, id),
  logError: (message, error) => console.error(message, error),
}

export type PublishDraftResult =
  | { ok: true; post: FeedPostRecord }
  | { ok: false; status: 400 | 404; error: string }

/**
 * Publish a draft: validate, create the article post, then delete the draft.
 * An invalid draft is kept untouched. A failed delete after the post exists is
 * logged, not rolled back — the article is already out, and a leftover draft is
 * harmless. The caller federates the returned post.
 */
export const publishArticleDraft = async (
  user: string,
  id: string,
  body: PublishArticleDraftBody,
  deps: PublishDraftDeps = defaultDeps,
): Promise<PublishDraftResult> => {
  const draft = await deps.getDraft(user, id)
  if (!draft) return { error: 'Draft not found', ok: false, status: 404 }
  const publishable = publishableArticle(draft.article, body.visibility ?? draft.visibility)
  if (!publishable.ok) return { error: publishable.error, ok: false, status: 400 }
  const post = await deps.createPost(user, publishable.input)
  try {
    await deps.deleteDraft(user, id)
  } catch (error) {
    deps.logError(`⚠️ Published draft ${id} for ${user} but could not delete it:`, error)
  }
  return { ok: true, post }
}
