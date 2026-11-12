/**
 * What an article (draft) would federate as, creating nothing: the Note `content` and its
 * figures, and an emulation of how Mastodon's web UI shows that status. Shared by the REST
 * `POST /feed/articles/preview` and the MCP `preview_article` tool (parity).
 */
import type {
  ArticleBlock,
  ArticleContent,
  ArticleDraftBlock,
  ArticleDraftContent,
  ArticlePreviewAttachment,
  ArticlePreviewResponse,
  CorrelationSelector,
  FeedVisibility,
  PreviewArticleBody,
} from '@aurboda/api-spec'

import type { ArticleFigure } from './activitypub/article-object.ts'
import type { ArticleChartDeps } from './article-figure.ts'
import type { BuildArticleResult } from './article.ts'

import {
  articleFigureName,
  MASTODON_ATTACHMENT_LIMIT,
  renderArticleNote,
} from './activitypub/article-object.ts'
import { hashtagLinks, linkifyHashtags } from './activitypub/hashtag-html.ts'
import { linkedHashtags, mastodonSanitize, splitTrailingHashtags } from './activitypub/mastodon-sanitize.ts'
import { checkDraftChallenges, checkedPublishable, draftPostTags } from './article-drafts.ts'
import { articleBlockFigureSvg } from './article-figure.ts'
import { blockWindow, withCanonicalChallengeUrls } from './article.ts'
import { canonicalChallengeUrl, parseChallengeUrl } from './challenge-federation.ts'
import { articleBlockAt, timeBucket } from './post-chart.ts'
import { createRenderCache } from './render-cache.ts'

type FigureCache = ReturnType<typeof createRenderCache<{ svg: string | null }>>

export interface ArticlePreviewDeps {
  chartDeps: ArticleChartDeps
  /** Canonical web origin the hashtag links point at; without it the tags stay plain text. */
  webHost?: string
  /** The lookup-backed publish checks; defaults to the publish path's challenge lookup. */
  checkContent?: (content: ArticleContent) => Promise<BuildArticleResult>
  /** The tags the article would get; defaults to the owner's settings, as publishing does. */
  postTags?: (user: string, content: ArticleDraftContent) => Promise<string[]>
  now?: () => number
  /** Drawn figures, so retyping prose does not draw the charts again. */
  figureCache?: FigureCache
}

type Defined<T> = { [K in keyof T]-?: Exclude<T[K], undefined> }

export type ArticlePreview = Defined<
  Pick<
    ArticlePreviewResponse,
    'attachments' | 'content' | 'mastodon' | 'name' | 'notes' | 'publish_error' | 'tags'
  >
>

export type ArticlePreviewer = (user: string, body: PreviewArticleBody) => Promise<ArticlePreview>

const FIGURE_BUCKET_MS = 3_600_000

const hasBoundedWindow = (
  block: { start?: string; end?: string },
  content: Pick<ArticleDraftContent, 'default_end' | 'default_start'>,
): boolean => {
  const { end, start } = blockWindow(block, content)
  return start != null && end != null && new Date(start).getTime() < new Date(end).getTime()
}

/** A selector with something chosen: the editor leaves an empty metric or pattern in an unpicked one. */
const isChosen = (selector: CorrelationSelector | undefined): boolean => {
  if (selector === undefined) return false
  if (selector.kind === 'metric') return selector.metric.trim() !== ''
  return selector.kind === 'nutrition' || selector.pattern.trim() !== ''
}

const isChallengeUrl = (url: string | undefined): boolean =>
  url !== undefined && canonicalChallengeUrl(url) != null && parseChallengeUrl(url) != null

/** Whether a draft block is complete enough to render as it would publish. */
export const isCompleteBlock = (
  block: ArticleDraftBlock,
  content: ArticleDraftContent,
): block is ArticleBlock => {
  switch (block.type) {
    case 'prose':
      return true
    case 'challenge':
      return isChallengeUrl(block.challenge_url)
    case 'chart':
      return block.metric !== undefined && hasBoundedWindow(block, content)
    case 'correlation':
      return isChosen(block.trigger) && isChosen(block.outcome) && hasBoundedWindow(block, content)
    case 'impact':
      return Boolean(block.activity) && hasBoundedWindow(block, content)
  }
}

/** The draft's complete blocks as an article, and each kept block's index in the draft. */
export const previewableArticle = (
  content: ArticleDraftContent,
): { article: ArticleContent; indices: number[] } => {
  const kept = content.blocks.flatMap((block, index) =>
    isCompleteBlock(block, content) ? [{ block, index }] : [],
  )
  return {
    article: {
      blocks: withCanonicalChallengeUrls(kept.map(({ block }) => block)),
      ...(content.default_end === undefined ? {} : { default_end: content.default_end }),
      ...(content.default_start === undefined ? {} : { default_start: content.default_start }),
      title: content.title.trim() || 'Untitled',
    },
    indices: kept.map(({ index }) => index),
  }
}

/** The Note `content` and figures, a block figure linking `#figure-N` since its post does not exist yet. */
const renderPreviewNote = (article: ArticleContent): { content: string; figures: ArticleFigure[] } => {
  const numbers = new Map(
    renderArticleNote(article, () => '').figures.flatMap((figure) =>
      figure.block_index === undefined ? [] : [[figure.block_index, figure.number] as const],
    ),
  )
  return renderArticleNote(article, (index) => `#figure-${numbers.get(index)}`)
}

