import type { ChartDataAggregation } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { endOfDay, endOfWeek, startOfDay, subDays } from 'date-fns'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { breakdownBarSeries, BreakdownLegend } from '../../components/charts/breakdown'
import { ChartMenu } from '../../components/charts/ChartMenu'
import { fetchChartData } from '../../state/api'
import { buildChartUrl } from '../../utils/chart-url'
import { newWidgetId } from '../../utils/widget-id'
import { muscleGroupSummary, type MuscleGroupSummaryRow } from './muscleGroupSummary'
import { unmappedSectionId } from './UnmappedItemValuesSection'
import '../../components/sessions/sessions.css'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
]

const NO_BUCKETS: { bucket_start: string; value: number }[] = []

const sets = (value: number): string => String(Math.round(value * 10) / 10)

const SummaryRow = ({ path, row }: { path: string; row: MuscleGroupSummaryRow }) => (
  <li
    class={`activity-type-meta-muscle-summary-row${row.trained ? '' : ' activity-type-meta-muscle-summary-untrained'}`}
  >
    <span class="activity-type-meta-muscle-summary-name">
      {row.kind === 'not_in_catalogue' ? <a href={`#${unmappedSectionId(path)}`}>{row.name}</a> : row.name}
    </span>
    <span class="activity-type-meta-muscle-summary-bar" aria-hidden="true">
      <span style={{ width: `${row.bar * 100}%` }} />
    </span>
    <span class="activity-type-meta-muscle-summary-value">{sets(row.this_week)}</span>
    <span class="activity-type-meta-muscle-summary-value">{sets(row.per_week)}</span>
  </li>
)

/**
 * Working sets of a catalogue-backed item field per muscle group, each set weighted by recruitment:
 * a list of this week's and the average week's sets per group, and the weekly chart on request.
 */
export function MuscleGroupSection({ name, path }: { name: string; path: string }) {
  const [lookback, setLookback] = useState(90)
  const [showChart, setShowChart] = useState(false)
  const range = useMemo(() => {
    const now = new Date()
    return {
      end: endOfDay(now).toISOString(),
      // The axis runs to the end of this week so the current week's bars are drawn whole.
      axisEnd: endOfWeek(now, { weekStartsOn: 1 }).toISOString(),
      start: startOfDay(subDays(now, lookback)).toISOString(),
    }
  }, [lookback])
  const chart = {
    aggregation: 'sum' as ChartDataAggregation,
    breakdown_fields: [`${path}.muscle_group`],
    bucket_size: '1w' as const,
    measure: 'set_count' as const,
    pattern: name,
    source_type: 'activity_type' as const,
  }

  const query = useQuery({
    queryFn: () => fetchChartData({ ...chart, end: range.end, start: range.start }),
    queryKey: ['chart-data', 'muscle-groups', name, path, range],
    staleTime: 5 * 60 * 1000,
  })
  const series = query.data?.breakdown_series
  const buckets = query.data?.breakdown_buckets
  const multiSeries = useMemo(() => breakdownBarSeries(series, buckets), [series, buckets])
  const summary = useMemo(
    () => (buckets ? muscleGroupSummary({ buckets, now: new Date(), period_days: lookback }) : []),
    [buckets, lookback],
  )

  return (
    <section class="activity-type-meta-section">
      <div class="activity-type-meta-section-header sessions-header">
        <h2>Sets per muscle group</h2>
        <div class="sessions-controls">
          <select
            aria-label="Period"
            value={lookback}
            onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
          >
            {LOOKBACK_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <ChartMenu
            exploreHref={buildChartUrl({ ...chart, chart_type: 'bar', lookback_days: lookback })}
            widget={(title) => ({
              config: { ...chart, lookback_days: lookback, ...(title ? { title } : {}) },
              id: newWidgetId(),
              type: 'bar_chart',
            })}
          />
        </div>
      </div>

      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sets per muscle group</p>}
      {query.data &&
        (series && multiSeries ? (
          <>
            <ul class="activity-type-meta-muscle-summary" aria-label="Sets per muscle group">
              <li class="activity-type-meta-muscle-summary-row activity-type-meta-muscle-summary-head">
                <span class="activity-type-meta-muscle-summary-name">Muscle group</span>
                <span />
                <span class="activity-type-meta-muscle-summary-value">This week</span>
                <span class="activity-type-meta-muscle-summary-value">Avg / week</span>
              </li>
              {summary.map((row) => (
                <SummaryRow key={row.name} path={path} row={row} />
              ))}
            </ul>
            <button
              type="button"
              class="btn-secondary activity-type-meta-muscle-summary-toggle"
              aria-expanded={showChart}
              onClick={() => setShowChart((open) => !open)}
            >
              {showChart ? 'Hide weekly chart' : 'Show weekly chart'}
            </button>
            {showChart && (
              <>
                <BreakdownLegend series={series} />
                <BarChart
                  data={NO_BUCKETS}
                  height={220}
                  bucketSize="1w"
                  rangeStart={range.start}
                  rangeEnd={range.axisEnd}
                  multiSeries={multiSeries}
                />
              </>
            )}
          </>
        ) : (
          <p class="activity-type-meta-empty">No sets in this period.</p>
        ))}
    </section>
  )
}
