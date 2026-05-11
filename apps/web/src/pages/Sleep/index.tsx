import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useEffect, useRef } from 'preact/hooks'

import {
  fetchActivities,
  fetchPeriodSummary,
  fetchSleepScores,
  periodStatsValue,
  type Activity,
} from '../../state/api'
import { getSleepScoreEmptyState } from './emptyState'
import './style.css'

// Date range signal (default 30 days)
const daysBack = signal(30)

// Sleep score line chart component
function SleepScoreChart({
  data,
  hasSleepSessions,
  height = 200,
}: {
  data: [Date, number][]
  hasSleepSessions: boolean
  height?: number
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || data.length < 2) return

    const containerWidth = containerRef.current.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 45, right: 20, top: 20 }
    const width = containerWidth
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Scales
    const x = d3
      .scaleTime()
      .domain(d3.extent(data, (d) => d[0]) as [Date, Date])
      .range([0, innerWidth])

    const yMin = Math.max(0, (d3.min(data, (d) => d[1]) ?? 0) - 10)
    const yMax = 100
    const y = d3.scaleLinear().domain([yMin, yMax]).range([innerHeight, 0])

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Gradient fill
    const gradient = svg
      .append('defs')
      .append('linearGradient')
      .attr('id', 'sleep-gradient')
      .attr('x1', '0%')
      .attr('y1', '0%')
      .attr('x2', '0%')
      .attr('y2', '100%')

    gradient.append('stop').attr('offset', '0%').attr('stop-color', '#3b82f6').attr('stop-opacity', 0.3)
    gradient.append('stop').attr('offset', '100%').attr('stop-color', '#3b82f6').attr('stop-opacity', 0.05)

    // Area
    const area = d3
      .area<[Date, number]>()
      .x((d) => x(d[0]))
      .y0(innerHeight)
      .y1((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    g.append('path').datum(data).attr('fill', 'url(#sleep-gradient)').attr('d', area)

    // Line
    const line = d3
      .line<[Date, number]>()
      .x((d) => x(d[0]))
      .y((d) => y(d[1]))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(data)
      .attr('fill', 'none')
      .attr('stroke', '#3b82f6')
      .attr('stroke-width', 2)
      .attr('d', line)

    // Points
    g.selectAll('.point')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'point')
      .attr('cx', (d) => x(d[0]))
      .attr('cy', (d) => y(d[1]))
      .attr('r', 3)
      .attr('fill', '#3b82f6')
      .attr('stroke', 'white')
      .attr('stroke-width', 1)

    // Average line
    const avgScore = d3.mean(data, (d) => d[1]) ?? 0
    g.append('line')
      .attr('x1', 0)
      .attr('y1', y(avgScore))
      .attr('x2', innerWidth)
      .attr('y2', y(avgScore))
      .attr('stroke', '#94a3b8')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')

    g.append('text')
      .attr('x', innerWidth - 5)
      .attr('y', y(avgScore) - 5)
      .attr('text-anchor', 'end')
      .attr('fill', '#64748b')
      .attr('font-size', '11px')
      .text(`Avg: ${avgScore.toFixed(0)}`)

    // Axes
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .ticks(6)
          .tickFormat((d) => d3.timeFormat('%b %d')(d as Date)),
      )
      .selectAll('text')
      .attr('fill', 'currentColor')

    g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('fill', 'currentColor')

    // Y-axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -35)
      .attr('x', -innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', '12px')
      .text('Sleep Score')
  }, [data, height])

  const emptyState = getSleepScoreEmptyState(data.length, hasSleepSessions)
  if (emptyState) {
    return (
      <div class="chart-placeholder">
        {emptyState.message}
        {emptyState.linkHref && (
          <>
            {' '}
            <a href={emptyState.linkHref}>{emptyState.linkLabel}</a>.
          </>
        )}
      </div>
    )
  }

  return (
    <div ref={containerRef} class="chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

// Sleep duration bar chart
function SleepDurationChart({ sleepSessions, height = 180 }: { sleepSessions: Activity[]; height?: number }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current || sleepSessions.length < 2) return

    // Calculate duration per night
    const durationData = sleepSessions
      .filter((s) => s.end_time)
      .map((s) => ({
        date: s.start_time,
        hours: (s.duration ?? (s.end_time!.getTime() - s.start_time.getTime()) / 60000) / 60,
      }))
      .sort((a, b) => a.date.getTime() - b.date.getTime())

    const containerWidth = containerRef.current.clientWidth
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 45, right: 20, top: 20 }
    const width = containerWidth
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Scales
    const x = d3
      .scaleBand()
      .domain(durationData.map((d) => d.date.toISOString()))
      .range([0, innerWidth])
      .padding(0.2)

    const yMax = Math.max(10, d3.max(durationData, (d) => d.hours) ?? 10)
    const y = d3.scaleLinear().domain([0, yMax]).range([innerHeight, 0])

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // Target zone (7-9 hours)
    g.append('rect')
      .attr('x', 0)
      .attr('y', y(9))
      .attr('width', innerWidth)
      .attr('height', y(7) - y(9))
      .attr('fill', '#22c55e')
      .attr('fill-opacity', 0.1)

    // Bars
    g.selectAll('.bar')
      .data(durationData)
      .enter()
      .append('rect')
      .attr('class', 'bar')
      .attr('x', (d) => x(d.date.toISOString())!)
      .attr('y', (d) => y(d.hours))
      .attr('width', x.bandwidth())
      .attr('height', (d) => innerHeight - y(d.hours))
      .attr('fill', (d) => (d.hours >= 7 && d.hours <= 9 ? '#22c55e' : d.hours < 6 ? '#ef4444' : '#f59e0b'))
      .attr('rx', 2)

    // Average line
    const avgDuration = d3.mean(durationData, (d) => d.hours) ?? 0
    g.append('line')
      .attr('x1', 0)
      .attr('y1', y(avgDuration))
      .attr('x2', innerWidth)
      .attr('y2', y(avgDuration))
      .attr('stroke', '#64748b')
      .attr('stroke-width', 1)
      .attr('stroke-dasharray', '4,4')

    g.append('text')
      .attr('x', innerWidth - 5)
      .attr('y', y(avgDuration) - 5)
      .attr('text-anchor', 'end')
      .attr('fill', '#64748b')
      .attr('font-size', '11px')
      .text(`Avg: ${avgDuration.toFixed(1)}h`)

    // Axes
    const tickValues = durationData
      .filter((_, i) => i % Math.ceil(durationData.length / 8) === 0)
      .map((d) => d.date.toISOString())

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(
        d3
          .axisBottom(x)
          .tickValues(tickValues)
          .tickFormat((d) => d3.timeFormat('%b %d')(new Date(d))),
      )
      .selectAll('text')
      .attr('fill', 'currentColor')

    g.append('g').call(d3.axisLeft(y).ticks(5)).selectAll('text').attr('fill', 'currentColor')

    // Y-axis label
    g.append('text')
      .attr('transform', 'rotate(-90)')
      .attr('y', -35)
      .attr('x', -innerHeight / 2)
      .attr('text-anchor', 'middle')
      .attr('fill', 'currentColor')
      .attr('font-size', '12px')
      .text('Hours')
  }, [sleepSessions, height])

  if (sleepSessions.length < 2) {
    return <div class="chart-placeholder">Not enough sleep data to display chart</div>
  }

  return (
    <div ref={containerRef} class="chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

// Stats card component
function StatCard({
  label,
  value,
  unit,
  trend,
  description,
}: {
  label: string
  value: number | string | null
  unit?: string
  trend?: number | null
  description?: string
}) {
  const trendClass =
    trend !== null && trend !== undefined
      ? trend > 0
        ? 'trend-positive'
        : trend < 0
          ? 'trend-negative'
          : 'trend-neutral'
      : ''

  return (
    <div class="stat-card">
      <div class="stat-label">{label}</div>
      <div class="stat-value">
        {value !== null ? (
          <>
            {typeof value === 'number' ? value.toFixed(1) : value}
            {unit && <span class="stat-unit">{unit}</span>}
          </>
        ) : (
          <span class="no-data">No data</span>
        )}
      </div>
      {trend !== null && trend !== undefined && (
        <div class={`stat-trend ${trendClass}`}>
          {trend > 0 ? '\u2191' : trend < 0 ? '\u2193' : '\u2192'} {Math.abs(trend).toFixed(1)}%
        </div>
      )}
      {description && <div class="stat-description">{description}</div>}
    </div>
  )
}

// eslint-disable-next-line complexity -- TODO: refactor
export function Sleep() {
  const end = endOfDay(new Date())
  const start = startOfDay(subDays(new Date(), daysBack.value))

  // Fetch sleep scores
  const sleepScoresQuery = useQuery({
    queryFn: () => fetchSleepScores(start, end),
    queryKey: ['sleepScores', formatISO(start, { representation: 'date' }), daysBack.value],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch sleep-related period summary
  const periodSummaryQuery = useQuery({
    queryFn: () =>
      fetchPeriodSummary(start, end, [
        'sleep_score',
        'sleep_efficiency',
        'sleep_latency',
        'sleep_restfulness',
        'sleep_timing',
        'sleep_deep_score',
        'sleep_rem_score',
        'sleep_total_score',
      ]),
    queryKey: ['sleepPeriodSummary', formatISO(start, { representation: 'date' }), daysBack.value],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch sleep activities (for duration)
  const activitiesQuery = useQuery({
    queryFn: () => fetchActivities(start, end, ['sleep']),
    queryKey: ['sleepActivities', formatISO(start, { representation: 'date' }), daysBack.value],
    staleTime: 5 * 60 * 1000,
  })

  const sleepScores = sleepScoresQuery.data ?? []
  const sleepSessions = activitiesQuery.data ?? []
  const metricsArray = periodSummaryQuery.data?.metrics ?? []
  const metrics: Record<string, { avg: number | null; change_from_previous_period_percent: number | null }> =
    {}
  for (const m of metricsArray) {
    metrics[m.metric] = {
      avg: periodStatsValue(m, 'avg'),
      change_from_previous_period_percent: m.change_from_previous_period_percent,
    }
  }

  const isLoading = sleepScoresQuery.isLoading || periodSummaryQuery.isLoading || activitiesQuery.isLoading

  // Calculate average sleep duration (using total_sleep from API when available)
  const sessionsWithDuration = sleepSessions.filter((s) => s.end_time)
  const avgSleepDuration =
    sessionsWithDuration.length > 0
      ? sessionsWithDuration.reduce(
          (sum, s) => sum + (s.duration ?? (s.end_time!.getTime() - s.start_time.getTime()) / 60000) / 60,
          0,
        ) / sessionsWithDuration.length
      : null

  const handleDaysChange = (e: Event) => {
    const value = parseInt((e.target as HTMLSelectElement).value, 10)
    daysBack.value = value
  }

  return (
    <div class="sleep-page">
      <div class="sleep-header">
        <h1>Sleep Quality</h1>
        <select value={daysBack.value} onChange={handleDaysChange} class="days-select">
          <option value={7}>Last 7 days</option>
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      {isLoading && <div class="loading">Loading sleep data...</div>}

      {/* Summary stats */}
      <section class="stats-section">
        <h2>Overview</h2>
        <div class="stats-grid">
          <StatCard
            label="Sleep Score"
            value={metrics.sleep_score?.avg ?? null}
            trend={metrics.sleep_score?.change_from_previous_period_percent}
            description="Overall sleep quality"
          />
          <StatCard label="Duration" value={avgSleepDuration} unit="h" description="Average per night" />
          <StatCard
            label="Efficiency"
            value={metrics.sleep_efficiency?.avg ?? null}
            unit="%"
            trend={metrics.sleep_efficiency?.change_from_previous_period_percent}
            description="Time asleep vs. in bed"
          />
          <StatCard
            label="Latency"
            value={metrics.sleep_latency?.avg ?? null}
            unit="min"
            trend={metrics.sleep_latency?.change_from_previous_period_percent}
            description="Time to fall asleep"
          />
        </div>
      </section>

      {/* Sleep score chart */}
      <section class="chart-section">
        <h2>Sleep Score Trend</h2>
        <SleepScoreChart data={sleepScores} hasSleepSessions={sleepSessions.length > 0} />
      </section>

      {/* Sleep duration chart */}
      <section class="chart-section">
        <h2>Sleep Duration</h2>
        <div class="duration-legend">
          <span class="legend-item">
            <span class="legend-color green" /> 7-9 hours (optimal)
          </span>
          <span class="legend-item">
            <span class="legend-color yellow" /> 6-7 or 9+ hours
          </span>
          <span class="legend-item">
            <span class="legend-color red" /> &lt;6 hours
          </span>
        </div>
        <SleepDurationChart sleepSessions={sleepSessions} />
      </section>

      {/* Sleep components */}
      <section class="stats-section">
        <h2>Sleep Components</h2>
        <div class="stats-grid">
          <StatCard
            label="Total Score"
            value={metrics.sleep_total_score?.avg ?? null}
            trend={metrics.sleep_total_score?.change_from_previous_period_percent}
            description="Sleep duration component"
          />
          <StatCard
            label="Deep Sleep"
            value={metrics.sleep_deep_score?.avg ?? null}
            trend={metrics.sleep_deep_score?.change_from_previous_period_percent}
            description="Restorative sleep quality"
          />
          <StatCard
            label="REM Sleep"
            value={metrics.sleep_rem_score?.avg ?? null}
            trend={metrics.sleep_rem_score?.change_from_previous_period_percent}
            description="Dream sleep quality"
          />
          <StatCard
            label="Restfulness"
            value={metrics.sleep_restfulness?.avg ?? null}
            trend={metrics.sleep_restfulness?.change_from_previous_period_percent}
            description="Movement during sleep"
          />
          <StatCard
            label="Timing"
            value={metrics.sleep_timing?.avg ?? null}
            trend={metrics.sleep_timing?.change_from_previous_period_percent}
            description="Consistency of bedtime"
          />
        </div>
      </section>

      {/* Nights tracked */}
      <section class="info-section">
        <p>
          Based on <strong>{sleepSessions.length}</strong> nights of tracked sleep data.
        </p>
      </section>
    </div>
  )
}