const isShownBlockFigure = (figure: ArticleFigure): boolean =>
  figure.block_index !== undefined && figure.number <= MASTODON_ATTACHMENT_LIMIT

/** Each block figure Mastodon shows, drawn one after another: its SVG, or null without data. */
const drawFigures = async (
  user: string,
  article: ArticleContent,
  figures: ArticleFigure[],
  deps: ArticlePreviewDeps,
): Promise<Map<number, string | null>> => {
  const now = deps.now?.() ?? Date.now()
  const drawn = new Map<number, string | null>()
  for (const figure of figures.filter(isShownBlockFigure)) {
    const block = articleBlockAt(article, new Date(now), figure.block_index ?? -1)
    if (block == null) {
      drawn.set(figure.number, null)
      continue
    }
    const produce = async () => ({ svg: await articleBlockFigureSvg(deps.chartDeps, user, block, figure) })
    const { updatedAt: _, ...resolved } = block
    const key = JSON.stringify([
      user,
      resolved,
      figure.number,
      figure.label,
      timeBucket(now, FIGURE_BUCKET_MS),
    ])
    const result = deps.figureCache ? await deps.figureCache(key, produce) : await produce()
    drawn.set(figure.number, result?.svg ?? null)
  }
  return drawn
}

const toAttachment = (
  figure: ArticleFigure,
  indices: number[],
  images: Map<number, string | null> | undefined,
): ArticlePreviewAttachment => ({
  ...(figure.block_index === undefined ? { url: figure.url } : { block_index: indices[figure.block_index] }),
  figure: figure.number,
  ...(figure.height === undefined ? {} : { height: figure.height }),
  ...(images?.has(figure.number) ? { image_svg: images.get(figure.number) ?? null } : {}),
  ...(figure.media_type === undefined ? {} : { media_type: figure.media_type }),
  name: articleFigureName(figure),
  shown_in_mastodon: figure.number <= MASTODON_ATTACHMENT_LIMIT,
  ...(figure.width === undefined ? {} : { width: figure.width }),
})

const hiddenFiguresNote = (hidden: number[]): string | null => {
  if (hidden.length === 0) return null
  const lead = `Mastodon shows the first ${MASTODON_ATTACHMENT_LIMIT} images.`
  return hidden.length === 1
    ? `${lead} Figure ${hidden[0]} is linked in the text instead.`
    : `${lead} Figures ${hidden[0]} to ${hidden.at(-1)} are linked in the text instead.`
}

/** What Mastodon changes for this post, in plain sentences. */
export const previewNotes = (
  attachments: ArticlePreviewAttachment[],
  visibility: FeedVisibility,
): string[] => {
  const hidden = attachments.filter((a) => !a.shown_in_mastodon).map((a) => a.figure)
  const shown = attachments.length - hidden.length
  return [
    hiddenFiguresNote(hidden),
    ...attachments
      .filter((a) => a.image_svg === null)
      .map((a) => `Figure ${a.figure} has no data to draw yet, so its image will be missing.`),
    shown === 2 || shown === 3
      ? 'Mastodon crops images in a grid of two or three. The full image opens when clicked.'
      : null,
    visibility === 'followers' && attachments.some((a) => a.block_index !== undefined)
      ? 'Followers-only: the image links carry a private token that only your followers receive.'
      : null,
  ].filter((note): note is string => note != null)
}

/** `content` as Mastodon's web UI shows it: sanitised, the trailing hashtags moved into the bar. */
const mastodonView = (content: string, tags: string[]): ArticlePreview['mastodon'] => {
  const split = splitTrailingHashtags(mastodonSanitize(content))
  const linked = new Set(linkedHashtags(split.content))
  return {
    attachment_limit: MASTODON_ATTACHMENT_LIMIT,
    content: split.content,
    hashtag_bar: [...new Set([...split.tags, ...tags.filter((tag) => !linked.has(tag))])],
  }
}

export const previewArticle = async (
  user: string,
  body: PreviewArticleBody,
  deps: ArticlePreviewDeps,
): Promise<ArticlePreview> => {
  const checked = await checkedPublishable(
    body.article,
    body.visibility,
    deps.checkContent ?? checkDraftChallenges,
  )
  const { article, indices } = previewableArticle(body.article)
  const note = renderPreviewNote(article)
  const tags = await (deps.postTags ?? draftPostTags)(user, body.article)
  const content = linkifyHashtags(
    note.content,
    deps.webHost ? hashtagLinks(deps.webHost, user, tags) : undefined,
  )
  const images = body.include_images ? await drawFigures(user, article, note.figures, deps) : undefined
  const attachments = note.figures.map((figure) => toAttachment(figure, indices, images))
  return {
    attachments,
    content,
    mastodon: mastodonView(content, tags),
    name: article.title,
    notes: previewNotes(attachments, body.visibility),
    publish_error: checked.ok ? null : checked.error,
    tags,
  }
}

/** `previewArticle` with its own cache of drawn figures. */
export const createArticlePreviewer = (deps: Omit<ArticlePreviewDeps, 'figureCache'>): ArticlePreviewer => {
  const figureCache: FigureCache = createRenderCache<{ svg: string | null }>(100)
  return (user, body) => previewArticle(user, body, { ...deps, figureCache })
}
