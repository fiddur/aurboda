import { DEFAULT_IMPACT_WINDOW_MINUTES, formatImpactWindow, IMPACT_WINDOW_OPTIONS } from '@aurboda/api-spec'
import { batch, signal, useSignalEffect } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useEffect, useRef, useState } from 'preact/hooks'

import { ImpactFigure } from '../../components/charts/ImpactFigure'
import { IMPACT_METRICS, type ImpactMetric } from '../../components/charts/impactMetrics'
import {
  type ActivityImpactType,
  type ActivityTypeDefinition,
  type BaselineData,
  fetchActivityImpact,
  fetchActivityTypeDefinitions,
  fetchBaseline,
  fetchHrvActivitiesCorrelation,
  fetchImpactMetrics,
} from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { ContextTable } from './ContextTable'
import { applyExploreState, exploreState, ExploreTab } from './Explore'
import {
  describeMetrics,
  describeProductivityR,
  extraMetricColumn,
  METRIC_LABELS,
  toggleExtra,
  toggleMetric,
} from './metrics'
import { describeImpactMeta, describeOccurrences } from './occurrences'
import {
  type AnalyzeState,
  type AnalyzeTab,
  PERIOD_DAY_OPTIONS,
  readAnalyzeState,
  type SelectedItem,
  writeAnalyzeState,
} from './urlState'
import { isLongWindow } from './window'
import './style.css'

const periodDays = signal(30)

const windowMinutes = signal(DEFAULT_IMPACT_WINDOW_MINUTES)

const shownMetrics = signal<ImpactMetric[]>([...IMPACT_METRICS])

const shownExtras = signal<string[]>([])

const activeTab = signal<AnalyzeTab>('context')

const selectedActivity = signal<SelectedItem | null>(null)

const applyAnalyzeState = (state: AnalyzeState) => {
  batch(() => {
    activeTab.value = state.tab
    periodDays.value = state.days
    windowMinutes.value = state.window
    shownMetrics.value = state.metrics
    shownExtras.value = state.extras
    selectedActivity.value = state.item
    applyExploreState(state.explore)
  })
}

const currentAnalyzeState = (): AnalyzeState => ({
  days: periodDays.value,
  explore: exploreState(),
  extras: shownExtras.value,
  item: selectedActivity.value,
  metrics: shownMetrics.value,
  tab: activeTab.value,
  window: windowMinutes.value,
})

const activityTypeDisplayName = (definitions: ActivityTypeDefinition[] | undefined, name: string): string =>
  definitions?.find((d) => d.name === name)?.display_name ?? toDisplayName(name)

const formatValue = (value: number | null | undefined, decimals: number): string =>
  value != null ? value.toFixed(decimals) : '--'

interface ExtraOption {
  metric: string
  label: string
  unit: string | null
}

/** The offered extras, then any URL-given extra the list lacks, so a shared link's metric can be seen and unticked. */
const extraOptions = (available: ExtraOption[], shown: readonly string[]): ExtraOption[] => [
  ...available,
  ...shown
    .filter((metric) => !available.some((o) => o.metric === metric))
    .map((metric) => ({ label: toDisplayName(metric), metric, unit: null })),
]

const withUnit = (value: string, unit: string | null): string =>
  unit && unit !== 'score' ? `${value} ${unit}` : value

const isActivitySelected = (selected: SelectedItem | null, name: string, type: ActivityImpactType): boolean =>
  selected?.name === name && selected?.type === type

