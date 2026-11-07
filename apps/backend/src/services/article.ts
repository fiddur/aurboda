/**
 * Article business logic shared by the REST `/feed/articles` routes and the MCP
 * `create_article` / `update_article` tools (parity).
 *
 * An article's chart and correlation blocks each render over a locked
 * `[start, end]` window. A block may carry its own window or inherit the
 * article-level default; this module resolves that inheritance and validates
 * that every windowed block ends up with a sane bounded window, so a malformed
 * article is rejected at the write boundary rather than failing later at render
 * time. `buildArticleContent` is pure and synchronous — unit-testable without a
 * DB; `validateArticleContent` adds the one check that needs a lookup (a
 * challenge block's challenge, when it is hosted here, must exist).
 */
import type { ArticleBlock, ArticleContent, FeedVisibility } from '@aurboda/api-spec'

import { describeSelectorAxis, getMetricDisplayName } from '@aurboda/api-spec'

import { isValidUsername } from '../api/auth-routes.ts'
import { isMissingDatabase } from '../db/index.ts'
import { isPubliclyVisible } from './activitypub/object.ts'
import { canonicalChallengeUrl, parseChallengeUrl } from './challenge-federation.ts'
import { configuredStructuredChallengeDeps } from './feed-structured-challenge.ts'

export type BuildArticleResult = { ok: true; article: ArticleContent } | { ok: false; error: string }

/**
 * A human label for a chart/correlation/challenge block: its caption, else a
 * label from its data (the metric display name, `trigger vs outcome`, or
 * "Challenge standings"). Shared single source for the AS2 image attachment name
 * (`articleImageAttachments`) and the markdown export (`article-export.ts`) so
 * the two can't diverge. A blank caption falls back to the data label.
 */
export const articleBlockLabel = (block: Exclude<ArticleBlock, { type: 'prose' }>): string => {
  if (block.caption) return block.caption
  if (block.type === 'challenge') return 'Challenge standings'
  return block.type === 'chart'
    ? getMetricDisplayName(block.metric)
    : `${describeSelectorAxis(block.trigger)} vs ${describeSelectorAxis(block.outcome)}`
}

/**
 * A zero-duration bucket (`0s`, `00m`, …) passes the block schema regex but is
 * invalid for `date_bin` (`date_bin('0 seconds', …)` errors) — treat it as no
 * data. Shared by the block-image renderer and the structured-enrichment
 * resolver, both of which bucket a chart block over its locked window.
 */
export const isZeroDurationBucket = (bucket: string): boolean => /^0+[smhd]$/.test(bucket)

/**
 * The public URL of one article chart/correlation block's rendered image (the
 * C1 endpoint), including the cache-busting `?v=<updated_at>` and, for a
 * `followers`-only post, the capability `?token=`. Shared by the outbound AS2
 * attachment builder (`articleImageAttachments`) and the markdown export
 * (`article-export.ts`), so the two surfaces can never point at different URLs
 * for the same block.
 */
