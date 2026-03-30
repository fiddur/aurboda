/**
 * TrendChartWidget - Displays EMA trend visualization using the shared TrendLineChart.
 */

import type { TrendChartConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'

import { fetchTrend } from '../../state/api'
import { buildChartUrl } from '../../utils/chart-url'
import { TrendLineChart } from '../charts/TrendLineChart'

interface TrendChartWidgetProps {
  config: TrendChartConfig
}

export function TrendChartWidget({ config }: TrendChartWidgetProps) {
  const {
    source_type,
    pattern,
    title,
    half_life_days = 15,
    lookback_days = 90,
    display_period = 'monthly',
    aggregation = 'count',
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
      }),
    queryKey: ['trend', source_type, pattern, half_life_days, lookback_days, display_period, aggregation],
    staleTime: 5 * 60 * 1000,
  })

  const displayTitle = title ?? `${pattern} trend`
  const chartUrl = buildChartUrl({
    aggregation,
    chart_type: 'trend',
    display_period,
    half_life_days,
    lookback_days,
    pattern,
    source_type,
    tag_definition_id: config.tag_definition_id,
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

  return (
    <a href={chartUrl} class="chart-widget chart-widget-link">
      <h4>{displayTitle}</h4>
      <div class="chart-widget-value">
        {trendQuery.data.current_value.toFixed(1)} / {display_period}
      </div>
      <TrendLineChart data={trendQuery.data.history} color="#673ab8" height={150} compact />
    </a>
  )
}
