import { DEFAULT_IMPACT_WINDOW_MINUTES, formatImpactWindow, IMPACT_WINDOW_OPTIONS } from '@aurboda/api-spec'
import { signal } from '@preact/signals'
import { useQuery } from '@tanstack/react-query'

import { ImpactFigure } from '../../components/charts/ImpactFigure'
import {
  fetchActivityImpact,
  fetchBaseline,
  fetchHrvActivitiesCorrelation,
  type ActivityImpactType,
  type BaselineData,
  type HrvContextMetric,
} from '../../state/api'
import { ContextTable } from './ContextTable'
import { ExploreTab } from './Explore'
import { describeOccurrences } from './occurrences'
import { isLongWindow } from './window'
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

const windowMinutes = signal(DEFAULT_IMPACT_WINDOW_MINUTES)

const activeTab = signal<'hrv' | 'explore'>('hrv')

const selectedActivity = signal<{ name: string; type: ActivityImpactType } | null>(null)

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
              A window of {formatImpactWindow(windowMinutes.value)} also picks up your daily rhythm: a few
              hours after an evening session is mostly sleep. So Change is not the activity's effect alone.
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
              <ImpactFigure data={activityImpact} baseline={baseline} />
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
