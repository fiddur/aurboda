import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useEffect, useRef } from 'preact/hooks'
import {
  fetchActivities,
  fetchBaseline,
  fetchPeriodSummary,
  fetchSleepScores,
  type Activity,
  type BaselineData,
  type PeriodMetricStats,
} from '../../state/api'

import './style.css'

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
  const arrow =
    value > 0 ? '\u2191'
    : value < 0 ? '\u2193'
    : '\u2192'
  const className =
    isPositive ? 'trend-positive'
    : value === 0 ? 'trend-neutral'
    : 'trend-negative'

  return (
    <span class={`trend-indicator ${className}`}>
      {arrow} {Math.abs(value).toFixed(1)}%
    </span>
  )
}

// Metric card component
function MetricCard({
  title,
  value,
  unit,
  trend,
  trendInverse,
  sparklineData,
  sparklineColor,
  subtitle,
}: {
  title: string
  value: number | string | null
  unit?: string
  trend?: number | null
  trendInverse?: boolean
  sparklineData?: [Date, number][]
  sparklineColor?: string
  subtitle?: string
}) {
  return (
    <div class="metric-card">
      <div class="metric-header">
        <span class="metric-title">{title}</span>
        {trend !== undefined && <TrendIndicator value={trend} inverse={trendInverse} />}
      </div>
      <div class="metric-value">
        {value !== null ?
          <>
            <span class="value">{typeof value === 'number' ? value.toFixed(1) : value}</span>
            {unit && <span class="unit">{unit}</span>}
          </>
        : <span class="no-data">No data</span>}
      </div>
      {subtitle && <div class="metric-subtitle">{subtitle}</div>}
      {sparklineData && sparklineColor && (
        <div class="metric-sparkline">
          <SparklineChart data={sparklineData} color={sparklineColor} />
        </div>
      )}
    </div>
  )
}

// Activity summary card
function ActivitySummary({ activities }: { activities: Activity[] }) {
  const exerciseSessions = activities.filter((a) => a.activityType === 'exercise')
  const sleepSessions = activities.filter((a) => a.activityType === 'sleep')
  const meditationSessions = activities.filter((a) => a.activityType === 'meditation')

  const totalExerciseMinutes = exerciseSessions.reduce((sum, a) => {
    if (!a.endTime) return sum
    return sum + (a.endTime.getTime() - a.startTime.getTime()) / 60000
  }, 0)

  const avgSleepHours =
    sleepSessions.length > 0 ?
      sleepSessions.reduce((sum, a) => {
        if (!a.endTime) return sum
        return sum + (a.endTime.getTime() - a.startTime.getTime()) / 3600000
      }, 0) / sleepSessions.length
    : null

  return (
    <div class="activity-summary">
      <h3>Last 7 Days</h3>
      <div class="activity-grid">
        <div class="activity-item">
          <span class="activity-icon exercise-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M6.5 6.5h11v11h-11z" />
              <path d="M6.5 17.5v3M17.5 17.5v3M6.5 3.5v3M17.5 3.5v3" />
            </svg>
          </span>
          <div class="activity-details">
            <span class="activity-value">{exerciseSessions.length}</span>
            <span class="activity-label">Workouts</span>
          </div>
          <div class="activity-sub">{Math.round(totalExerciseMinutes)} min total</div>
        </div>

        <div class="activity-item">
          <span class="activity-icon sleep-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          </span>
          <div class="activity-details">
            <span class="activity-value">{avgSleepHours !== null ? avgSleepHours.toFixed(1) : '--'}</span>
            <span class="activity-label">Avg Sleep (hrs)</span>
          </div>
          <div class="activity-sub">{sleepSessions.length} nights tracked</div>
        </div>

        <div class="activity-item">
          <span class="activity-icon meditation-icon">
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="12" cy="12" r="10" />
              <path d="M12 6v6l4 2" />
            </svg>
          </span>
          <div class="activity-details">
            <span class="activity-value">{meditationSessions.length}</span>
            <span class="activity-label">Meditations</span>
          </div>
          <div class="activity-sub">
            {meditationSessions.reduce((sum, a) => {
              if (!a.endTime) return sum
              return sum + (a.endTime.getTime() - a.startTime.getTime()) / 60000
            }, 0)}{' '}
            min total
          </div>
        </div>
      </div>
    </div>
  )
}

// Quick links section
function QuickLinks() {
  return (
    <div class="quick-links">
      <h3>Explore</h3>
      <div class="links-grid">
        <a href="/timeline" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M3 3v18h18" />
              <path d="M18 17l-5-5-4 4-5-5" />
            </svg>
          </span>
          <span class="link-text">Timeline</span>
        </a>
        <a href="/sleep" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 12.79A9 9 0 1111.21 3 7 7 0 0021 12.79z" />
            </svg>
          </span>
          <span class="link-text">Sleep</span>
        </a>
        <a href="/hr-zones" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 000-7.78z" />
            </svg>
          </span>
          <span class="link-text">HR Zones</span>
        </a>
        <a href="/correlations" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <circle cx="6" cy="6" r="3" />
              <circle cx="18" cy="18" r="3" />
              <path d="M8.5 8.5l7 7" />
            </svg>
          </span>
          <span class="link-text">Correlations</span>
        </a>
        <a href="/goals" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
              <path d="M22 4L12 14.01l-3-3" />
            </svg>
          </span>
          <span class="link-text">Goals</span>
        </a>
        <a href="/places" class="quick-link">
          <span class="link-icon">
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" />
              <circle cx="12" cy="10" r="3" />
            </svg>
          </span>
          <span class="link-text">Places</span>
        </a>
      </div>
    </div>
  )
}

