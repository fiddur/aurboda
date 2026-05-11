/**
 * MetricCardWidget - Displays a single metric value with optional trend indicator.
 */

import type { MetricCardConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { endOfDay, startOfDay, subDays } from 'date-fns'

import {
  fetchBaseline,
  fetchPeriodSummary,
  periodStatsValue,
  type BaselineData,
  type PeriodMetricStats,
} from '../../state/api'

// Trend indicator component
function TrendIndicator({ value, inverse = false }: { value: number | null; inverse?: boolean }) {
  if (value === null) return null

  const isPositive = inverse ? value < 0 : value > 0
  const arrow = value > 0 ? '\u2191' : value < 0 ? '\u2193' : '\u2192'
  const className = isPositive ? 'trend-positive' : value === 0 ? 'trend-neutral' : 'trend-negative'

  return (
    <span class={`trend-indicator ${className}`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

interface MetricCardWidgetProps {
  config: MetricCardConfig
}

// Baseline metrics that come from the baseline API
const baselineMetrics = ['hrv_7day', 'hrv_30day', 'rhr_7day', 'rhr_30day'] as const
type BaselineMetric = (typeof baselineMetrics)[number]

const isBaselineMetric = (metric: string): metric is BaselineMetric =>
  baselineMetrics.includes(metric as BaselineMetric)

const extractBaselineValue = (
  baseline: BaselineData | null,
  metric: BaselineMetric,
): { value: number | null; trend: number | null } => {
  if (!baseline) return { trend: null, value: null }

  switch (metric) {
    case 'hrv_7day':
      return { trend: baseline.hrv.trend_percent, value: baseline.hrv.avg7day }
    case 'hrv_30day':
      return { trend: null, value: baseline.hrv.avg30day }
    case 'rhr_7day':
      return { trend: baseline.resting_hr.trend_percent, value: baseline.resting_hr.avg7day }
    case 'rhr_30day':
      return { trend: null, value: baseline.resting_hr.avg30day }
    default:
      return { trend: null, value: null }
  }
}

// Map widget metric names to API metric names
const metricToApiMetric: Record<string, string> = {
  body_fat: 'body_fat',
  readiness_score: 'readiness_score',
  sleep_score: 'sleep_score',
  steps: 'steps',
  weight: 'weight',
  zone2_weekly: 'hr_zone_2_sec',
}

const extractPeriodValue = (
  periodSummary: Record<string, PeriodMetricStats> | null,
  metric: string,
): { value: number | string | null; trend: number | null; subtitle: string | undefined } => {
  if (!periodSummary) return { subtitle: undefined, trend: null, value: null }

  const apiMetric = metricToApiMetric[metric] ?? metric
  const stats = periodSummary[apiMetric]

  if (!stats) return { subtitle: undefined, trend: null, value: null }

  const avg = periodStatsValue(stats, 'avg')
  const max = periodStatsValue(stats, 'max')
  switch (metric) {
    case 'steps':
      return {
        subtitle: max !== null ? `Max: ${Math.round(max).toLocaleString()}` : undefined,
        trend: stats.change_from_previous_period_percent ?? null,
        value: avg !== null ? Math.round(avg).toLocaleString() : null,
      }
    case 'zone2_weekly':
      return {
        subtitle: undefined,
        trend: stats.change_from_previous_period_percent ?? null,
        value: avg !== null ? Math.round((avg * 7) / 60) : null,
      }
    default:
      return {
        subtitle: stats.count ? `${stats.count} days` : undefined,
        trend: stats.change_from_previous_period_percent ?? null,
        value: avg,
      }
  }
}

// eslint-disable-next-line complexity -- TODO: refactor
export function MetricCardWidget({ config }: MetricCardWidgetProps) {
  const { metric, title, unit, subtitle: configSubtitle, trend_inverse } = config

  const isBaseline = isBaselineMetric(metric)

  // Fetch baseline data for baseline metrics
  const baselineQuery = useQuery({
    enabled: isBaseline,
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch period summary for other metrics
  const end = endOfDay(new Date())
  const start30days = startOfDay(subDays(new Date(), 30))
  const apiMetric = metricToApiMetric[metric] ?? metric

  const periodSummaryQuery = useQuery({
    enabled: !isBaseline,
    queryFn: () => fetchPeriodSummary(start30days, end, [apiMetric]),
    queryKey: ['periodSummary', metric],
    staleTime: 5 * 60 * 1000,
  })

  let value: number | string | null = null
  let trend: number | null = null
  let dynamicSubtitle: string | undefined

  if (isBaseline) {
    const extracted = extractBaselineValue(baselineQuery.data ?? null, metric)
    value = extracted.value
    trend = extracted.trend
  } else if (periodSummaryQuery.data) {
    // Convert metrics array to record
    const metricsArray = periodSummaryQuery.data.metrics ?? []
    const periodSummary: Record<string, PeriodMetricStats> = {}
    for (const m of metricsArray) {
      periodSummary[m.metric] = m
    }
    const extracted = extractPeriodValue(periodSummary, metric)
    value = extracted.value
    trend = extracted.trend
    dynamicSubtitle = extracted.subtitle
  }

  const isLoading = isBaseline ? baselineQuery.isLoading : periodSummaryQuery.isLoading

  return (
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {trend !== null && <TrendIndicator value={trend} inverse={trend_inverse} />}
      </div>
      <div class="metric-value">
        {isLoading ? (
          <span class="loading-placeholder">...</span>
        ) : value !== null ? (
          <>
            <span class="value">{typeof value === 'number' ? value.toFixed(1) : value}</span>
            {unit && <span class="unit">{unit}</span>}
          </>
        ) : (
          <span class="no-data">No data</span>
        )}
      </div>
      {(configSubtitle || dynamicSubtitle) && (
        <div class="metric-subtitle">{configSubtitle ?? dynamicSubtitle}</div>
      )}
    </div>
  )
}
