/**
 * SparklineCardWidget - Displays a metric value with a small sparkline chart.
 *
 * Split into a presentational `SparklineCardView` and a fetching container.
 */

import type { SparklineCardConfig, SparklineCardData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'

import {
  fetchHrv,
  fetchHrvSleep,
  fetchMetricTimeSeries,
  fetchPeriodSummary,
  fetchReadinessScores,
  fetchRestingHeartRate,
  fetchSleepScores,
  fetchSteps,
  periodStatsValue,
  type PeriodMetricStats,
} from '../../state/api'
import { SparklineChart } from '../SparklineChart'
import { TrendIndicator } from './TrendIndicator'

// Map metric names to display titles
const metricTitles: Record<string, string> = {
  hrv_rmssd: 'HRV',
  hrv_sleep: 'HRV (Sleep)',
  readiness_score: 'Readiness Score',
  resting_heart_rate: 'Resting HR',
  sleep_score: 'Sleep Score',
  steps: 'Steps',
}

// Map metric names to API fetch functions
const metricFetchers: Record<string, (start: Date, end: Date) => Promise<[Date, number][]>> = {
  hrv_rmssd: fetchHrv,
  hrv_sleep: fetchHrvSleep,
  readiness_score: fetchReadinessScores,
  resting_heart_rate: fetchRestingHeartRate,
  sleep_score: fetchSleepScores,
  steps: fetchSteps,
}

// Map widget metric to API metric name for period summary
const metricToApiMetric: Record<string, string> = {
  hrv_rmssd: 'hrv_rmssd',
  hrv_sleep: 'hrv_sleep',
  readiness_score: 'readiness_score',
  resting_heart_rate: 'resting_heart_rate',
  sleep_score: 'sleep_score',
  steps: 'steps',
}

interface SparklineCardViewProps {
  config: SparklineCardConfig
  data: SparklineCardData | null
  loading?: boolean
}

// eslint-disable-next-line complexity -- TODO: refactor
export function SparklineCardView({ config, data, loading = false }: SparklineCardViewProps) {
  const { metric, title: configTitle, color = '#3b82f6' } = config
  const title = configTitle ?? metricTitles[metric] ?? metric

  const value = data?.value ?? null
  const trend = data?.trend_percent ?? null
  const subtitle = data?.count ? `${data.count} days` : undefined
  const sparklineData: [Date, number][] = (data?.series ?? []).map((p) => [new Date(p.time), p.value])

  return (
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {trend !== null && <TrendIndicator value={trend} />}
      </div>
      <div class="metric-value">
        {loading ? (
          <span class="loading-placeholder">...</span>
        ) : value !== null ? (
          <span class="value">{value.toFixed(1)}</span>
        ) : (
          <span class="no-data">No data</span>
        )}
      </div>
      {subtitle && <div class="metric-subtitle">{subtitle}</div>}
      <div class="metric-sparkline">
        {loading ? (
          <div class="sparkline-placeholder">Loading...</div>
        ) : (
          <SparklineChart data={sparklineData} color={color} />
        )}
      </div>
    </div>
  )
}

interface SparklineCardWidgetProps {
  config: SparklineCardConfig
}

export function SparklineCardWidget({ config }: SparklineCardWidgetProps) {
  const { metric, lookback_days = 30 } = config

  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), lookback_days))

  const fetcher = metricFetchers[metric] ?? ((s: Date, e: Date) => fetchMetricTimeSeries(metric, s, e))
  const timeSeriesQuery = useQuery({
    queryFn: () => fetcher(start, end),
    queryKey: ['sparkline', metric, formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const apiMetric = metricToApiMetric[metric] ?? metric
  const periodSummaryQuery = useQuery({
    queryFn: () => fetchPeriodSummary(start, end, [apiMetric]),
    queryKey: ['periodSummary', metric, formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  let stats: PeriodMetricStats | undefined
  if (periodSummaryQuery.data) {
    stats = (periodSummaryQuery.data.metrics ?? []).find((m) => m.metric === apiMetric)
  }

  const data: SparklineCardData = {
    count: stats?.count ?? null,
    series: (timeSeriesQuery.data ?? []).map(([time, value]) => ({ time: time.toISOString(), value })),
    trend_percent: stats?.change_from_previous_period_percent ?? null,
    value: stats ? periodStatsValue(stats, 'avg') : null,
  }

  const loading = timeSeriesQuery.isLoading || periodSummaryQuery.isLoading

  return <SparklineCardView config={config} data={data} loading={loading} />
}