export function Dashboard() {
  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))
  const start30days = startOfDay(subDays(new Date(), 30))

  // Fetch baseline data
  const baselineQuery = useQuery({
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch 30-day period summary for metrics overview
  const periodSummaryQuery = useQuery({
    queryFn: () =>
      fetchPeriodSummary(start30days, end, [
        'sleep_score',
        'readiness_score',
        'steps',
        'hr_zone_2_sec',
        'weight',
      ]),
    queryKey: ['periodSummary', formatISO(start30days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch sleep scores for sparkline
  const sleepScoresQuery = useQuery({
    queryFn: () => fetchSleepScores(start30days, end),
    queryKey: ['sleepScores', formatISO(start30days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch 7-day activities
  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(start7days, end),
    queryKey: ['activities7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const baseline: BaselineData | null = baselineQuery.data ?? null
  // Convert metrics array to record keyed by metric name
  const metricsArray = periodSummaryQuery.data?.metrics ?? []
  const periodSummary: Record<string, PeriodMetricStats> = {}
  for (const m of metricsArray) {
    periodSummary[m.metric] = m
  }
  const sleepScores = sleepScoresQuery.data ?? []
  const activities = activitiesQuery.data ?? []

  const isLoading =
    baselineQuery.isLoading ||
    periodSummaryQuery.isLoading ||
    sleepScoresQuery.isLoading ||
    activitiesQuery.isLoading

  return (
    <div class="dashboard">
      <h1>Dashboard</h1>

      {isLoading && <div class="loading">Loading your health data...</div>}

      {/* Baseline metrics */}
      <section class="metrics-section">
        <h2>Your Baseline</h2>
        <div class="metrics-grid">
          <MetricCard
            title="HRV (7-day)"
            value={baseline?.hrv.avg7day ?? null}
            unit="ms"
            trend={baseline?.hrv.trendPercent}
            subtitle="Heart Rate Variability"
          />
          <MetricCard
            title="HRV (30-day)"
            value={baseline?.hrv.avg30day ?? null}
            unit="ms"
            subtitle="Long-term average"
          />
          <MetricCard
            title="Resting HR (7-day)"
            value={baseline?.restingHr.avg7day ?? null}
            unit="bpm"
            trend={baseline?.restingHr.trendPercent}
            trendInverse={true}
            subtitle="Lower is generally better"
          />
          <MetricCard
            title="Resting HR (30-day)"
            value={baseline?.restingHr.avg30day ?? null}
            unit="bpm"
            subtitle="Long-term average"
          />
        </div>
      </section>

      {/* Period summary metrics */}
      <section class="metrics-section">
        <h2>30-Day Summary</h2>
        <div class="metrics-grid">
          <MetricCard
            title="Sleep Score"
            value={periodSummary.sleep_score?.avg ?? null}
            trend={periodSummary.sleep_score?.changeFromPreviousPeriodPercent}
            sparklineData={sleepScores}
            sparklineColor="#3b82f6"
            subtitle={periodSummary.sleep_score ? `${periodSummary.sleep_score.count} nights` : undefined}
          />
          <MetricCard
            title="Readiness Score"
            value={periodSummary.readiness_score?.avg ?? null}
            trend={periodSummary.readiness_score?.changeFromPreviousPeriodPercent}
            subtitle={
              periodSummary.readiness_score ? `${periodSummary.readiness_score.count} days` : undefined
            }
          />
          <MetricCard
            title="Daily Steps"
            value={periodSummary.steps?.avg ? Math.round(periodSummary.steps.avg).toLocaleString() : null}
            trend={periodSummary.steps?.changeFromPreviousPeriodPercent}
            subtitle={
              periodSummary.steps ? `Max: ${Math.round(periodSummary.steps.max).toLocaleString()}` : undefined
            }
          />
          <MetricCard
            title="Zone 2 (Weekly)"
            value={
              periodSummary.hr_zone_2_sec?.avg ? Math.round((periodSummary.hr_zone_2_sec.avg * 7) / 60) : null
            }
            unit="min"
            trend={periodSummary.hr_zone_2_sec?.changeFromPreviousPeriodPercent}
            subtitle="Target: 150-200 min/week"
          />
        </div>
      </section>

      {/* Activity summary */}
      <section class="metrics-section">
        <ActivitySummary activities={activities} />
      </section>

      {/* Quick links */}
      <section class="metrics-section">
        <QuickLinks />
      </section>
    </div>
  )
}
