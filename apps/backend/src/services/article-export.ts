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
import type { ArticleBlock, ArticleContent, FeedVisibility, MetricType } from '@aurboda/api-spec'

import { defaultArticleChartBucket } from '@aurboda/api-spec'

import type { CorrelationBlockParams } from './article-block-data.ts'
import type { ScatterSvgData } from './charts/scatter-svg.ts'

import { getArticleChartSeriesData, getArticleCorrelationScatter } from './article-block-data.ts'
import { articleBlockImageUrl, articleBlockLabel, blockWindow, isZeroDurationBucket } from './article.ts'

/**
 * Collapse newlines (markdown alt/caption text is a single line) and escape
 * `[`/`]` (an unbalanced bracket breaks the `![alt](url)` syntax) plus `*`/`_`
 * (which would open or close an emphasis span inside the italic caption line —
 * `5*3 sets` is a plausible caption, #975).
 */
const inlineText = (text: string): string =>
  text
    .replaceAll(/\s+/g, ' ')
    .trim()
    .replaceAll(/([[\]*_])/g, '\\$1')

/** The data dependencies behind {@link renderableArticleBlocks}, injectable for tests. */
export interface BlockImageDataDeps {
  chartSeries: (
    user: string,
    metric: MetricType,
    start: Date,
    end: Date,
    bucket: string,
  ) => Promise<unknown[]>
  correlationScatter: (user: string, params: CorrelationBlockParams) => Promise<ScatterSvgData | null>
}

const realDeps: BlockImageDataDeps = {
  chartSeries: getArticleChartSeriesData,
  correlationScatter: getArticleCorrelationScatter,
}

/**
 * The indices of the chart/correlation blocks whose image endpoint would
 * actually render — the same static window checks as `resolveArticleBlock` and
 * the same data checks as `renderArticleBlockImage` (chart: ≥ 2 points over a
 * non-zero bucket; correlation: n ≥ 3), via the same shared data fetchers, so
 * the export can't link an image that will 404 (#974).
 */
export const renderableArticleBlocks = async (
  user: string,
  article: ArticleContent,
  deps: BlockImageDataDeps = realDeps,
): Promise<Set<number>> => {
  const renderable = new Set<number>()
  for (const [index, block] of article.blocks.entries()) {
    if (block.type === 'prose') continue
    if (await blockImageRenders(user, block, article, deps)) renderable.add(index)
  }
  return renderable
}

const blockImageRenders = async (
  user: string,
  block: Extract<ArticleBlock, { type: 'chart' | 'correlation' }>,
  article: ArticleContent,
  deps: BlockImageDataDeps,
): Promise<boolean> => {
  const { end, start } = blockWindow(block, article)
  if (start == null || end == null) return false
  const startDate = new Date(start)
  const endDate = new Date(end)
  if (startDate.getTime() >= endDate.getTime()) return false
  if (block.type === 'chart') {
    const bucket = block.bucket ?? defaultArticleChartBucket(startDate, endDate)
    if (isZeroDurationBucket(bucket)) return false
    return (await deps.chartSeries(user, block.metric, startDate, endDate, bucket)).length >= 2
  }
  const scatter = await deps.correlationScatter(user, {
    lagDays: block.lag_days,
    outcome: block.outcome,
    periodEnd: end.slice(0, 10),
    periodStart: start.slice(0, 10),
    trigger: block.trigger,
  })
  return scatter != null
}

/**
 * Render an article as paste-ready markdown: an H1 title, each prose block's
 * markdown verbatim, and each chart/correlation block as a markdown image link
 * to its rendered PNG (the C1 endpoint), with its caption (else a data label)
 * as both the image's alt text and an italic line underneath it — the markdown
 * equivalent of the web/federated render's `<figcaption>`.
 *
 * `renderableBlocks` (from {@link renderableArticleBlocks}) marks the blocks
 * whose image would actually render; any other chart/correlation block gets an
 * italic "not enough data" line instead of a dead image link, so the pasted
 * markdown never shows a broken image (#974). Omit it to link every block
 * unconditionally (tests / callers that already know).
 */
export const buildArticleMarkdown = (
  apiBaseUrl: string,
  user: string,
  postId: string,
  visibility: FeedVisibility,
  imageToken: string,
  updatedAt: Date,
  article: ArticleContent,
  renderableBlocks?: ReadonlySet<number>,
): string => {
  const sections = [`# ${inlineText(article.title)}`]
  article.blocks.forEach((block, index) => {
    if (block.type === 'prose') {
      sections.push(block.markdown)
      return
    }
    const label = inlineText(articleBlockLabel(block))
    if (renderableBlocks !== undefined && !renderableBlocks.has(index)) {
      // Same message the web's inline render shows for a sparse block.
      sections.push(`*${label} — not enough data in this window.*`)
      return
    }
    const url = articleBlockImageUrl(apiBaseUrl, user, postId, visibility, imageToken, updatedAt, index)
    const lines = [`![${label}](${url})`]
    if (block.caption) lines.push(`*${inlineText(block.caption)}*`)
    sections.push(lines.join('\n'))
  })
  return sections.join('\n\n')
}
