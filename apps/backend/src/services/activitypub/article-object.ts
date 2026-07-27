/**
 * The AS2 representation of an article's prose and inline blocks for federation.
 *
 * An article federates as a `Note` (built in `deliver.ts`): the title is its
 * `name`, the prose is HTML `content`, and each chart/correlation block is an
 * attached PNG so a plain fediverse client (Mastodon) shows the prose + images
 * inline. (A `Note`, not an AS2 `Article`: Mastodon treats `Article` as a
 * converted type and discards its `content`, rendering only name + link.) Aurboda
 * peers get the richer inline render via the structured-enrichment channel (a
 * later slice); this module builds only the Mastodon-compatible surface.
 *
 * Prose markdown is rendered with `marked` and then sanitised through an outbound
 * allowlist (`sanitizeArticleHtml`) — an XSS boundary like the inbound fediverse
 * sanitiser, but with the block elements a QS write-up uses (GFM tables, images,
 * `hr`, h5/h6) that Mastodon renders in `content` and the web sink (DOMPurify via
 * `utils/markdown.ts`) already keeps — so an article reads the same in-app and
 * federated, and can never carry a script/style/`img onerror` payload (#910's
 * boundary, server side).
 */
import type { ArticleContent, ArticleBlock, FeedVisibility } from '@aurboda/api-spec'

import { describeSelectorAxis, getMetricDisplayName } from '@aurboda/api-spec'
import { Image } from '@fedify/fedify/vocab'
import { marked } from 'marked'
import sanitizeHtml from 'sanitize-html'

import { CHART_HEIGHT, CHART_WIDTH, escapeXml } from '../charts/chart-svg.ts'
import { SCATTER_HEIGHT, SCATTER_WIDTH } from '../charts/scatter-svg.ts'
import { isPubliclyVisible } from './object.ts'

/**
 * Sanitise authored article prose for outbound federation. Extends the inbound
 * fediverse allowlist (`sanitizeRemoteHtml`) with the block elements a QS write-up
 * uses — GFM tables, images, `hr`, h5/h6 — all of which Mastodon renders in
 * `content` and the web DOMPurify sink already keeps, so authored formatting isn't
 * silently flattened on the way out. Still a hard XSS boundary: no script/style/
 * iframe/event handlers survive, and link/image URLs are http(s)/mailto only.
 */
const sanitizeArticleHtml = (html: string): string =>
  sanitizeHtml(html, {
    allowedAttributes: {
      a: ['href', 'rel', 'target', 'class', 'translate'],
      img: ['src', 'alt', 'title'],
      ol: ['start'],
      span: ['class', 'translate'],
      td: ['colspan', 'rowspan'],
      th: ['colspan', 'rowspan', 'scope'],
    },
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedTags: [
      'p',
      'br',
      'a',
      'span',
      'em',
      'strong',
      'b',
      'i',
      'del',
      's',
      'u',
      'pre',
      'code',
      'blockquote',
      'ul',
      'ol',
      'li',
      'h1',
      'h2',
      'h3',
      'h4',
      'h5',
      'h6',
      'hr',
      'img',
      'table',
      'thead',
      'tbody',
      'tfoot',
      'tr',
      'td',
      'th',
    ],
    disallowedTagsMode: 'discard',
    transformTags: {
      a: sanitizeHtml.simpleTransform('a', { rel: 'nofollow noopener noreferrer', target: '_blank' }),
    },
  })

/**
 * Render one run of authored markdown to sanitised, federation-safe HTML. Options
 * (GFM + hard line breaks) are passed per call, matching the web's `renderMarkdown`
 * (#910) without mutating `marked`'s process-wide defaults for every other importer.
 */
const renderProse = (markdown: string): string =>
  sanitizeArticleHtml(marked.parse(markdown, { async: false, breaks: true, gfm: true }))

/**
 * The AS2 `content` HTML for an article: each prose block rendered from markdown,
 * and each chart/correlation block's caption (when set) as a paragraph. A caption
 * is emitted as plain escaped text — NOT markdown — to match the web, which shows
 * it as text in a `<figcaption>`; the chart images themselves ride as attachments
 * (`articleImageAttachments`), which a fediverse client lays out after the content.
 */
export const renderArticleContentHtml = (article: ArticleContent): string =>
  article.blocks
    .map((block) => {
      if (block.type === 'prose') return renderProse(block.markdown)
      return block.caption ? `<p>${escapeXml(block.caption)}</p>` : ''
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
  updatedAt: Date,
  article: ArticleContent,
): Image[] => {
  const base = `${apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(user)}/feed/${postId}`
  // `v` = the post's last-edited epoch: the render cache busts on edit, but the URL
  // itself must change too, or a remote media cache (Mastodon re-hosts attachments
  // at receipt) keeps the pre-edit PNG and the `Update{Article}` never shows the new
  // chart. The image endpoint ignores `v` (it only reads `token`).
  const params = new URLSearchParams({ v: String(updatedAt.getTime()) })
  if (!isPubliclyVisible(visibility)) params.set('token', imageToken)
  const query = `?${params.toString()}`
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
