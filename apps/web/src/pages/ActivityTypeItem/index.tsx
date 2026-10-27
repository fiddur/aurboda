import { type ActivityMeasure, type ActivitySession, activityMeasureLabels } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useRoute } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchActivitySessions, fetchActivityTypeDefinitions, fetchChartData } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { defaultAggregation, formatMeasure, formatSet } from '../../utils/measures'
import {
  availableMeasures,
  BEST_HALF_LIFE_DAYS,
  chartExplorerHref,
  decayingBestPoints,
  doneSummary,
  explorerLookbackDays,
  type ItemRecord,
  lookbackStart,
  perWeekRange,
  recordsFrom,
  sliceByLookback,
  trendMeasure,
} from './itemHistory'
import { ItemSessionsTable } from './ItemSessionsTable'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

const SET_MEASURES = new Set<ActivityMeasure>(['e1rm', 'max_weight'])

const day = (iso: string): string => format(new Date(iso), 'd MMM yyyy')

const RecordCard = ({ record }: { record: ItemRecord }) => (
  <div class="activity-type-item-card">
    <div class="activity-type-item-card-label">{activityMeasureLabels[record.measure]}</div>
    <div class="activity-type-item-card-value">{formatMeasure(record.measure, record.value)}</div>
    <div class="activity-type-item-card-detail">
      <a href={`/detail/activity/${record.session_id}`}>{day(record.start_time)}</a>
      {SET_MEASURES.has(record.measure) && record.set && <> · {formatSet(record.set)}</>}
    </div>
  </div>
)

const Records = ({ sessions }: { sessions: ActivitySession[] }) => {
  const done = doneSummary(sessions)
  return (
    <div class="activity-type-item-cards">
      {recordsFrom(sessions).map((r) => (
        <RecordCard key={r.measure} record={r} />
      ))}
      {done && (
        <div class="activity-type-item-card">
          <div class="activity-type-item-card-label">Done</div>
          <div class="activity-type-item-card-value">{done.count}×</div>
          <div class="activity-type-item-card-detail">
            {done.count === 1 ? day(done.first) : `${day(done.first)} – ${day(done.last)}`}
          </div>
        </div>
      )}
    </div>
  )
}

interface ItemRef {
  name: string
  field: string
  value: string
}

const PerWeekChart = ({
  all,
  item,
  lookback,
  measure,
}: {
  all: ActivitySession[]
  item: ItemRef
  lookback: number
  measure: ActivityMeasure
}) => {
  const range = useMemo(() => perWeekRange(lookback, all), [lookback, all])
  const aggregation = defaultAggregation(measure)
  const query = useQuery({
    queryFn: () =>
      fetchChartData({
        aggregation,
        bucket_size: '1w',
        end: range.end,
        filter_field: item.field,
        filter_value: item.value,
        measure,
        pattern: item.name,
        source_type: 'activity_type',
        start: range.start,
      }),
    queryKey: ['chart-data', 'item-per-week', item, measure, range],
    staleTime: 5 * 60 * 1000,
  })
  const lookbackDays = explorerLookbackDays(lookback, range.start)

  return (
    <>
      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load the weekly chart</p>}
      {query.data && (
        <>
          <BarChart
            data={query.data.buckets}
            color="#8b5cf6"
            height={200}
            bucketSize="1w"
            rangeStart={range.start}
            rangeEnd={range.end}
          />
          <p class="activity-type-item-caption">
            {activityMeasureLabels[measure]}, {aggregation === 'max' ? 'the best' : 'the total'} of each week.
          </p>
        </>
      )}
      <div class="activity-type-item-links">
        <a href={chartExplorerHref({ ...item, lookbackDays, measure })}>Open in Chart Explorer</a>
        <a href="/goals">Set a goal</a>
      </div>
    </>
  )
}

const PerWeek = ({ all, item, lookback }: { all: ActivitySession[]; item: ItemRef; lookback: number }) => {
  const available = availableMeasures(all)
  const [chosen, setChosen] = useState<ActivityMeasure | undefined>(undefined)
  const measure =
    chosen && available.includes(chosen) ? chosen : available.includes('e1rm') ? 'e1rm' : available[0]
  if (!measure) return null

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header">
        <h2>Per week</h2>
        <select
          aria-label="Measure"
          value={measure}
          onChange={(e) => setChosen((e.target as HTMLSelectElement).value as ActivityMeasure)}
        >
          {available.map((m) => (
            <option key={m} value={m}>
              {activityMeasureLabels[m]}
            </option>
          ))}
        </select>
      </div>
      <PerWeekChart all={all} item={item} lookback={lookback} measure={measure} />
    </section>
  )
}

const Trend = ({ all, lookback }: { all: ActivitySession[]; lookback: number }) => {
  const measure = trendMeasure(all)
  if (!measure) return null
  const now = Date.now()
  const from = lookback > 0 ? lookbackStart(lookback, now) : -Infinity
  const points = decayingBestPoints(all, measure, BEST_HALF_LIFE_DAYS, now).filter(
    (p) => new Date(p.date).getTime() >= from,
  )

  return (
    <section class="activity-type-item-section">
      <h2>Trend</h2>
      {points.length >= 2 && (
        <>
          <TrendLineChart data={points} color="#8b5cf6" height={220} />
          <p class="activity-type-item-caption">
            {activityMeasureLabels[measure]}, decaying with a {BEST_HALF_LIFE_DAYS}-day half-life between
            sessions.
          </p>
        </>
      )}
    </section>
  )
}

/** One item value of a type across its sessions: an exercise's records, trend and history. */
export function ActivityTypeItem() {
  const { params } = useRoute()
  const name = params.name as string
  const field = params.field as string
  const value = params.value as string
  const [lookback, setLookback] = useState(365)
  const item = useMemo(() => ({ field, name, value }), [field, name, value])

  const { data: definitions } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activityTypeDefinitions'],
    staleTime: 5 * 60 * 1000,
  })
  const typeName = definitions?.find((d) => d.name === name)?.display_name ?? toDisplayName(name)

  const query = useQuery({
    queryFn: () => fetchActivitySessions(name, { filter_field: field, filter_value: value }),
    queryKey: ['activity-sessions', name, field, 'filter', value],
    staleTime: 5 * 60 * 1000,
  })
  const sessions = query.data?.sessions ?? []
  const shown = sliceByLookback(sessions, lookback)

  return (
    <div class="activity-type-item-page">
      <a href={`/activity-type/${encodeURIComponent(name)}`} class="activity-type-item-back">
        ← {typeName}
      </a>
      <header class="activity-type-item-header">
        <h1>{value}</h1>
        <p class="activity-type-item-subtitle">{typeName}</p>
      </header>

      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sessions</p>}
      {query.data && sessions.length === 0 && (
        <p class="activity-type-item-empty">No sessions with {value}.</p>
      )}

      {sessions.length > 0 && (
        <>
          <Records sessions={sessions} />

          <label class="activity-type-item-period">
            Period
            <select
              value={lookback}
              onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
            >
              {LOOKBACK_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>

          <Trend all={sessions} lookback={lookback} />
          <PerWeek all={sessions} item={item} lookback={lookback} />

          <section class="activity-type-item-section">
            <h2>History</h2>
            {shown.length === 0 ? (
              <p class="activity-type-item-empty">No sessions in this period.</p>
            ) : (
              <ItemSessionsTable sessions={shown} />
            )}
          </section>
        </>
      )}
    </div>
  )
}
