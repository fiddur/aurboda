/**
 * The AS2 representation of an article's prose and inline blocks for federation.
 *
 * An article federates as an AS2 `Article` (built in `deliver.ts`): the title is
 * its `name`, the prose is HTML `content`, and each chart/correlation block is an
 * attached PNG so a plain fediverse client (Mastodon) shows prose + images. Aurboda
 * peers get the richer inline render via the structured-enrichment channel (a
 * later slice); this module builds only the Mastodon-compatible surface.
 *
 * Prose markdown is rendered with `marked` and then run through the shared
 * `sanitizeRemoteHtml` allowlist — the same safe fediverse HTML subset applied to
 * inbound content — so the outbound `content` can never carry a script/style/`img
 * onerror` payload from user- or AI-authored markdown (#910's boundary, server side).
 */
import type { ArticleContent, ArticleBlock, FeedVisibility } from '@aurboda/api-spec'

import { describeSelectorAxis, getMetricDisplayName } from '@aurboda/api-spec'
import { Image } from '@fedify/fedify/vocab'
import { marked } from 'marked'

import { CHART_HEIGHT, CHART_WIDTH } from '../charts/chart-svg.ts'
import { SCATTER_HEIGHT, SCATTER_WIDTH } from '../charts/scatter-svg.ts'
import { isPubliclyVisible } from './object.ts'
import { sanitizeRemoteHtml } from './timeline-ingest.ts'

// GFM + hard line breaks, matching the web's `renderMarkdown` (#910) so an
// article reads the same in-app and federated.
marked.setOptions({ breaks: true, gfm: true })

/** Render one run of authored markdown to sanitised, federation-safe HTML. */
const renderProse = (markdown: string): string => sanitizeRemoteHtml(marked.parse(markdown, { async: false }))

/**
 * The AS2 `content` HTML for an article: each prose block rendered from markdown,
 * and each chart/correlation block's caption (when set) as a paragraph — the chart
 * images themselves ride as attachments (`articleImageAttachments`), which a
 * fediverse client lays out after the content.
 */
export const renderArticleContentHtml = (article: ArticleContent): string =>
  article.blocks
    .map((block) => {
      if (block.type === 'prose') return renderProse(block.markdown)
      return block.caption ? renderProse(block.caption) : ''
    })
    .filter((html) => html.length > 0)
    .join('\n')

/** A human name for a block's attachment: its caption, else a label from its data. */
const attachmentName = (block: Extract<ArticleBlock, { type: 'chart' | 'correlation' }>): string => {
  if (block.caption) return block.caption
  return block.type === 'chart'
    ? getMetricDisplayName(block.metric)
    : `${describeSelectorAxis(block.trigger)} vs ${describeSelectorAxis(block.outcome)}`
}

/**
 * Image attachments for an article's chart/correlation blocks: one PNG per block,
 * pointing at the gated on-demand endpoint (`/feed/<id>/blocks/<index>/image.png`).
 * `public`/`unlisted` are served unauthenticated; a `followers`-only article's URLs
 * carry the post's unguessable capability `?token=` (the fediverse fetches media
 * unsigned), embedded only in the object delivered to followers.
 */
export const articleImageAttachments = (
  apiBaseUrl: string,
  user: string,
  postId: string,
  visibility: FeedVisibility,
  imageToken: string,
  article: ArticleContent,
): Image[] => {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${postId}`
  const query = isPubliclyVisible(visibility) ? '' : `?token=${encodeURIComponent(imageToken)}`
  const images: Image[] = []
  article.blocks.forEach((block, index) => {
    if (block.type !== 'chart' && block.type !== 'correlation') return
    const [width, height] =
      block.type === 'chart' ? [CHART_WIDTH, CHART_HEIGHT] : [SCATTER_WIDTH, SCATTER_HEIGHT]
    images.push(
      new Image({
        height,
        mediaType: 'image/png',
        name: attachmentName(block),
        url: new URL(`${base}/blocks/${index}/image.png${query}`),
        width,
      }),
    )
  })
  return images
}
