/**
 * Split into a presentational `BarChartView` and a fetching container. The view
 * links to the full chart page only when an `href` is supplied (home dashboard).
 */

import {
  type BarChartConfig,
  type BarChartData,
  journalChartFiltersOf,
  muscleGroupFilter,
} from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'preact/hooks'

import { fetchChartData } from '../../state/api'
import { CHART_PRIMARY } from '../../theme'
import { isAllTime, widgetRange } from '../../utils/chart-range'
import { buildChartUrl, type ChartOrigin } from '../../utils/chart-url'
import { BarChart } from '../charts/BarChart'
import { BreakdownLegend, breakdownBarSeries } from '../charts/breakdown'
import { useChartFirstDay } from '../charts/useChartFirstDay'
import { barsFetchParams } from './chartFetchParams'
import { journalChartTitle, measureChartTitle } from './chartTitle'
import { HEAVY_QUERY_OPTIONS } from './heavyQuery'

const NO_BUCKETS: BarChartData['buckets'] = []

interface BarChartViewProps {
  config: BarChartConfig
  data: BarChartData | null
  /** Optional link to the full chart page (home dashboard only). */
  href?: string
}

const barChartTitle = (config: BarChartConfig): string =>
  config.title ??
  journalChartTitle(config) ??
  measureChartTitle(config) ??
  `${config.pattern ?? 'chart'} (${config.bucket_size})`

/** A journal breakdown's tags or people are parts of one count, and a muscle group's parts of one measure. */
const stackedBars = (config: BarChartConfig): boolean =>
  config.source_type === 'journal' ||
  muscleGroupFilter(config.filter_field, config.filter_value) !== undefined

export function BarChartView({ config, data, href }: BarChartViewProps) {
  const { bucket_size } = config
  const displayTitle = barChartTitle(config)

  const breakdownSeries = data?.breakdown_series
  const breakdownBuckets = data?.breakdown_buckets
  const multiSeries = useMemo(
    () => breakdownBarSeries(breakdownSeries, breakdownBuckets),
    [breakdownSeries, breakdownBuckets],
  )

  const body = (
    <>
      <h4>{displayTitle}</h4>
      {breakdownSeries && multiSeries ? (
        <>
          <BreakdownLegend series={breakdownSeries} />
          <BarChart
            data={NO_BUCKETS}
            height={200}
            bucketSize={bucket_size}
            multiSeries={multiSeries}
            stacked={stackedBars(config)}
          />
        </>
      ) : (
        <BarChart
          data={data?.buckets ?? NO_BUCKETS}
          color={CHART_PRIMARY}
          height={200}
          bucketSize={bucket_size}
        />
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
    bucket_size,
    lookback_days,
    breakdown_fields,
    measure,
    filter_field,
    filter_value,
    since,
  } = config
  const hasSource = source_type === 'journal' || Boolean(pattern ?? activity_type_id)
  const { firstDay, pending } = useChartFirstDay(
    {
      ...(activity_type_id ? { activity_type_id } : {}),
      pattern,
      source_type,
      ...journalChartFiltersOf(config),
    },
    hasSource && isAllTime(lookback_days, since),
  )
  const params = barsFetchParams(config, widgetRange(lookback_days, since, new Date(), firstDay))
  const { aggregation } = params
  const journalFilters = journalChartFiltersOf(params)

  const chartQuery = useQuery({
    enabled: hasSource && !pending,
    queryFn: () => fetchChartData({ ...params, ...(breakdown_fields?.length ? { breakdown_fields } : {}) }),
    queryKey: [
      'chart-data',
      source_type,
      pattern,
      activity_type_id,
      bucket_size,
      lookback_days,
      since,
      firstDay,
      aggregation,
      breakdown_fields,
      measure,
      filter_field,
      filter_value,
      journalFilters,
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

  const displayTitle = barChartTitle(config)
  const chartUrl = buildChartUrl({
    aggregation,
    breakdown_fields,
    bucket_size,
    chart_type: 'bar',
    lookback_days,
    pattern: pattern ?? undefined,
    since,
    source_type,
    activity_type_id,
    measure: params.measure,
    filter_field: params.filter_field,
    filter_value: params.filter_value,
    ...journalFilters,
    origin,
  })

  if (pending || chartQuery.isLoading) {
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
