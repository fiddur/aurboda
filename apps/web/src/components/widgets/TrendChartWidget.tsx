/**
 * TrendChartWidget - Displays EMA trend visualization using the shared TrendLineChart.
 *
 * Split into a presentational `TrendChartView` and a fetching container. The
 * view links to the full chart page only when an `href` is supplied (the home
 * dashboard); the public renderer omits it.
 */

import type { TrendChartConfig, TrendChartData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchTrend } from '../../state/api'
import { buildChartUrl, type ChartOrigin } from '../../utils/chart-url'
import { BreakdownLegend, SERIES_COLORS } from '../charts/breakdown'
import { TrendLineChart } from '../charts/TrendLineChart'

interface TrendChartViewProps {
  config: TrendChartConfig
  data: TrendChartData | null
  /** Optional link to the full chart page (home dashboard only). */
  href?: string
}

export function TrendChartView({ config, data, href }: TrendChartViewProps) {
  const { pattern, title, display_period = 'monthly' } = config
  const displayTitle = title ?? `${pattern} trend`

  const breakdownSeries = data?.breakdown_series
  const breakdownHistories = data?.breakdown_histories
  const showBreakdown = Boolean(breakdownSeries?.length && breakdownHistories)

  const body = (
    <>
      <div class="chart-widget-header">
        <h4>{displayTitle}</h4>
        {data && !showBreakdown && (
          <span class="chart-widget-value">
            {data.current_value.toFixed(1)} / {display_period}
          </span>
        )}
      </div>
      {breakdownSeries && breakdownSeries.length > 0 && breakdownHistories ? (
        <>
          <BreakdownLegend series={breakdownSeries} />
          <TrendLineChart
            data={[]}
            color="#673ab8"
            height={150}
            compact
            multiSeries={breakdownSeries.map((name, i) => ({
              color: SERIES_COLORS[i % SERIES_COLORS.length],
              data: breakdownHistories[name] ?? [],
              name,
            }))}
          />
        </>
      ) : (
        <TrendLineChart data={data?.history ?? []} color="#673ab8" height={150} compact />
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

interface TrendChartWidgetProps {
  config: TrendChartConfig
  /** When rendered inside a board, links back to /chart carrying this widget's origin. */
  origin?: ChartOrigin
}

export function TrendChartWidget({ config, origin }: TrendChartWidgetProps) {
  const {
    source_type,
    pattern,
    title,
    half_life_days = 15,
    lookback_days = 90,
    display_period = 'monthly',
    aggregation = 'count',
    breakdown_fields,
  } = config

  const trendQuery = useQuery({
    queryFn: () =>
      fetchTrend({
        aggregation,
        display_period,
        half_life_days,
        lookback_days,
        pattern,
        source_type,
        ...(breakdown_fields?.length ? { breakdown_fields } : {}),
      }),
    queryKey: [
      'trend',
      source_type,
      pattern,
      half_life_days,
      lookback_days,
      display_period,
      aggregation,
      breakdown_fields,
    ],
    staleTime: 5 * 60 * 1000,
  })

  const displayTitle = title ?? `${pattern} trend`
  const chartUrl = buildChartUrl({
    aggregation,
    breakdown_fields,
    chart_type: 'trend',
    display_period,
    half_life_days,
    lookback_days,
    pattern,
    source_type,
    activity_type_id: config.tag_definition_id,
    origin,
  })

  if (trendQuery.isLoading) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-loading">Loading trend data...</div>
      </div>
    )
  }

  if (trendQuery.isError || !trendQuery.data) {
    return (
      <div class="chart-widget">
        <h4>{displayTitle}</h4>
        <div class="chart-error">Unable to load trend data</div>
      </div>
    )
  }

  const data: TrendChartData = {
    current_value: trendQuery.data.current_value,
    history: trendQuery.data.history,
    ...(trendQuery.data.breakdown_series?.length
      ? {
          breakdown_histories: trendQuery.data.breakdown_histories,
          breakdown_series: trendQuery.data.breakdown_series,
        }
      : {}),
  }

  return <TrendChartView config={config} data={data} href={chartUrl} />
}
