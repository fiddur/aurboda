/**
 * Native rendering of a federated ARTICLE post's structured enrichment (C3): the
 * title followed by its resolved blocks — prose, a chart per windowed metric,
 * a correlation scatter, a challenge's race card and an impact chart — all built from data embedded in the structured
 * payload fetched on ingest (`GET /public/:username/feed/:postId`). Unlike the
 * author's own `ArticleContent`/`ArticleChartBlock`/`ArticleCorrelationBlock`
 * (which fetch live from the author's authenticated endpoints), this renders
 * only the data the payload already carries — a receiving peer has no
 * credentials to fetch more.
 *
 * Prose is the remote author's raw markdown, rendered through `renderRemoteMarkdown`
 * (the #910 XSS boundary, plus no `<img>` but the block's declared `images`) — a
 * remote peer's markdown is untrusted, so it can't smuggle a tracking pixel into
 * the reader's timeline through a picture its payload does not declare.
 */
import type { FeedStructuredArticle, FeedStructuredArticleBlock } from '@aurboda/api-spec'

import { useMemo } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { CHART_PRIMARY } from '../../theme'
import { renderRemoteMarkdown } from '../../utils/markdown'
import { getMetricDisplayName } from '../../utils/metricLabels'
import { ResolvedArticleChallenge } from './ArticleChallengeBlock'
import { CorrelationScatterSvg } from './ArticleCorrelationBlock'
import { ImpactBlockFigure } from './ArticleImpactBlock'
import './FeedPostCard.css' // `.article-prose` / `.article-chart*` / `.article-scatter*`

const CHART_COLOR = CHART_PRIMARY

type ChartBlock = Extract<FeedStructuredArticleBlock, { type: 'chart' }>

const TimelineArticleChart = ({ block }: { block: ChartBlock }) => {
  const points = useMemo(
    () =>
      block.samples
        .map((s) => ({ date: s.start, value: s.avg }))
        .filter((p): p is { date: string; value: number } => p.value != null),
    [block.samples],
  )
  return (
    <figure class="article-chart">
      <div class="article-chart-title">{getMetricDisplayName(block.metric)}</div>
      {points.length < 2 ? (
        <p class="article-chart-note">Not enough data in this window.</p>
      ) : (
        <TrendLineChart
          color={CHART_COLOR}
          data={points}
          xDomain={[new Date(block.start), new Date(block.end)]}
        />
      )}
      {block.caption && <figcaption class="article-chart-caption">{block.caption}</figcaption>}
    </figure>
  )
}

const TimelineArticleBlock = ({ block }: { block: FeedStructuredArticleBlock }) => {
  if (block.type === 'prose') {
    return (
      <div
        class="article-prose"
        dangerouslySetInnerHTML={{ __html: renderRemoteMarkdown(block.markdown, block.images) }}
      />
    )
  }

  if (block.type === 'chart') return <TimelineArticleChart block={block} />

  if (block.type === 'challenge') return <ResolvedArticleChallenge block={block} />

  if (block.type === 'impact') return <ImpactBlockFigure data={block} caption={block.caption} />

  return (
    <figure class="article-chart">
      {block.n < 3 ? (
        <p class="article-chart-note">Not enough overlapping data in this window.</p>
      ) : (
        <CorrelationScatterSvg data={block} />
      )}
      {block.caption && <figcaption class="article-chart-caption">{block.caption}</figcaption>}
    </figure>
  )
}

export const TimelineArticle = ({ article }: { article: FeedStructuredArticle }) => (
  <div class="article-content">
    <h3 class="article-title">{article.title}</h3>
    {article.blocks.map((block, i) => (
      <TimelineArticleBlock key={i} block={block} />
    ))}
  </div>
)