// eslint-disable-next-line complexity -- large render switching between the context and explore tabs
export function Correlations() {
  // Read the URL before anything renders, so a bookmarked or shared view wins over whatever the
  // module-level signals held from an earlier visit, and the first URL write cannot clobber it.
  useState(() => applyAnalyzeState(readAnalyzeState()))

  // A navigation to this page while it is mounted (the sidebar link, back/forward) keeps the
  // component, so re-read the URL then; our own replaceState writes do not change the router's url.
  const { url } = useLocation()
  const lastUrl = useRef(url)
  useEffect(() => {
    if (url === lastUrl.current) return
    lastUrl.current = url
    applyAnalyzeState(readAnalyzeState())
  }, [url])

  useSignalEffect(() => writeAnalyzeState(currentAnalyzeState()))

  const baselineQuery = useQuery({
    queryFn: () => fetchBaseline(),
    queryKey: ['baseline'],
    staleTime: 5 * 60 * 1000,
  })

  const correlationsQuery = useQuery({
    queryFn: () => fetchHrvActivitiesCorrelation(periodDays.value, windowMinutes.value, shownExtras.value),
    queryKey: ['hrvActivitiesCorrelation', periodDays.value, windowMinutes.value, shownExtras.value],
    staleTime: 5 * 60 * 1000,
  })

  const impactMetricsQuery = useQuery({
    queryFn: () => fetchImpactMetrics(periodDays.value),
    queryKey: ['impactMetrics', periodDays.value],
    staleTime: 5 * 60 * 1000,
  })

  const definitionsQuery = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
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
            shownExtras.value,
          )
        : Promise.reject(),
    queryKey: [
      'activityImpact',
      selectedActivity.value?.name,
      selectedActivity.value?.type,
      periodDays.value,
      windowMinutes.value,
      shownExtras.value,
    ],
    staleTime: 5 * 60 * 1000,
  })

  const baseline: BaselineData | null = baselineQuery.data ?? null
  const correlations = correlationsQuery.data
  const activityImpact = activityImpactQuery.data
  const definitions = definitionsQuery.data
  const metrics = shownMetrics.value
  const shows = (metric: ImpactMetric) => metrics.includes(metric)
  const available = impactMetricsQuery.data ?? []
  const options = extraOptions(available, shownExtras.value)
  const extras = shownExtras.value.flatMap((metric) => options.filter((o) => o.metric === metric))
  const extraLabels = extras.map((e) => e.label)
  const extraColumns = extras.map((e) => extraMetricColumn(e.metric, e.label))
  const shownCount = metrics.length + extras.length

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
        {activeTab.value === 'context' && (
          <div class="hrv-controls">
            <div class="metric-toggles" role="group" aria-label="Metrics shown">
              {IMPACT_METRICS.map((metric) => (
                <label key={metric} class="metric-toggle">
                  <input
                    type="checkbox"
                    checked={shows(metric)}
                    disabled={shows(metric) && shownCount === 1}
                    onChange={() =>
                      (shownMetrics.value = toggleMetric(
                        shownMetrics.value,
                        metric,
                        shownExtras.value.length,
                      ))
                    }
                  />
                  {METRIC_LABELS[metric]}
                </label>
              ))}
              {options.map(({ label, metric }) => {
                const checked = shownExtras.value.includes(metric)
                return (
                  <label key={metric} class="metric-toggle">
                    <input
                      type="checkbox"
                      checked={checked}
                      disabled={checked && shownCount === 1}
                      onChange={() =>
                        (shownExtras.value = toggleExtra(
                          shownExtras.value,
                          metric,
                          shownMetrics.value.length,
                          available.map((o) => o.metric),
                        ))
                      }
                    />
                    {label}
                  </label>
                )
              })}
            </div>
            <select value={periodDays.value} onChange={handlePeriodChange} class="period-select">
              {PERIOD_DAY_OPTIONS.map((days) => (
                <option key={days} value={days}>
                  Last {days} days
                </option>
              ))}
            </select>
            <select
              value={windowMinutes.value}
              onChange={(e) => (windowMinutes.value = parseInt((e.target as HTMLSelectElement).value, 10))}
              class="period-select"
              title="How long before and after each occurrence to compare"
            >
              {IMPACT_WINDOW_OPTIONS.map((minutes) => (
                <option key={minutes} value={minutes}>
                  ±{formatImpactWindow(minutes)}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div class="analyze-tabs">
        <button
          class={activeTab.value === 'context' ? 'active' : ''}
          onClick={() => (activeTab.value = 'context')}
        >
          Context
        </button>
        <button
          class={activeTab.value === 'explore' ? 'active' : ''}
          onClick={() => (activeTab.value = 'explore')}
        >
          Explore
        </button>
      </div>

      {activeTab.value === 'explore' && <ExploreTab />}

      {activeTab.value === 'context' && (
        <>
          <p class="intro-text">
            Analyze how activities, places and screen time relate to your{' '}
            {describeMetrics(metrics, 'long', extraLabels)}. Click a row to see the detailed
            before/during/after timeline.
          </p>

          {isLongWindow(windowMinutes.value) && (
            <p class="window-note">
              A window of {formatImpactWindow(windowMinutes.value)} also picks up your daily rhythm: a few
              hours after an evening session is mostly sleep. So Change is not the activity's effect alone.
            </p>
          )}

          {isLoading && <div class="loading">Analyzing correlations...</div>}

          {baseline && (
            <section class="baseline-section">
              <h2>Your Baseline</h2>
              <div class="baseline-grid">
                {shows('hrv') && (
                  <div class="baseline-card">
                    <span class="baseline-label">HRV (30-day avg)</span>
                    <span class="baseline-value hrv">{formatValue(baseline.hrv.avg30day, 1)} ms</span>
                  </div>
                )}
                {shows('hr') && (
                  <div class="baseline-card">
                    <span class="baseline-label">Resting HR (30-day avg)</span>
                    <span class="baseline-value hr">{formatValue(baseline.resting_hr.avg30day, 0)} bpm</span>
                  </div>
                )}
                {shows('stress') && (
                  <div class="baseline-card">
                    <span class="baseline-label">Stress (30-day avg)</span>
                    <span class="baseline-value stress">{formatValue(baseline.stress.avg30day, 0)}</span>
                  </div>
                )}
                {correlations &&
                  extras.map(({ label, metric, unit }) => (
                    <div key={metric} class="baseline-card">
                      <span class="baseline-label">
                        {label} ({correlations.period.days}-day avg)
                      </span>
                      <span class="baseline-value">
                        {withUnit(formatValue(correlations.metric_baselines?.[metric], 1), unit)}
                      </span>
                    </div>
                  ))}
              </div>
            </section>
          )}

          {activityImpact && (
            <section class="impact-section">
              <h2>
                Impact of{' '}
                {activityImpact.activity_type === 'activity_type' ? (
                  <a href={`/activity-type/${encodeURIComponent(activityImpact.activity)}`}>
                    {activityTypeDisplayName(definitions, activityImpact.activity)}
                  </a>
                ) : (
                  activityImpact.activity
                )}{' '}
                on {describeMetrics(metrics, 'short', extraLabels)}
                <span class="impact-meta">
                  {describeImpactMeta(activityImpact.occurrences, activityImpact.avg_duration_min)}
                </span>
              </h2>
              <ImpactFigure data={activityImpact} baseline={baseline} metrics={metrics} extras={extras} />
            </section>
          )}

          {correlations && (
            <>
              {correlations.correlations.activities.length > 0 && (
                <ContextTable
                  title="Activities"
                  nameHeader="Activity"
                  windowMinutes={correlations.window_minutes}
                  metrics={metrics}
                  extraColumns={extraColumns}
                  rows={correlations.correlations.activities.map((a) => ({
                    extra: describeOccurrences(a.occurrences, a.avg_duration_min),
                    key: a.activity_type,
                    name: activityTypeDisplayName(definitions, a.activity_type),
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
                  metrics={metrics}
                  extraColumns={extraColumns}
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
                  metrics={metrics}
                  extraColumns={extraColumns}
                  rows={correlations.correlations.productivity.map((p) => ({
                    extra: describeProductivityR(
                      p.correlation_coefficients,
                      metrics,
                      extras.map((e) => ({
                        label: e.label,
                        r: p.metrics?.[e.metric]?.correlation_coefficient,
                      })),
                    ),
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
                {formatImpactWindow(correlations?.window_minutes ?? windowMinutes.value)} after minus the{' '}
                {formatImpactWindow(correlations?.window_minutes ?? windowMinutes.value)} before, for
                occurrences with data on both sides. It is coloured only when it is statistically clear; hover
                it for the before and after values.
              </li>
              <li>
                Back-to-back or duplicate entries count as one occurrence, and values are resampled to
                5-minute averages so densely recorded stretches do not dominate.
              </li>
              <li>
                Other metrics appear as checkboxes when you record them around the clock (at least every 15
                minutes for half of the day on most days), so there is data before and after a session.
                Metrics recorded only during workouts or sleep (often respiration rate) and daily values
                (resting HR, sleep scores, most manual logs) do not qualify.
              </li>
              <li>
                <strong>Correlation coefficient (r):</strong> for each productivity category, how the
                productivity score correlates with each shown metric (-1 to 1). A metric without enough data
                during that screen time has no r.
              </li>
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
