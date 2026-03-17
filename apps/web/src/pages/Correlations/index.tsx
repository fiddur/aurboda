import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import {
  fetchActivityImpact,
  fetchBaseline,
  fetchHrvActivitiesCorrelation,
  type ActivityCorrelation,
  type ActivityImpactData,
  type ActivityImpactType,
  type BaselineData,
  type HrvStatsWithDelta,
  type LocationCorrelation,
  type ProductivityCorrelation,
  type TagCorrelation,
} from '../../state/api'
import './style.css'

// Period signal
const periodDays = signal(30)

// Selected activity for impact analysis
const selectedActivity = signal<{ name: string; type: ActivityImpactType } | null>(null)

// Impact timeline chart component
function ImpactTimelineChart({
  data,
  baseline,
}: {
  data: ActivityImpactData
  baseline: BaselineData | null
}) {
  const containerRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement>(null)

  useEffect(() => {
    if (!svgRef.current || !containerRef.current) return

    const containerWidth = containerRef.current.clientWidth
    const height = 200
    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const margin = { bottom: 40, left: 50, right: 50, top: 30 }
    const width = containerWidth
    const innerWidth = width - margin.left - margin.right
    const innerHeight = height - margin.top - margin.bottom

    // Data points
    const windows = ['before30min', 'before15min', 'during', 'after15min', 'after30min'] as const
    const labels = ['-30 min', '-15 min', 'During', '+15 min', '+30 min']

    const hrvData = windows.map((w) => data.hrv_timeline[w].mean)
    const hrData = windows.map((w) => data.hr_timeline[w].mean)

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    // X scale
    const x = d3.scalePoint<number>().domain([0, 1, 2, 3, 4]).range([0, innerWidth])

    // HRV Y scale (left)
    const hrvExtent = d3.extent(hrvData.filter((d): d is number => d !== null)) as [number, number]
    const hrvPadding = (hrvExtent[1] - hrvExtent[0]) * 0.3 || 10
    const yHrv = d3
      .scaleLinear()
      .domain([hrvExtent[0] - hrvPadding, hrvExtent[1] + hrvPadding])
      .range([innerHeight, 0])

    // HR Y scale (right)
    const hrExtent = d3.extent(hrData.filter((d): d is number => d !== null)) as [number, number]
    const hrPadding = (hrExtent[1] - hrExtent[0]) * 0.3 || 10
    const yHr = d3
      .scaleLinear()
      .domain([hrExtent[0] - hrPadding, hrExtent[1] + hrPadding])
      .range([innerHeight, 0])

    // Baseline lines
    if (baseline?.hrv.avg30day !== null && baseline?.hrv.avg30day !== undefined) {
      g.append('line')
        .attr('x1', 0)
        .attr('y1', yHrv(baseline.hrv.avg30day))
        .attr('x2', innerWidth)
        .attr('y2', yHrv(baseline.hrv.avg30day))
        .attr('stroke', '#10b981')
        .attr('stroke-width', 1)
        .attr('stroke-dasharray', '4,4')
        .attr('opacity', 0.5)
    }

    // HRV line
    const hrvLine = d3
      .line<number | null>()
      .defined((d) => d !== null)
      .x((_, i) => x(i)!)
      .y((d) => yHrv(d!))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(hrvData)
      .attr('fill', 'none')
      .attr('stroke', '#10b981')
      .attr('stroke-width', 2)
      .attr('d', hrvLine)

    // HRV points
    hrvData.forEach((d, i) => {
      if (d !== null) {
        g.append('circle')
          .attr('cx', x(i)!)
          .attr('cy', yHrv(d))
          .attr('r', 5)
          .attr('fill', '#10b981')
          .attr('stroke', 'white')
          .attr('stroke-width', 2)
      }
    })

    // HR line
    const hrLine = d3
      .line<number | null>()
      .defined((d) => d !== null)
      .x((_, i) => x(i)!)
      .y((d) => yHr(d!))
      .curve(d3.curveMonotoneX)

    g.append('path')
      .datum(hrData)
      .attr('fill', 'none')
      .attr('stroke', '#ef4444')
      .attr('stroke-width', 2)
      .attr('d', hrLine)

    // HR points
    hrData.forEach((d, i) => {
      if (d !== null) {
        g.append('circle')
          .attr('cx', x(i)!)
          .attr('cy', yHr(d))
          .attr('r', 5)
          .attr('fill', '#ef4444')
          .attr('stroke', 'white')
          .attr('stroke-width', 2)
      }
    })

    // Activity zone highlight
    g.append('rect')
      .attr('x', x(2)! - 30)
      .attr('y', 0)
      .attr('width', 60)
      .attr('height', innerHeight)
      .attr('fill', '#3b82f6')
      .attr('fill-opacity', 0.1)

    // X axis
    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((_, i) => labels[i]))
      .selectAll('text')
      .attr('fill', 'currentColor')

    // Y axes
    g.append('g').call(d3.axisLeft(yHrv).ticks(4)).selectAll('text').attr('fill', '#10b981')

    g.append('g')
      .attr('transform', `translate(${innerWidth},0)`)
      .call(d3.axisRight(yHr).ticks(4))
      .selectAll('text')
      .attr('fill', '#ef4444')

    // Legend
    g.append('text')
      .attr('x', 10)
      .attr('y', -10)
      .attr('fill', '#10b981')
      .attr('font-size', '12px')
      .text('HRV (ms)')

    g.append('text')
      .attr('x', innerWidth - 10)
      .attr('y', -10)
      .attr('text-anchor', 'end')
      .attr('fill', '#ef4444')
      .attr('font-size', '12px')
      .text('HR (bpm)')
  }, [data, baseline])

  return (
    <div ref={containerRef} class="impact-chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

// Delta class: positive delta = good for HRV, bad for HR (inverted)
const getDeltaClass = (value: number | null, inverted: boolean): string => {
  if (value === null) return ''
  if (value === 0) return ''
  const isPositive = inverted ? value < 0 : value > 0
  return isPositive ? 'positive' : 'negative'
}

const formatDelta = (value: number | null, decimals: number): string => {
  if (value === null) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`
}

const formatValue = (value: number | null | undefined, decimals: number): string =>
  value != null ? value.toFixed(decimals) : '--'

const isActivitySelected = (
  selected: { name: string; type: ActivityImpactType } | null,
  name: string,
  type: ActivityImpactType,
): boolean => selected?.name === name && selected?.type === type

// Correlation row component
function CorrelationRow({
  name,
  stats,
  onSelect,
  selected,
  type,
  extra,
}: {
  name: string
  stats: HrvStatsWithDelta
  onSelect: () => void
  selected: boolean
  type: string
  extra?: string
}) {
  return (
    <tr class={selected ? 'selected' : ''} onClick={onSelect}>
      <td class="name-cell">
        <span class="name">{name}</span>
        {extra && <span class="extra">{extra}</span>}
      </td>
      <td class="type-cell">{type}</td>
      <td class="value-cell">{stats.mean_hrv?.toFixed(1) ?? '--'}</td>
      <td class={`delta-cell ${getDeltaClass(stats.hrv_delta_from_baseline, false)}`}>
        {formatDelta(stats.hrv_delta_from_baseline, 1)}
      </td>
      <td class="value-cell">{stats.mean_hr?.toFixed(0) ?? '--'}</td>
      <td class={`delta-cell ${getDeltaClass(stats.hr_delta_from_baseline, true)}`}>
        {formatDelta(stats.hr_delta_from_baseline, 0)}
      </td>
      <td class="samples-cell">{stats.sample_minutes} min</td>
    </tr>
  )
}

export function Correlations() {
  // Fetch baseline
  const baselineQuery = useQuery({
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch HRV-activities correlations
  const correlationsQuery = useQuery({
    queryFn: () => fetchHrvActivitiesCorrelation(periodDays.value),
    queryKey: ['hrvActivitiesCorrelation', periodDays.value],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch activity impact when an activity is selected
  const activityImpactQuery = useQuery({
    enabled: selectedActivity.value !== null,
    queryFn: () =>
      selectedActivity.value
        ? fetchActivityImpact(selectedActivity.value.name, selectedActivity.value.type, 90, 30)
        : Promise.reject(),
    queryKey: ['activityImpact', selectedActivity.value?.name, selectedActivity.value?.type],
    staleTime: 5 * 60 * 1000,
  })

  const baseline: BaselineData | null = baselineQuery.data ?? null
  const correlations = correlationsQuery.data
  const activityImpact = activityImpactQuery.data

  const isLoading = baselineQuery.isLoading || correlationsQuery.isLoading

  const handlePeriodChange = (e: Event) => {
    periodDays.value = parseInt((e.target as HTMLSelectElement).value, 10)
  }

  const handleSelectActivity = (name: string, type: ActivityImpactType) => {
    if (isActivitySelected(selectedActivity.value, name, type)) {
      selectedActivity.value = null
    } else {
      selectedActivity.value = { name, type }
    }
  }

  return (
    <div class="correlations-page">
      <div class="correlations-header">
        <h1>Correlations</h1>
        <select value={periodDays.value} onChange={handlePeriodChange} class="period-select">
          <option value={14}>Last 14 days</option>
          <option value={30}>Last 30 days</option>
          <option value={60}>Last 60 days</option>
          <option value={90}>Last 90 days</option>
        </select>
      </div>

      <p class="intro-text">
        Analyze how different activities correlate with your heart rate variability (HRV) and heart rate.
        Click a row to see the detailed before/during/after timeline.
      </p>

      {isLoading && <div class="loading">Analyzing correlations...</div>}

      {/* Baseline overview */}
      {baseline && (
        <section class="baseline-section">
          <h2>Your Baseline</h2>
          <div class="baseline-grid">
            <div class="baseline-card">
              <span class="baseline-label">HRV (30-day avg)</span>
              <span class="baseline-value hrv">{formatValue(baseline.hrv.avg30day, 1)} ms</span>
            </div>
            <div class="baseline-card">
              <span class="baseline-label">Resting HR (30-day avg)</span>
              <span class="baseline-value hr">{formatValue(baseline.resting_hr.avg30day, 0)} bpm</span>
            </div>
          </div>
        </section>
      )}

      {/* Activity Impact Detail */}
      {activityImpact && (
        <section class="impact-section">
          <h2>
            Impact of "{activityImpact.activity}" on HRV/HR
            <span class="impact-meta">
              {activityImpact.occurrences} occurrences, avg {activityImpact.avg_duration_min} min
            </span>
          </h2>
          <ImpactTimelineChart data={activityImpact} baseline={baseline} />
          <div class="impact-legend">
            <span>
              <span class="dot hrv" /> HRV (higher is generally better)
            </span>
            <span>
              <span class="dot hr" /> Heart Rate
            </span>
            <span>
              <span class="zone" /> Activity period
            </span>
          </div>
        </section>
      )}

      {/* Correlations tables */}
      {correlations && (
        <>
          {/* Activities */}
          {correlations.correlations.activities.length > 0 && (
            <section class="table-section">
              <h2>Activities</h2>
              <div class="table-container">
                <table class="correlations-table">
                  <thead>
                    <tr>
                      <th>Activity</th>
                      <th>Type</th>
                      <th>HRV</th>
                      <th>Δ HRV</th>
                      <th>HR</th>
                      <th>Δ HR</th>
                      <th>Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correlations.correlations.activities.map((a: ActivityCorrelation) => (
                      <CorrelationRow
                        key={a.activity_type}
                        name={a.activity_type}
                        stats={a}
                        onSelect={() => handleSelectActivity(a.activity_type, 'activity_type')}
                        selected={isActivitySelected(
                          selectedActivity.value,
                          a.activity_type,
                          'activity_type',
                        )}
                        type="activity"
                        extra={`${a.occurrences}× (avg ${a.avg_duration_min} min)`}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Locations */}
          {correlations.correlations.locations.length > 0 && (
            <section class="table-section">
              <h2>Locations</h2>
              <div class="table-container">
                <table class="correlations-table">
                  <thead>
                    <tr>
                      <th>Location</th>
                      <th>Type</th>
                      <th>HRV</th>
                      <th>Δ HRV</th>
                      <th>HR</th>
                      <th>Δ HR</th>
                      <th>Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correlations.correlations.locations.map((l: LocationCorrelation) => (
                      <CorrelationRow
                        key={l.location_name}
                        name={l.location_name}
                        stats={l}
                        onSelect={() => handleSelectActivity(l.location_name, 'location')}
                        selected={isActivitySelected(selectedActivity.value, l.location_name, 'location')}
                        type="location"
                        extra={`${l.visit_count} visits`}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Productivity categories */}
          {correlations.correlations.productivity.length > 0 && (
            <section class="table-section">
              <h2>Productivity Categories</h2>
              <div class="table-container">
                <table class="correlations-table">
                  <thead>
                    <tr>
                      <th>Category</th>
                      <th>Type</th>
                      <th>HRV</th>
                      <th>Δ HRV</th>
                      <th>HR</th>
                      <th>Δ HR</th>
                      <th>Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correlations.correlations.productivity.map((p: ProductivityCorrelation) => (
                      <CorrelationRow
                        key={p.category}
                        name={p.category}
                        stats={p}
                        onSelect={() => handleSelectActivity(p.category, 'productivity_category')}
                        selected={isActivitySelected(
                          selectedActivity.value,
                          p.category,
                          'productivity_category',
                        )}
                        type="productivity"
                        extra={
                          p.correlation_coefficient !== null
                            ? `r=${p.correlation_coefficient.toFixed(2)}`
                            : undefined
                        }
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Tags */}
          {correlations.correlations.tags.length > 0 && (
            <section class="table-section">
              <h2>Tags</h2>
              <div class="table-container">
                <table class="correlations-table">
                  <thead>
                    <tr>
                      <th>Tag</th>
                      <th>Type</th>
                      <th>HRV</th>
                      <th>Δ HRV</th>
                      <th>HR</th>
                      <th>Δ HR</th>
                      <th>Samples</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correlations.correlations.tags.map((t: TagCorrelation) => (
                      <CorrelationRow
                        key={t.tag}
                        name={t.tag}
                        stats={t}
                        onSelect={() => handleSelectActivity(t.tag, 'tag')}
                        selected={isActivitySelected(selectedActivity.value, t.tag, 'tag')}
                        type="tag"
                        extra={`${t.occurrences}×`}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </>
      )}

      {/* Info */}
      <section class="info-section">
        <h3>Understanding the data</h3>
        <ul>
          <li>
            <strong>HRV (Heart Rate Variability):</strong> Higher HRV generally indicates better recovery and
            lower stress.
          </li>
          <li>
            <strong>Δ HRV / Δ HR:</strong> Change from your personal baseline. Positive HRV delta is typically
            good.
          </li>
          <li>
            <strong>Correlation coefficient (r):</strong> For productivity, this shows how the productivity
            score correlates with HRV (-1 to 1).
          </li>
        </ul>
      </section>
    </div>
  )
}
