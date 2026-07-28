/**
 * Native rendering of a federated ARTICLE post's structured enrichment (C3): the
 * title followed by its resolved blocks — prose, a chart per windowed metric,
 * and a correlation scatter — all built from data embedded in the structured
 * payload fetched on ingest (`GET /public/:username/feed/:postId`). Unlike the
 * author's own `ArticleContent`/`ArticleChartBlock`/`ArticleCorrelationBlock`
 * (which fetch live from the author's authenticated endpoints), this renders
 * only the data the payload already carries — a receiving peer has no
 * credentials to fetch more.
 *
 * Prose is the author's raw markdown, rendered through the same sanitising
 * `renderMarkdown` the author's own composer uses (the #910 XSS boundary),
 * since a remote peer's markdown is untrusted content.
 */
import type { FeedStructuredArticle, FeedStructuredArticleBlock } from '@aurboda/api-spec'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { renderMarkdown } from '../../utils/markdown'
import { getMetricDisplayName } from '../../utils/metricLabels'
import { CorrelationScatterSvg } from './ArticleCorrelationBlock'

const CHART_COLOR = '#673ab8'

const TimelineArticleBlock = ({ block }: { block: FeedStructuredArticleBlock }) => {
  if (block.type === 'prose') {
    return <div class="article-prose" dangerouslySetInnerHTML={{ __html: renderMarkdown(block.markdown) }} />
  }

  if (block.type === 'chart') {
    const points = block.samples
      .map((s) => ({ date: s.start, value: s.avg }))
      .filter((p): p is { date: string; value: number } => p.value != null)
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
