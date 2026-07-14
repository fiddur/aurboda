/**
 * One inline chart block of an article: a single metric drawn over its locked
 * `[start, end]` window. Data is re-resolved **live** against the window (no
 * snapshot) via the owner-authenticated bucketed-metrics endpoint, matching the
 * article model's "lock the window, not the data" design (#934). The caller
 * (`ArticleContent`) resolves the effective window (block override else the
 * article default) and passes concrete ISO strings.
 */
import { useQuery } from '@tanstack/react-query'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchBucketedMetrics } from '../../state/api'
import { getMetricDisplayName } from '../../utils/metricLabels'

const CHART_COLOR = '#673ab8'
const DAY_MS = 86_400_000

/** Pick a bucket granularity from the window span when the block doesn't fix one. */
const defaultBucket = (start: Date, end: Date): string =>
  end.getTime() - start.getTime() <= 2 * DAY_MS ? '1h' : '1d'

export const ArticleChartBlock = ({
  metric,
  start,
  end,
  bucket,
  caption,
}: {
  metric: string
  start: string
  end: string
  bucket?: string
  caption?: string
}) => {
  const startDate = new Date(start)
  const endDate = new Date(end)
  const effectiveBucket = bucket ?? defaultBucket(startDate, endDate)

  const { data, isLoading, isError } = useQuery({
    queryFn: () => fetchBucketedMetrics(startDate, endDate, [metric], effectiveBucket),
    queryKey: ['article-chart', metric, start, end, effectiveBucket],
  })

  const points = (data?.buckets ?? [])
    .map((b) => ({ date: b.start, value: b.metrics[metric]?.avg }))
    .filter((p): p is { date: string; value: number } => p.value != null)

  return (
    <figure class="article-chart">
      <div class="article-chart-title">{getMetricDisplayName(metric)}</div>
      {isLoading ? (
        <p class="article-chart-note">Loading chart…</p>
      ) : isError ? (
        <p class="article-chart-note">Couldn't load this chart.</p>
      ) : points.length < 2 ? (
        <p class="article-chart-note">Not enough data in this window.</p>
      ) : (
        <TrendLineChart color={CHART_COLOR} data={points} xDomain={[startDate, endDate]} />
      )}
      {caption && <figcaption class="article-chart-caption">{caption}</figcaption>}
    </figure>
  )
}
