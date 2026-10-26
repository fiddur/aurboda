import { type ActivityMeasure, type ActivitySession, activityMeasureLabels } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { fetchActivitySessions, fetchActivityTypeDefinitions } from '../../state/api'
import { toDisplayName } from '../../utils/displayName'
import { formatMeasure, formatSet } from '../../utils/measures'
import { doneSummary, type ItemRecord, recordsFrom, sliceByLookback, trendPoints } from './itemHistory'
import { ItemSessionsTable } from './ItemSessionsTable'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

const TREND_MEASURES: ActivityMeasure[] = ['e1rm', 'max_weight', 'volume', 'max_time']

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

const Trend = ({ all, shown }: { all: ActivitySession[]; shown: ActivitySession[] }) => {
  const available = TREND_MEASURES.filter((m) => all.some((s) => s.measures?.[m] !== undefined))
  const [chosen, setChosen] = useState<ActivityMeasure | undefined>(undefined)
  const measure = chosen && available.includes(chosen) ? chosen : available[0]
  if (!measure) return null
  const points = trendPoints(shown, measure)

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header">
        <h2>Trend</h2>
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
      {points.length >= 2 && (
        <>
          <TrendLineChart data={points} color="#8b5cf6" height={220} />
          <p class="activity-type-item-caption">Per session.</p>
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

          <Trend all={sessions} shown={shown} />

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
