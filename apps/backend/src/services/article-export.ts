/**
 * Reddit/markdown export: a paste-ready markdown rendering of an article —
 * title, prose, one image link per chart/correlation/impact block, and a challenge
 * block's standings image plus a join link (images via the
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

import { DEFAULT_IMPACT_WINDOW_MINUTES, defaultArticleChartBucket } from '@aurboda/api-spec'

import type { CorrelationBlockParams, ImpactBlockParams } from './article-block-data.ts'
import type { NegativeCache } from './article-block-misses.ts'
import type { ImpactSvgData } from './charts/impact-svg.ts'
import type { RaceChartSvgData } from './charts/race-chart-svg.ts'
import type { ScatterSvgData } from './charts/scatter-svg.ts'

import {
  getArticleChartSeriesData,
  getArticleCorrelationScatter,
  getArticleImpact,
} from './article-block-data.ts'
import { articleBlockMisses, forgetArticleBlockMisses } from './article-block-misses.ts'
import { articleBlockImageUrl, articleBlockLabel, blockWindow, isZeroDurationBucket } from './article.ts'
import { isDrawableImpact } from './charts/post-chart-svg.ts'
import { resolveChallengeRaceByUrl } from './feed-structured-challenge.ts'

/**
 * Collapse newlines (markdown alt/caption text is a single line) and escape
 * `[`/`]` (an unbalanced bracket breaks the `![alt](url)` syntax) plus `*`/`_`
 * (which would open or close an emphasis span inside the italic caption line —
 * `5*3 sets` is a plausible caption).
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
  challengeRace: (user: string, url: string) => Promise<RaceChartSvgData | null>
  impact: (user: string, params: ImpactBlockParams) => Promise<ImpactSvgData>
  misses: NegativeCache
}

const realDeps: BlockImageDataDeps = {
  chartSeries: getArticleChartSeriesData,
  challengeRace: (user, url) => resolveChallengeRaceByUrl(user, url),
  correlationScatter: getArticleCorrelationScatter,
  impact: getArticleImpact,
  misses: articleBlockMisses,
}

/**
 * The indices of the blocks whose image endpoint would actually render — the
 * same static checks as `resolveArticleBlock` and the same data checks as
 * `renderArticleBlockImage`, via the same shared data fetchers, so the export
 * can't link an image that will 404.
 */
export const renderableArticleBlocks = async (
  user: string,
  postId: string,
  article: ArticleContent,
  deps: BlockImageDataDeps = realDeps,
): Promise<Set<number>> => {
  const renderable = new Set<number>()
  for (const [index, block] of article.blocks.entries()) {
    if (block.type === 'prose') continue
    if (!(await blockImageRenders(user, block, article, deps))) continue
    renderable.add(index)
    // A miss remembered while the block was still empty would 404 the link
    // this export is about to emit until the hour rolls over.
    forgetArticleBlockMisses(deps.misses, user, postId, index)
  }
  return renderable
}

const blockImageRenders = async (
  user: string,
  block: Exclude<ArticleBlock, { type: 'prose' }>,
  article: ArticleContent,
  deps: BlockImageDataDeps,
): Promise<boolean> => {
  if (block.type === 'challenge') {
    const race = await deps.challengeRace(user, block.challenge_url)
    return race != null && race.lines.length > 0
  }
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
  if (block.type === 'impact') {
    const impact = await deps.impact(user, {
      activity: block.activity,
      activityType: block.activity_type,
      end: endDate,
      start: startDate,
      windowMinutes: block.window_minutes ?? DEFAULT_IMPACT_WINDOW_MINUTES,
    })
    return isDrawableImpact(impact)
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

/** A URL usable as a plain markdown link target: the characters that would end or break `(url)` escaped. */
const linkTarget = (url: string): string =>
  url.replaceAll(/[\s()<>]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')}`)

/**
 * Render an article as paste-ready markdown: an H1 title, each prose block's
 * markdown verbatim, and each chart/correlation/impact block as a markdown image link
 * to its rendered PNG (the C1 endpoint), with its caption (else a data label)
 * as both the image's alt text and an italic line underneath it — the markdown
 * equivalent of the web/federated render's `<figcaption>`. A challenge block is
 * its standings image the same way, then a "Join the challenge" link.
 *
 * `renderableBlocks` (from {@link renderableArticleBlocks}) marks the blocks
 * whose image would actually render; any other chart/correlation/impact block gets an
 * italic "not enough data" line instead of a dead image link, so the pasted
 * markdown never shows a broken image (#974), and a challenge block keeps only
 * its caption and link. Omit it to link every block unconditionally (tests /
 * callers that already know).
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
    const drawable = renderableBlocks === undefined || renderableBlocks.has(index)
    if (block.type === 'challenge') {
      const lines: string[] = []
      if (drawable) {
        lines.push(
          `![${label}](${articleBlockImageUrl(apiBaseUrl, user, postId, visibility, imageToken, updatedAt, index)})`,
        )
      }
      if (block.caption) lines.push(`*${inlineText(block.caption)}*`)
      lines.push(`[Join the challenge](${linkTarget(block.challenge_url)})`)
      sections.push(lines.join('\n'))
      return
    }
    if (!drawable) {
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
