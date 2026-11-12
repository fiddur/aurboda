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

import type {
  ArticleDraftPatch,
  ArticleDraftRecord,
  ArticlePostInput,
  DraftPublishOutcome,
  FeedPostRecord,
} from '../db/index.ts'
import type { BuildArticleResult } from './article.ts'

import { getArticleDraft, publishArticleDraftPost } from '../db/index.ts'
import {
  buildArticleContent,
  checkArticleChallenges,
  mergeArticleContent,
  withCanonicalChallengeUrls,
} from './article.ts'
import { configuredStructuredChallengeDeps } from './feed-structured-challenge.ts'
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
  merged.blocks = withCanonicalChallengeUrls(merged.blocks)
  return { article: merged, ...(visibility ? { visibility } : {}) }
}

/** Draft content as stored: its explicit tags normalised, its challenge URLs canonical. */
export const normalizeArticleDraftContent = (content: ArticleDraftContent): ArticleDraftContent => {
  const blocks = withCanonicalChallengeUrls(content.blocks)
  return content.tags === undefined
    ? { ...content, blocks }
    : { ...content, blocks, tags: normalizeTags(content.tags) }
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
    if (block.type === 'challenge' && !block.challenge_url) {
      return `Challenge block ${i + 1} has no challenge — pick one or paste its link before publishing.`
    }
    if (block.type === 'impact' && !block.activity) {
      return `Impact block ${i + 1} has no activity — pick one before publishing.`
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
  /** Claim the draft, `prepare` the post from it and insert it in one transaction; see `publishArticleDraftPost`. */
  publishDraft: (
    user: string,
    id: string,
    prepare: (draft: ArticleDraftRecord) => Promise<PublishableResult>,
  ) => Promise<DraftPublishOutcome>
  /** The published article's tags; defaults to the owner's default tags (or the draft's) plus typed ones. */
  postTags?: (user: string, content: ArticleDraftContent) => Promise<string[]>
  /** The lookup-backed checks (local challenges exist); defaults to `checkArticleChallenges` with the configured lookup. */
  checkContent?: (content: ArticlePostInput['article']) => Promise<BuildArticleResult>
}

export const draftPostTags = (user: string, content: ArticleDraftContent): Promise<string[]> =>
  resolvePostTags(user, { explicit: content.tags, texts: articleTexts(content) })

export const checkDraftChallenges = (content: ArticlePostInput['article']): Promise<BuildArticleResult> =>
  checkArticleChallenges(content, configuredStructuredChallengeDeps())

const defaultDeps: PublishDraftDeps = {
  getDraft: (user, id) => getArticleDraft(user, id),
  publishDraft: (user, id, prepare) => publishArticleDraftPost(user, id, prepare),
}

export type PublishDraftResult =
  | { ok: true; post: FeedPostRecord }
  | { ok: false; status: 400 | 404; error: string }

/** `publishableArticle`, then the lookup-backed checks on what it would publish. */
export const checkedPublishable = async (
  content: ArticleDraftContent,
  visibility: FeedVisibility,
  checkContent: NonNullable<PublishDraftDeps['checkContent']>,
): Promise<PublishableResult> => {
  const result = publishableArticle(content, visibility)
  if (!result.ok) return result
  const looked = await checkContent(result.input.article)
  return looked.ok ? result : looked
}

const DRAFT_NOT_FOUND = { error: 'Draft not found', ok: false, status: 404 } as const

/**
 * Publish a draft: validate it and resolve its tags, then in one transaction
 * remove it and create the article post. The lookups run before the transaction
 * so it holds no connection while they take others from the pool; only when the
 * draft was saved between the read and the claim are they run again on the
 * claimed row. Of two concurrent publishes only one creates a post; an invalid
 * draft, or any failure before commit, leaves the draft as it was. The challenge
 * check reads this instance's databases only, never the network. The caller
 * federates the returned post.
 */
export const publishArticleDraft = async (
  user: string,
  id: string,
  body: PublishArticleDraftBody,
  deps: PublishDraftDeps = defaultDeps,
): Promise<PublishDraftResult> => {
  const draft = await deps.getDraft(user, id)
  if (!draft) return DRAFT_NOT_FOUND
  const checkContent = deps.checkContent ?? checkDraftChallenges
  const postTags = deps.postTags ?? draftPostTags
  const visibilityOf = (row: ArticleDraftRecord) => body.visibility ?? row.visibility
  const checked = await checkedPublishable(draft.article, visibilityOf(draft), checkContent)
  if (!checked.ok) return { error: checked.error, ok: false, status: 400 }
  const tags = await postTags(user, draft.article)

  const outcome = await deps.publishDraft(user, id, async (claimed) => {
    const unchanged = claimed.updated_at.getTime() === draft.updated_at.getTime()
    const publishable = unchanged
      ? checked
      : await checkedPublishable(claimed.article, visibilityOf(claimed), checkContent)
    if (!publishable.ok) return publishable
    const claimedTags = unchanged ? tags : await postTags(user, claimed.article)
    return { input: { ...publishable.input, tags: claimedTags }, ok: true }
  })
  if (outcome.status === 'missing') return DRAFT_NOT_FOUND
  if (outcome.status === 'rejected') return { error: outcome.error, ok: false, status: 400 }
  return { ok: true, post: outcome.post }
}
