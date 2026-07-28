/**
 * Reddit/markdown export (C4): a paste-ready markdown rendering of an article —
 * title, prose, and one image link per chart/correlation block (via the C1
 * `blocks/:index/image.png` endpoint) — for pasting into a text-only
 * destination like r/QuantifiedSelf, where the author adds their own write-up
 * around the linked charts. Reuses the exact same block-image URL the AS2
 * attachment builder points at (`articleBlockImageUrl`), so the export and the
 * federated image always agree.
 *
 * Pure and synchronous: the markdown only LINKS to the already-gated,
 * on-demand image endpoint rather than embedding rendered data itself, so no
 * chart/correlation resolution happens here.
 */
import type { ArticleBlock, ArticleContent, FeedVisibility } from '@aurboda/api-spec'

import { describeSelectorAxis, getMetricDisplayName } from '@aurboda/api-spec'

import { articleBlockImageUrl } from './article.ts'

/** Collapse newlines (markdown alt/caption text is a single line) and escape `]` so it can't close the image syntax early. */
const inlineText = (text: string): string => text.replaceAll(/\s+/g, ' ').trim().replaceAll(']', '\\]')

/** A human label for a chart/correlation block's image: its caption, else a label from its data. */
const blockLabel = (block: Extract<ArticleBlock, { type: 'chart' | 'correlation' }>): string =>
  block.caption ??
  (block.type === 'chart'
    ? getMetricDisplayName(block.metric)
    : `${describeSelectorAxis(block.trigger)} vs ${describeSelectorAxis(block.outcome)}`)

/**
 * Render an article as paste-ready markdown: an H1 title, each prose block's
 * markdown verbatim, and each chart/correlation block as a markdown image link
 * to its rendered PNG (the C1 endpoint), with its caption (else a data label)
 * as both the image's alt text and an italic line underneath it — the markdown
 * equivalent of the web/federated render's `<figcaption>`.
 */
export const buildArticleMarkdown = (
  apiBaseUrl: string,
  user: string,
  postId: string,
  visibility: FeedVisibility,
  imageToken: string,
  updatedAt: Date,
  article: ArticleContent,
): string => {
  const sections = [`# ${inlineText(article.title)}`]
  article.blocks.forEach((block, index) => {
    if (block.type === 'prose') {
      sections.push(block.markdown)
      return
    }
    const label = inlineText(blockLabel(block))
    const url = articleBlockImageUrl(apiBaseUrl, user, postId, visibility, imageToken, updatedAt, index)
    const lines = [`![${label}](${url})`]
    if (block.caption) lines.push(`*${inlineText(block.caption)}*`)
    sections.push(lines.join('\n'))
  })
  return sections.join('\n\n')
}
