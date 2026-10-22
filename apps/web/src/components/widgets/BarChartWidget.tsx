/**
 * Split into a presentational `BarChartView` and a fetching container. The view
 * links to the full chart page only when an `href` is supplied (home dashboard).
 */

import type { BarChartConfig, BarChartData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchChartData } from '../../state/api'
import { buildChartUrl, type ChartOrigin } from '../../utils/chart-url'
import { BarChart } from '../charts/BarChart'
import { BreakdownLegend, SERIES_COLORS } from '../charts/breakdown'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'

/** Compute start/end ISO strings from lookback_days. */
function lookbackToRange(lookbackDays: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return { end: end.toISOString(), start: start.toISOString() }
}

const NO_BUCKETS: BarChartData['buckets'] = []

interface BarChartViewProps {
  config: BarChartConfig
  data: BarChartData | null
  /** Optional link to the full chart page (home dashboard only). */
  href?: string
}

export function BarChartView({ config, data, href }: BarChartViewProps) {
  const { pattern, title, bucket_size } = config
  const displayTitle = title ?? `${pattern ?? 'chart'} (${bucket_size})`

  const breakdownSeries = data?.breakdown_series
  const breakdownBuckets = data?.breakdown_buckets
  const multiSeries = useMemo(
    () =>
      breakdownSeries && breakdownSeries.length > 0 && breakdownBuckets
        ? breakdownSeries.map((name, i) => ({
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            data: breakdownBuckets.map((b) => ({
              bucket_start: b.bucket_start,
              value: b.series[name] ?? 0,
            })),
            name,
          }))
        : null,
    [breakdownSeries, breakdownBuckets],
  )

  const body = (
    <>
      <h4>{displayTitle}</h4>
      {breakdownSeries && multiSeries ? (
        <>
          <BreakdownLegend series={breakdownSeries} />
          <BarChart data={NO_BUCKETS} height={200} multiSeries={multiSeries} />
        </>
      ) : (
        <BarChart data={data?.buckets ?? NO_BUCKETS} color="#8b5cf6" height={200} />
      )}
    </>
  )

  return href ? (
    <a href={href} class="chart-widget chart-widget-link">
      {body}
    </a>
  ) : (
    <div class="chart-widget">{body}</div>
  )
}

interface BarChartWidgetProps {
  config: BarChartConfig
  /** When rendered inside a board, links back to /chart carrying this widget's origin. */
  origin?: ChartOrigin
}

export function BarChartWidget({ config, origin }: BarChartWidgetProps) {
  const {
    source_type,
    pattern,
    tag_definition_id: activity_type_id,
    title,
    bucket_size,
    lookback_days,
    aggregation = 'count',
    breakdown_fields,
  } = config

  const { start, end } = lookbackToRange(lookback_days)

  const chartQuery = useQuery({
    enabled: Boolean(pattern ?? activity_type_id),
    queryFn: () =>
      fetchChartData({
        aggregation,
        bucket_size,
        end,
        pattern: pattern ?? undefined,
        source_type,
        start,
        ...(activity_type_id ? { activity_type_id } : {}),
        ...(breakdown_fields?.length ? { breakdown_fields } : {}),
      }),
    queryKey: [
      'chart-data',
      source_type,
      pattern,
      activity_type_id,
      bucket_size,
      lookback_days,
      aggregation,
      breakdown_fields,
    ],
    ...HEAVY_QUERY_OPTIONS,
    staleTime: 5 * 60 * 1000,
  })

  const chartData = chartQuery.data
  const data = useMemo<BarChartData | null>(
    () =>
      chartData
        ? {
            buckets: chartData.buckets,
            ...(chartData.breakdown_series?.length
              ? {
                  breakdown_buckets: chartData.breakdown_buckets,
                  breakdown_series: chartData.breakdown_series,
                }
              : {}),
          }
        : null,
    [chartData],
  )

  const displayTitle = title ?? `${pattern ?? 'chart'} (${bucket_size})`
  const chartUrl = buildChartUrl({
    aggregation,
    breakdown_fields,
    bucket_size,
    chart_type: 'bar',
    lookback_days,
    pattern: pattern ?? undefined,
    source_type,
    activity_type_id,
    origin,
  })

  if (chartQuery.isLoading) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-loading">Loading chart data...</div>
      </div>
    )
  }

  if (chartQuery.isError || !data) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-error">Unable to load chart data</div>
      </div>
    )
  }

  return <BarChartView config={config} data={data} href={chartUrl} />
}
