/**
 * SparklineCardWidget - Displays a metric value with a small sparkline chart.
 */

import type { SparklineCardConfig } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useEffect, useRef } from 'preact/hooks'

import {
  fetchHrv,
  fetchMetricTimeSeries,
  fetchPeriodSummary,
  fetchReadinessScores,
  fetchRestingHeartRate,
  fetchSleepScores,
  fetchSteps,
  type PeriodMetricStats,
} from '../../state/api'

// Sparkline chart component using D3
function SparklineChart({
  data,
  color,
  width = 120,
  height = 40,
}: {
  data: [Date, number][]
  color: string
  width?: number
  height?: number
}) {
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || data.length < 2) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 4, left: 4, right: 4, top: 4 }
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    const x = d3
      .scaleTime()
      .domain(d3.extent(data, (d) => d[0]) as [Date, Date])
      .range([0, innerWidth])

    const yExtent = d3.extent(data, (d) => d[1]) as [number, number]
    const yPadding = (yExtent[1] - yExtent[0]) * 0.1 || 5
    const y = d3
      .scaleLinear()
      .domain([yExtent[0] - yPadding, yExtent[1] + yPadding])
      .range([innerHeight, 0])

    const line = d3
      .line<[Date, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    const g = svg.append('g').attr('transform', `translate(${margin.left},${margin.top})`)

    // Area fill
    const area = d3
      .area<[Date, number]>()
      .x((d) => x(d[0]))
      .y0(innerHeight)
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(data).attr('fill', color).attr('fill-opacity', 0.15).attr('d', area)

    // Line
    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', color)
      .attr('stroke-width', 1.5)
      .attr('d', line)

    // Latest point dot
    const latest = data[data.length - 1]
    g.append('circle').attr('cx', x(latest[0])).attr('cy', y(latest[1])).attr('r', 3).attr('fill', color)
  }, [data, color, width, height])

  if (data.length < 2) {
    return <div class="sparkline-placeholder">Insufficient data</div>
  }

  return <svg ref={svgRef} width={width} height={height} />
}

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

interface SparklineCardWidgetProps {
  config: SparklineCardConfig
}

// Map metric names to display titles
const metricTitles: Record<string, string> = {
  hrv_rmssd: 'HRV',
  readiness_score: 'Readiness Score',
  resting_heart_rate: 'Resting HR',
  sleep_score: 'Sleep Score',
  steps: 'Steps',
}

// Map metric names to API fetch functions
const metricFetchers: Record<string, (start: Date, end: Date) => Promise<[Date, number][]>> = {
  hrv_rmssd: fetchHrv,
  readiness_score: fetchReadinessScores,
  resting_heart_rate: fetchRestingHeartRate,
  sleep_score: fetchSleepScores,
  steps: fetchSteps,
}

// Map widget metric to API metric name for period summary
const metricToApiMetric: Record<string, string> = {
  hrv_rmssd: 'hrv_rmssd',
  readiness_score: 'readiness_score',
  resting_heart_rate: 'resting_heart_rate',
  sleep_score: 'sleep_score',
  steps: 'steps',
}

// eslint-disable-next-line complexity -- TODO: refactor
export function SparklineCardWidget({ config }: SparklineCardWidgetProps) {
  const { metric, title: configTitle, lookback_days = 30, color = '#3b82f6' } = config

  const title = configTitle ?? metricTitles[metric] ?? metric
  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), lookback_days))

  // Fetch time series data for sparkline
  const fetcher = metricFetchers[metric] ?? ((s: Date, e: Date) => fetchMetricTimeSeries(metric, s, e))
  const timeSeriesQuery = useQuery({
    queryFn: () => fetcher(start, end),
    queryKey: ['sparkline', metric, formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch period summary for the value and trend
  const apiMetric = metricToApiMetric[metric] ?? metric
  const periodSummaryQuery = useQuery({
    queryFn: () => fetchPeriodSummary(start, end, [apiMetric]),
    queryKey: ['periodSummary', metric, formatISO(start, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Extract value and trend from period summary
  let value: number | null = null
  let trend: number | null = null
  let subtitle: string | undefined

  if (periodSummaryQuery.data) {
    const metricsArray = periodSummaryQuery.data.metrics ?? []
    const periodSummary: Record<string, PeriodMetricStats> = {}
    for (const m of metricsArray) {
      periodSummary[m.metric] = m
    }
    const stats = periodSummary[apiMetric]
    if (stats) {
      value = stats.avg ?? null
      trend = stats.change_from_previous_period_percent ?? null
      subtitle = stats.count ? `${stats.count} days` : undefined
    }
  }

  const sparklineData = timeSeriesQuery.data ?? []
  const isLoading = timeSeriesQuery.isLoading || periodSummaryQuery.isLoading

  return (
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {trend !== null && <TrendIndicator value={trend} />}
      </div>
      <div class="metric-value">
        {isLoading ? (
          <span class="loading-placeholder">...</span>
        ) : value !== null ? (
          <span class="value">{value.toFixed(1)}</span>
        ) : (
          <span class="no-data">No data</span>
        )}
      </div>
      {subtitle && <div class="metric-subtitle">{subtitle}</div>}
      <div class="metric-sparkline">
        {isLoading ? (
          <div class="sparkline-placeholder">Loading...</div>
        ) : (
          <SparklineChart data={sparklineData} color={color} />
        )}
      </div>
    </div>
  )
}
