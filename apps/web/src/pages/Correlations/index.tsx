import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import * as d3 from 'd3'
import { useEffect, useRef } from 'preact/hooks'

import {
  fetchActivityImpact,
  fetchBaseline,
  fetchHrvActivitiesCorrelation,
  type ActivityImpactData,
  type ActivityImpactType,
  type BaselineData,
  type HrvContextMetric,
} from '../../state/api'
import { ContextTable } from './ContextTable'
import { effectSummary } from './effects'
import { ExploreTab } from './Explore'
import { describeOccurrences } from './occurrences'
import { bucketLabel, DEFAULT_WINDOW_MINUTES, formatWindow, isLongWindow, WINDOW_OPTIONS } from './window'
import './style.css'

const periodDays = signal(30)

// Which autonomic metric drives the productivity correlation. Not everyone has
// continuous HRV, so heart rate / stress can be a denser context.
const contextMetric = signal<HrvContextMetric>('hrv_rmssd')

const CONTEXT_METRIC_LABELS: Record<HrvContextMetric, string> = {
  heart_rate: 'Heart rate',
  hrv_rmssd: 'HRV',
  stress_level: 'Stress',
}

// The metric phrased for the intro sentence ("…correlate with your <phrase>.").
const CONTEXT_METRIC_PHRASES: Record<HrvContextMetric, string> = {
  heart_rate: 'heart rate',
  hrv_rmssd: 'heart rate variability (HRV)',
  stress_level: 'stress level',
}

const windowMinutes = signal(DEFAULT_WINDOW_MINUTES)

const activeTab = signal<'hrv' | 'explore'>('hrv')

const selectedActivity = signal<{ name: string; type: ActivityImpactType } | null>(null)

type ChartGroup = d3.Selection<SVGGElement, unknown, null, undefined>

const paddedDomain = (values: (number | null)[]): [number, number] => {
  const present = values.filter((d): d is number => d !== null)
  if (present.length === 0) return [0, 100]
  const [lo, hi] = d3.extent(present) as [number, number]
  const padding = (hi - lo) * 0.3 || 10
  return [lo - padding, hi + padding]
}

const drawHrvAxis = (g: ChartGroup, y: d3.ScaleLinear<number, number>) => {
  g.append('g').call(d3.axisLeft(y).ticks(4)).selectAll('text').attr('fill', '#10b981')

  g.append('text')
    .attr('x', 10)
    .attr('y', -10)
    .attr('fill', '#10b981')
    .attr('font-size', '12px')
    .text('HRV (ms)')
}

const drawHrAxis = (g: ChartGroup, y: d3.ScaleLinear<number, number>, innerWidth: number) => {
  g.append('g')
    .attr('transform', `translate(${innerWidth},0)`)
    .call(d3.axisRight(y).ticks(4))
    .selectAll('text')
    .attr('fill', '#ef4444')

  g.append('text')
    .attr('x', innerWidth - 10)
    .attr('y', -10)
    .attr('text-anchor', 'end')
    .attr('fill', '#ef4444')
    .attr('font-size', '12px')
    .text('HR (bpm)')
}

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

    const buckets = data.timeline
    const labels = buckets.map(bucketLabel)
    const duringIndex = buckets.findIndex((b) => b.phase === 'during')

    const hrvData = buckets.map((b) => b.hrv.mean)
    const hrData = buckets.map((b) => b.hr.mean)
    const stressData = buckets.map((b) => b.stress.mean)

    const g = svg
      .attr('width', width)
      .attr('height', height)
      .append('g')
      .attr('transform', `translate(${margin.left},${margin.top})`)

    const x = d3
      .scalePoint<number>()
      .domain(buckets.map((_, i) => i))
      .range([0, innerWidth])

    const hasHrv = hrvData.some((d) => d !== null)
    const hasHr = hrData.some((d) => d !== null)
    const hasStress = stressData.some((d) => d !== null)

    const yHrv = d3.scaleLinear().domain(paddedDomain(hrvData)).range([innerHeight, 0])
    const yHr = d3.scaleLinear().domain(paddedDomain(hrData)).range([innerHeight, 0])
    const yStress = d3.scaleLinear().domain(paddedDomain(stressData)).range([innerHeight, 0])

    if (hasHrv && baseline?.hrv.avg30day !== null && baseline?.hrv.avg30day !== undefined) {
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

    if (hasStress) {
      const stressLine = d3
        .line<number | null>()
        .defined((d) => d !== null)
        .x((_, i) => x(i)!)
        .y((d) => yStress(d!))
        .curve(d3.curveMonotoneX)

      g.append('path')
        .datum(stressData)
        .attr('fill', 'none')
        .attr('stroke', '#f59e0b')
        .attr('stroke-width', 2)
        .attr('d', stressLine)

      stressData.forEach((d, i) => {
        if (d !== null) {
          g.append('circle')
            .attr('cx', x(i)!)
            .attr('cy', yStress(d))
            .attr('r', 5)
            .attr('fill', '#f59e0b')
            .attr('stroke', 'white')
            .attr('stroke-width', 2)
        }
      })
    }

    const zoneWidth = Math.min(60, x.step())
    g.append('rect')
      .attr('x', x(duringIndex)! - zoneWidth / 2)
      .attr('y', 0)
      .attr('width', zoneWidth)
      .attr('height', innerHeight)
      .attr('fill', '#3b82f6')
      .attr('fill-opacity', 0.1)

    g.append('g')
      .attr('transform', `translate(0,${innerHeight})`)
      .call(d3.axisBottom(x).tickFormat((_, i) => labels[i]))
      .selectAll('text')
      .attr('fill', 'currentColor')

    if (hasHrv) drawHrvAxis(g, yHrv)
    if (hasHr) drawHrAxis(g, yHr, innerWidth)
  }, [data, baseline])

  return (
    <div ref={containerRef} class="impact-chart-container">
      <svg ref={svgRef} />
    </div>
  )
}

