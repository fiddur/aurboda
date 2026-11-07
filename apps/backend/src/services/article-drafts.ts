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

import { createArticleBodySchema, normalizeTags } from '@aurboda/api-spec'

import type { ArticleDraftPatch, ArticleDraftRecord, ArticlePostInput, FeedPostRecord } from '../db/index.ts'

import { claimArticleDraft, createArticlePost, getArticleDraft, restoreArticleDraft } from '../db/index.ts'
import { buildArticleContent, mergeArticleContent } from './article.ts'
import { articleTexts, resolvePostTags } from './post-tags.ts'

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
 * given, plus visibility. A `null` default window bound or `tags` clears the
 * stored one; an omitted one keeps it.
 */
export const articleDraftPatch = (
  existing: ArticleDraftContent,
  body: UpdateArticleDraftBody,
): ArticleDraftPatch => {
  const { default_end, default_start, tags, visibility, ...rest } = body
  const touchesContent = [...Object.values(rest), default_start, default_end, tags].some(
    (v) => v !== undefined,
  )
  if (!touchesContent) return visibility ? { visibility } : {}
  const merged: ArticleDraftContent = mergeArticleContent(existing, {
    ...rest,
    ...(default_start ? { default_start } : {}),
    ...(default_end ? { default_end } : {}),
  })
  if (default_start === null) delete merged.default_start
  if (default_end === null) delete merged.default_end
  const keptTags = tags === undefined ? existing.tags : tags === null ? undefined : normalizeTags(tags)
  if (keptTags !== undefined) merged.tags = keptTags
  return { article: merged, ...(visibility ? { visibility } : {}) }
}

/** Draft content as stored: its explicit tags normalised. */
export const normalizeArticleDraftContent = (content: ArticleDraftContent): ArticleDraftContent =>
  content.tags === undefined ? content : { ...content, tags: normalizeTags(content.tags) }

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
  /** Atomically remove the draft and return it; null when it is already gone. */
  claimDraft: (user: string, id: string) => Promise<ArticleDraftRecord | null>
  /** Put a claimed draft back unchanged. */
  restoreDraft: (user: string, draft: ArticleDraftRecord) => Promise<void>
  createPost: (user: string, input: ArticlePostInput) => Promise<FeedPostRecord>
  logError: (message: string, error: unknown) => void
  /** The published article's tags; defaults to the owner's default tags (or the draft's) plus typed ones. */
  postTags?: (user: string, content: ArticleDraftContent) => Promise<string[]>
}

const draftPostTags = (user: string, content: ArticleDraftContent): Promise<string[]> =>
  resolvePostTags(user, { explicit: content.tags, texts: articleTexts(content) })

const defaultDeps: PublishDraftDeps = {
  claimDraft: (user, id) => claimArticleDraft(user, id),
  createPost: (user, input) => createArticlePost(user, input),
  getDraft: (user, id) => getArticleDraft(user, id),
  logError: (message, error) => console.error(message, error),
  restoreDraft: (user, draft) => restoreArticleDraft(user, draft),
}

export type PublishDraftResult =
  | { ok: true; post: FeedPostRecord }
  | { ok: false; status: 400 | 404; error: string }

const DRAFT_NOT_FOUND = { error: 'Draft not found', ok: false, status: 404 } as const

/**
 * Publish a draft: validate it, claim it (removing it atomically, so of two
 * concurrent publishes only one creates a post), then create the article post.
 * An invalid draft is never claimed; a failure after the claim puts the draft
 * back as it was. The caller federates the returned post.
 */
export const publishArticleDraft = async (
  user: string,
  id: string,
  body: PublishArticleDraftBody,
  deps: PublishDraftDeps = defaultDeps,
): Promise<PublishDraftResult> => {
  const draft = await deps.getDraft(user, id)
  if (!draft) return DRAFT_NOT_FOUND
  const checked = publishableArticle(draft.article, body.visibility ?? draft.visibility)
  if (!checked.ok) return { error: checked.error, ok: false, status: 400 }

  const claimed = await deps.claimDraft(user, id)
  if (!claimed) return DRAFT_NOT_FOUND
  const restore = () =>
    deps
      .restoreDraft(user, claimed)
      .catch((error: unknown) =>
        deps.logError(`⚠️ Could not restore draft ${id} for ${user} after a failed publish:`, error),
      )
  try {
    // Validated again: the draft may have been saved between the check and the claim.
    const publishable = publishableArticle(claimed.article, body.visibility ?? claimed.visibility)
    if (!publishable.ok) {
      await restore()
      return { error: publishable.error, ok: false, status: 400 }
    }
    const tags = await (deps.postTags ?? draftPostTags)(user, claimed.article)
    return { ok: true, post: await deps.createPost(user, { ...publishable.input, tags }) }
  } catch (error) {
    await restore()
    throw error
  }
}
