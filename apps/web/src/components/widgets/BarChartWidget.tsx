/**
 * BarChartWidget - Displays bucketed bar chart visualization on the dashboard.
 *
 * Split into a presentational `BarChartView` and a fetching container. The view
 * links to the full chart page only when an `href` is supplied (home dashboard).
 */

import type { BarChartConfig, BarChartData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchChartData } from '../../state/api'
import { buildChartUrl } from '../../utils/chart-url'
import { BarChart } from '../charts/BarChart'

/** Compute start/end ISO strings from lookback_days. */
function lookbackToRange(lookbackDays: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return { end: end.toISOString(), start: start.toISOString() }
}

interface BarChartViewProps {
  config: BarChartConfig
  data: BarChartData | null
  /** Optional link to the full chart page (home dashboard only). */
  href?: string
}

export function BarChartView({ config, data, href }: BarChartViewProps) {
  const { pattern, title, bucket_size } = config
  const displayTitle = title ?? `${pattern ?? 'chart'} (${bucket_size})`

  const body = (
    <>
      <h4>{displayTitle}</h4>
      <BarChart data={data?.buckets ?? []} color="#8b5cf6" height={200} />
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
}

export function BarChartWidget({ config }: BarChartWidgetProps) {
  const {
    source_type,
    pattern,
    tag_definition_id: activity_type_id,
    title,
    bucket_size,
    lookback_days,
    aggregation = 'count',
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
      }),
    queryKey: ['chart-data', source_type, pattern, activity_type_id, bucket_size, lookback_days, aggregation],
    staleTime: 5 * 60 * 1000,
  })

  const displayTitle = title ?? `${pattern ?? 'chart'} (${bucket_size})`
  const chartUrl = buildChartUrl({
    aggregation,
    bucket_size,
    chart_type: 'bar',
    lookback_days,
    pattern: pattern ?? undefined,
    source_type,
    activity_type_id,
  })

  if (chartQuery.isLoading) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-loading">Loading chart data...</div>
      </div>
    )
  }

  if (chartQuery.isError || !chartQuery.data) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-error">Unable to load chart data</div>
      </div>
    )
  }

  const data: BarChartData = { buckets: chartQuery.data.buckets }

  return <BarChartView config={config} data={data} href={chartUrl} />
}