const formatValue = (value: number | null | undefined, decimals: number): string =>
  value != null ? value.toFixed(decimals) : '--'

const isActivitySelected = (
  selected: { name: string; type: ActivityImpactType } | null,
  name: string,
  type: ActivityImpactType,
): boolean => selected?.name === name && selected?.type === type

// eslint-disable-next-line complexity -- large render switching between HRV and explore tabs
export function Correlations() {
  const baselineQuery = useQuery({
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  const correlationsQuery = useQuery({
    queryFn: () => fetchHrvActivitiesCorrelation(periodDays.value, contextMetric.value, windowMinutes.value),
    queryKey: ['hrvActivitiesCorrelation', periodDays.value, contextMetric.value, windowMinutes.value],
    staleTime: 5 * 60 * 1000,
  })

  const activityImpactQuery = useQuery({
    enabled: selectedActivity.value !== null,
    queryFn: () =>
      selectedActivity.value
        ? fetchActivityImpact(
            selectedActivity.value.name,
            selectedActivity.value.type,
            periodDays.value,
            windowMinutes.value,
            'exact',
          )
        : Promise.reject(),
    queryKey: [
      'activityImpact',
      selectedActivity.value?.name,
      selectedActivity.value?.type,
      periodDays.value,
      windowMinutes.value,
    ],
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
        <h1>Analyze</h1>
        {activeTab.value === 'hrv' && (
          <div class="hrv-controls">
            <select
              value={contextMetric.value}
              onChange={(e) =>
                (contextMetric.value = (e.target as HTMLSelectElement).value as HrvContextMetric)
              }
              class="period-select"
              title="Which autonomic metric the productivity correlation is computed against"
            >
              <option value="hrv_rmssd">Context: HRV</option>
              <option value="heart_rate">Context: Heart rate</option>
              <option value="stress_level">Context: Stress</option>
            </select>
            <select value={periodDays.value} onChange={handlePeriodChange} class="period-select">
              <option value={14}>Last 14 days</option>
              <option value={30}>Last 30 days</option>
              <option value={60}>Last 60 days</option>
              <option value={90}>Last 90 days</option>
            </select>
            <select
              value={windowMinutes.value}
              onChange={(e) => (windowMinutes.value = parseInt((e.target as HTMLSelectElement).value, 10))}
              class="period-select"
              title="How long before and after each occurrence to compare"
            >
              {WINDOW_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  ±{formatWindow(minutes)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div class="analyze-tabs">
        <button class={activeTab.value === 'hrv' ? 'active' : ''} onClick={() => (activeTab.value = 'hrv')}>
          {CONTEXT_METRIC_LABELS[contextMetric.value]} context
        </button>
        <button
          class={activeTab.value === 'explore' ? 'active' : ''}
          onClick={() => (activeTab.value = 'explore')}
        >
          Explore
        </button>
      </div>

      {activeTab.value === 'explore' && <ExploreTab />}

      {activeTab.value === 'hrv' && (
        <>
          <p class="intro-text">
            Analyze how different activities correlate with your {CONTEXT_METRIC_PHRASES[contextMetric.value]}
            . Click a row to see the detailed before/during/after timeline.
          </p>

          {isLongWindow(windowMinutes.value) && (
            <p class="window-note">
              A window of {formatWindow(windowMinutes.value)} also picks up your daily rhythm: a few hours
              after an evening session is mostly sleep. So Change is not the activity's effect alone.
            </p>
          )}

          {isLoading && <div class="loading">Analyzing correlations...</div>}

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
                <div class="baseline-card">
                  <span class="baseline-label">Stress (30-day avg)</span>
                  <span class="baseline-value stress">{formatValue(baseline.stress.avg30day, 0)}</span>
                </div>
              </div>
            </section>
          )}

          {activityImpact && (
            <section class="impact-section">
              <h2>
                Impact of "{activityImpact.activity}" on HRV, heart rate and stress
                <span class="impact-meta">
                  {activityImpact.occurrences} occurrences, avg {activityImpact.avg_duration_min} min
                </span>
              </h2>
              <ImpactTimelineChart data={activityImpact} baseline={baseline} />
              <ul class="impact-summary">
                {(
                  [
                    ['HRV', activityImpact.hrv_effect],
                    ['Heart rate', activityImpact.hr_effect],
                    ['Stress', activityImpact.stress_effect],
                  ] as const
                ).map(([label, effect]) => {
                  const line = effectSummary(label, effect, activityImpact.occurrences)
                  return line && <li key={label}>{line}</li>
                })}
              </ul>
              <div class="impact-legend">
                <span>
                  <span class="dot hrv" /> HRV (higher is generally better)
                </span>
                <span>
                  <span class="dot hr" /> Heart Rate
                </span>
                <span>
                  <span class="dot stress" /> Stress
                </span>
                <span>
                  <span class="zone" /> Activity period
                </span>
              </div>
            </section>
          )}

          {correlations && (
            <>
              {correlations.correlations.activities.length > 0 && (
                <ContextTable
                  title="Activities"
                  nameHeader="Activity"
                  windowMinutes={correlations.window_minutes}
                  rows={correlations.correlations.activities.map((a) => ({
                    extra: describeOccurrences(a.occurrences, a.avg_duration_min),
                    key: a.activity_type,
                    name: a.activity_type,
                    onSelect: () => handleSelectActivity(a.activity_type, 'activity_type'),
                    selected: isActivitySelected(selectedActivity.value, a.activity_type, 'activity_type'),
                    stats: a,
                  }))}
                />
              )}

              {correlations.correlations.locations.length > 0 && (
                <ContextTable
                  title="Locations"
                  nameHeader="Location"
                  windowMinutes={correlations.window_minutes}
                  rows={correlations.correlations.locations.map((l) => ({
                    extra: `${l.visit_count} visits`,
                    key: l.location_name,
                    name: l.location_name,
                    onSelect: () => handleSelectActivity(l.location_name, 'location'),
                    selected: isActivitySelected(selectedActivity.value, l.location_name, 'location'),
                    stats: l,
                  }))}
                />
              )}

              {correlations.correlations.productivity.length > 0 && (
                <ContextTable
                  title="Productivity Categories"
                  nameHeader="Category"
                  windowMinutes={correlations.window_minutes}
                  rows={correlations.correlations.productivity.map((p) => ({
                    extra:
                      p.correlation_coefficient !== null
                        ? `r=${p.correlation_coefficient.toFixed(2)}`
                        : undefined,
                    key: p.category,
                    name: p.category,
                    onSelect: () => handleSelectActivity(p.category, 'productivity_category'),
                    selected: isActivitySelected(selectedActivity.value, p.category, 'productivity_category'),
                    stats: p,
                  }))}
                />
              )}
            </>
          )}

          <section class="info-section">
            <h3>Understanding the data</h3>
            <ul>
              <li>
                <strong>HRV (Heart Rate Variability):</strong> Higher HRV generally indicates better recovery
                and lower stress.
              </li>
              <li>
                <strong>During:</strong> the average while it was going on, one value per occurrence.
              </li>
              <li>
                <strong>vs avg:</strong> during minus your average over the whole period. Higher HRV is
                typically good; lower heart rate and stress are typically good.
              </li>
              <li>
                <strong>Change:</strong> the{' '}
                {formatWindow(correlations?.window_minutes ?? windowMinutes.value)} after minus the{' '}
                {formatWindow(correlations?.window_minutes ?? windowMinutes.value)} before, for occurrences
                with data on both sides. It is coloured only when it is statistically clear; hover it for the
                before and after values.
              </li>
              <li>
                Back-to-back or duplicate entries count as one occurrence, and values are resampled to
                5-minute averages so densely recorded stretches do not dominate.
              </li>
              <li>
                <strong>Correlation coefficient (r):</strong> For productivity, this shows how the
                productivity score correlates with{' '}
                {CONTEXT_METRIC_LABELS[correlations?.context_metric ?? contextMetric.value]} (-1 to 1). Pick a
                different <em>context</em> metric above if you don't have continuous HRV. The HRV / HR /
                Stress columns are each metric's own mean (— when that metric wasn't recorded), independent of
                the chosen context — so a row can show a blank HRV yet still have an r from the context
                metric.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
