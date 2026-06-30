/**
 * MetricCardWidget - Displays a single metric value with optional trend indicator.
 *
 * Split into a presentational `MetricCardView` (renders from a resolved data
 * payload) and a `MetricCardWidget` container that fetches and maps to that
 * payload. The public shared-dashboard renderer reuses `MetricCardView`.
 */

import type { MetricCardConfig, MetricCardData } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { endOfDay, startOfDay, subDays } from 'date-fns'

import {
  fetchBaseline,
  fetchPeriodSummary,
  periodStatsValue,
  type BaselineData,
  type PeriodMetricStats,
} from '../../state/api'
import { TrendIndicator } from './TrendIndicator'

// Baseline metrics that come from the baseline API
const baselineMetrics = ['hrv_7day', 'hrv_30day', 'rhr_7day', 'rhr_30day'] as const
type BaselineMetric = (typeof baselineMetrics)[number]

const isBaselineMetric = (metric: string): metric is BaselineMetric =>
  baselineMetrics.includes(metric as BaselineMetric)

// Map widget metric names to API metric names
const metricToApiMetric: Record<string, string> = {
  body_fat: 'body_fat',
  readiness_score: 'readiness_score',
  sleep_score: 'sleep_score',
  steps: 'steps',
  weight: 'weight',
  zone2_weekly: 'hr_zone_2_sec',
}

const baselineToData = (baseline: BaselineData | null, metric: BaselineMetric): MetricCardData => {
  const empty = { count: null, max: null }
  if (!baseline) return { ...empty, trend_percent: null, value: null }
  switch (metric) {
    case 'hrv_7day':
      return { ...empty, trend_percent: baseline.hrv.trend_percent, value: baseline.hrv.avg7day }
    case 'hrv_30day':
      return { ...empty, trend_percent: null, value: baseline.hrv.avg30day }
    case 'rhr_7day':
      return { ...empty, trend_percent: baseline.resting_hr.trend_percent, value: baseline.resting_hr.avg7day }
    case 'rhr_30day':
      return { ...empty, trend_percent: null, value: baseline.resting_hr.avg30day }
  }
}

const periodToData = (stats: PeriodMetricStats | undefined): MetricCardData => ({
  count: stats?.count ?? null,
  max: stats ? periodStatsValue(stats, 'max') : null,
  trend_percent: stats?.change_from_previous_period_percent ?? null,
  value: stats ? periodStatsValue(stats, 'avg') : null,
})

/** Compute the display string + dynamic subtitle for a metric card. */
const computeDisplay = (
  metric: string,
  data: MetricCardData | null,
): { display: string | null; dynamicSubtitle?: string } => {
  const value = data?.value ?? null
  const max = data?.max ?? null
  const count = data?.count ?? null
  switch (metric) {
    case 'steps':
      return {
        display: value !== null ? Math.round(value).toLocaleString() : null,
        dynamicSubtitle: max !== null ? `Max: ${Math.round(max).toLocaleString()}` : undefined,
      }
    case 'zone2_weekly':
      return { display: value !== null ? String(Math.round((value * 7) / 60)) : null }
    default:
      return {
        display: value !== null ? value.toFixed(1) : null,
        dynamicSubtitle: count ? `${count} days` : undefined,
      }
  }
}

interface MetricCardViewProps {
  config: MetricCardConfig
  data: MetricCardData | null
  /** When true, render the loading placeholder instead of the value. */
  loading?: boolean
}

export function MetricCardView({ config, data, loading = false }: MetricCardViewProps) {
  const { metric, title, unit, subtitle: configSubtitle, trend_inverse } = config
  const trend = data?.trend_percent ?? null
  const { display, dynamicSubtitle } = computeDisplay(metric, data)

  return (
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {trend !== null && <TrendIndicator value={trend} inverse={trend_inverse} />}
      </div>
      <div class="metric-value">
        {loading ? (
          <span class="loading-placeholder">...</span>
        ) : display !== null ? (
          <>
            <span class="value">{display}</span>
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

interface MetricCardWidgetProps {
  config: MetricCardConfig
}

export function MetricCardWidget({ config }: MetricCardWidgetProps) {
  const { metric } = config
  const isBaseline = isBaselineMetric(metric)

  const baselineQuery = useQuery({
    enabled: isBaseline,
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  const end = endOfDay(new Date())
  const start30days = startOfDay(subDays(new Date(), 30))
  const apiMetric = metricToApiMetric[metric] ?? metric

  const periodSummaryQuery = useQuery({
    enabled: !isBaseline,
    queryFn: () => fetchPeriodSummary(start30days, end, [apiMetric]),
    queryKey: ['periodSummary', metric],
    staleTime: 5 * 60 * 1000,
  })

  let data: MetricCardData | null = null
  if (isBaseline) {
    data = baselineToData(baselineQuery.data ?? null, metric)
  } else if (periodSummaryQuery.data) {
    const stats = (periodSummaryQuery.data.metrics ?? []).find((m) => m.metric === apiMetric)
    data = periodToData(stats)
  }

  const loading = isBaseline ? baselineQuery.isLoading : periodSummaryQuery.isLoading

  return <MetricCardView config={config} data={data} loading={loading} />
}