export const articleBlockImageUrl = (
  apiBaseUrl: string,
  user: string,
  postId: string,
  visibility: FeedVisibility,
  imageToken: string,
  updatedAt: Date,
  index: number,
  format: 'png' | 'svg' = 'png',
): string => {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${postId}`
  const params = new URLSearchParams({ v: String(updatedAt.getTime()) })
  // Allowlist (public/unlisted are open); any other visibility needs the token.
  if (!isPubliclyVisible(visibility)) params.set('token', imageToken)
  return `${base}/blocks/${index}/image.${format}?${params.toString()}`
}

/** A windowed block's effective window: its own override, else the article default. */
export const blockWindow = (
  block: { start?: string; end?: string },
  content: { default_start?: string; default_end?: string },
): { start?: string; end?: string } => ({
  end: block.end ?? content.default_end,
  start: block.start ?? content.default_start,
})

/** A human label for a windowed block in a validation error (1-based, with the block's subject). */
const blockLabel = (block: Extract<ArticleBlock, { type: 'chart' | 'correlation' }>, index: number): string =>
  block.type === 'chart' ? `Chart block ${index + 1} (${block.metric})` : `Correlation block ${index + 1}`

/**
 * Validate a fully-formed article's content: every chart and correlation block
 * must resolve to a bounded window (its own override or the article default)
 * with start < end, and every challenge block must link an http(s) challenge
 * URL (`<base>/u/<username>/<slug>`). Returns the content to persist, or an error
 * message for a 400.
 */
export const buildArticleContent = (content: ArticleContent): BuildArticleResult => {
  for (const [i, block] of content.blocks.entries()) {
    if (block.type === 'challenge') {
      if (
        canonicalChallengeUrl(block.challenge_url) == null ||
        parseChallengeUrl(block.challenge_url) == null
      ) {
        return { error: `Block ${i + 1}: not a challenge URL.`, ok: false }
      }
      continue
    }
    if (block.type !== 'chart' && block.type !== 'correlation') continue
    const { end, start } = blockWindow(block, content)
    const label = blockLabel(block, i)
    if (start == null || end == null) {
      return {
        error: `${label} has no time window — set its start/end or an article default_start/default_end.`,
        ok: false,
      }
    }
    if (new Date(start).getTime() >= new Date(end).getTime()) {
      return { error: `${label} has start on or after end.`, ok: false }
    }
  }
  return { article: content, ok: true }
}

/** What the challenge-existence check needs: this instance's web host and a challenge lookup. */
export interface ArticleChallengeLookup {
  webHost: string | undefined
  getChallengeBySlug: (user: string, slug: string) => Promise<unknown>
}

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const localChallengeExists = async (
  lookup: ArticleChallengeLookup,
  username: string,
  slug: string,
): Promise<boolean> => {
  if (!isValidUsername(username)) return false
  try {
    return (await lookup.getChallengeBySlug(username, slug)) != null
  } catch (error) {
    if (isMissingDatabase(error)) return false
    throw error
  }
}

/**
 * Every challenge block that links a challenge hosted on this instance must
 * name one that exists (an unknown user counts as missing). A remote URL is
 * not fetched here — saving never touches the network; it resolves
 * best-effort at render. Without a lookup (resolver unconfigured) nothing is
 * checked.
 */
export const checkArticleChallenges = async (
  content: ArticleContent,
  lookup: ArticleChallengeLookup | null,
): Promise<BuildArticleResult> => {
  const webHost = lookup?.webHost?.replace(/\/+$/, '')
  if (lookup == null || !webHost) return { article: content, ok: true }
  for (const [i, block] of content.blocks.entries()) {
    if (block.type !== 'challenge') continue
    const parsed = parseChallengeUrl(block.challenge_url)
    if (parsed == null || parsed.base !== webHost) continue
    if (!(await localChallengeExists(lookup, safeDecode(parsed.username), safeDecode(parsed.slug)))) {
      return { error: `Block ${i + 1}: challenge not found.`, ok: false }
    }
  }
  return { article: content, ok: true }
}

/**
 * `buildArticleContent` plus `checkArticleChallenges`: the full validation every
 * article write (create, update, draft publish) goes through.
 */
export const validateArticleContent = async (
  content: ArticleContent,
  lookup: ArticleChallengeLookup | null = configuredStructuredChallengeDeps(),
): Promise<BuildArticleResult> => {
  const built = buildArticleContent(content)
  if (!built.ok) return built
  return checkArticleChallenges(built.article, lookup)
}

interface ArticleFields<B> {
  blocks: B[]
  title: string
  default_start?: string
  default_end?: string
}

/**
 * Apply an update patch onto the stored article (or draft), replacing only the
 * provided fields (title / blocks / default window); an omitted field keeps its
 * stored value. `visibility` is a separate column, handled by the caller. A
 * published article's merged content still goes through `buildArticleContent`.
 */
export const mergeArticleContent = <B>(
  existing: ArticleFields<B>,
  patch: Partial<ArticleFields<B>>,
): ArticleFields<B> => {
  const merged: ArticleFields<B> = {
    blocks: patch.blocks ?? existing.blocks,
    title: patch.title ?? existing.title,
  }
  const defaultStart = patch.default_start ?? existing.default_start
  const defaultEnd = patch.default_end ?? existing.default_end
  if (defaultStart !== undefined) merged.default_start = defaultStart
  if (defaultEnd !== undefined) merged.default_end = defaultEnd
  return merged
}
