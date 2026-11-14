import { type ActivityMeasure, type ActivitySession, activityMeasureLabels } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { ChartMenu } from '../../components/charts/ChartMenu'
import { goalsHref } from '../../components/goalPrefill'
import { RecordCard } from '../../components/RecordCard'
import {
  fetchActivitySessions,
  fetchActivityTypeDefinitions,
  fetchChartData,
  fetchTrend,
} from '../../state/api'
import { CHART_PRIMARY } from '../../theme'
import { buildChartUrl } from '../../utils/chart-url'
import { toDisplayName } from '../../utils/displayName'
import { MEASURE_HALF_LIFE_DEFAULT } from '../../utils/half-life'
import { defaultAggregation } from '../../utils/measures'
import { newWidgetId } from '../../utils/widget-id'
import { itemFieldCatalog } from './catalogEntryView'
import { ExerciseIdentity } from './ExerciseIdentity'
import { DoneCard } from './ItemCards'
import {
  availableMeasures,
  chartExplorerHref,
  doneSummary,
  explorerLookbackDays,
  perWeekRange,
  recordsFrom,
  sliceByLookback,
  trendMeasure,
} from './itemHistory'
import { ItemSessionsTable } from './ItemSessionsTable'
import { MergeItemValue } from './MergeItemValue'
import { ShareExercise } from './ShareExercise'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '90 days', value: 90 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 0 },
]

interface ItemRef {
  name: string
  field: string
  value: string
}

const Records = ({ item, sessions }: { item: ItemRef; sessions: ActivitySession[] }) => {
  const done = doneSummary(sessions)
  return (
    <div class="activity-type-item-cards">
      {recordsFrom(sessions).map((r) => (
        <RecordCard
          key={r.measure}
          record={r}
          menu={
            <ChartMenu
              widget={(title) => ({
                config: {
                  filter_field: item.field,
                  filter_value: item.value,
                  measure: r.measure,
                  pattern: item.name,
                  source_type: 'activity_type',
                  ...(title ? { title } : {}),
                },
                id: newWidgetId(),
                type: 'record_card',
              })}
              extraWidgets={[
                {
                  label: 'Add activity card',
                  widget: (title) => ({
                    config: {
                      filter_field: item.field,
                      filter_value: item.value,
                      pattern: item.name,
                      ...(title ? { title } : {}),
                    },
                    id: newWidgetId(),
                    type: 'activity_type_card',
                  }),
                },
              ]}
            />
          }
        />
      ))}
      {done && <DoneCard done={done} />}
    </div>
  )
}

const MeasureChartBody = ({
  item,
  lookbackDays,
  measure,
  range,
  withLine,
}: {
  item: ItemRef
  lookbackDays: number
  measure: ActivityMeasure
  range: { end: string; start: string }
  withLine: boolean
}) => {
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
  const trendQuery = useQuery({
    enabled: withLine,
    queryFn: () =>
      fetchTrend({
        filter_field: item.field,
        filter_value: item.value,
        half_life_days: MEASURE_HALF_LIFE_DEFAULT,
        lookback_days: lookbackDays,
        measure,
        pattern: item.name,
        source_type: 'activity_type',
      }),
    queryKey: ['trend', 'item-best', item, measure, lookbackDays],
    staleTime: 5 * 60 * 1000,
  })
  const trendHistory = withLine ? trendQuery.data?.history : undefined
  const lines = useMemo(() => (trendHistory ? [{ data: trendHistory }] : undefined), [trendHistory])
  const label = activityMeasureLabels[measure]

  return (
    <>
      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load the weekly chart</p>}
      {query.data && (
        <>
          <BarChart
            data={query.data.buckets}
            color={CHART_PRIMARY}
            height={220}
            bucketSize="1w"
            rangeStart={range.start}
            rangeEnd={range.end}
            lines={lines}
          />
          {withLine && trendQuery.isError && <p class="error">Failed to load the trend</p>}
          <p class="activity-type-item-caption">
            {withLine
              ? `${label} of each week; the line is the decaying best, with a ${MEASURE_HALF_LIFE_DEFAULT}-day half-life between sessions.`
              : `${label}, ${aggregation === 'max' ? 'the best' : 'the total'} of each week.`}
          </p>
        </>
      )}
    </>
  )
}

/** Weekly bars of one measure, with the decaying-best trend drawn over them when the measure is the trend's. */
const MeasureChart = ({
  all,
  item,
  lookback,
}: {
  all: ActivitySession[]
  item: ItemRef
  lookback: number
}) => {
  const available = availableMeasures(all)
  const [chosen, setChosen] = useState<ActivityMeasure | undefined>(undefined)
  const trendOf = trendMeasure(all)
  const measure = chosen && available.includes(chosen) ? chosen : (trendOf ?? available[0])
  const range = useMemo(() => perWeekRange(lookback, all), [lookback, all])
  if (!measure) return null
  const lookbackDays = explorerLookbackDays(lookback, range.start)
  const filter = { filter_field: item.field, filter_value: item.value }
  const withLine = measure === trendOf
  const bars = {
    aggregation: defaultAggregation(measure),
    bucket_size: '1w' as const,
    ...filter,
    measure,
    pattern: item.name,
    source_type: 'activity_type' as const,
  }
  const trend = {
    ...filter,
    half_life_days: MEASURE_HALF_LIFE_DEFAULT,
    measure,
    pattern: item.name,
    source_type: 'activity_type' as const,
  }

  return (
    <section class="activity-type-item-section">
      <div class="activity-type-item-section-header">
        <h2>{activityMeasureLabels[measure]}</h2>
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
        <ChartMenu
          exploreHref={chartExplorerHref({ ...item, lookbackDays, measure })}
          widget={(title) =>
            withLine
              ? {
                  config: {
                    layers: [
                      { ...bars, kind: 'bars' },
                      { kind: 'trend', ...trend },
                    ],
                    lookback_days: lookbackDays,
                    ...(title ? { title } : {}),
                  },
                  id: newWidgetId(),
                  type: 'combined_chart',
                }
              : {
                  config: { ...bars, lookback_days: lookbackDays, ...(title ? { title } : {}) },
                  id: newWidgetId(),
                  type: 'bar_chart',
                }
          }
          goalHref={goalsHref({ activity_type: item.name, ...filter, measure, new: 'measure' })}
          extraLinks={
            withLine
              ? [
                  { href: goalsHref({ ...trend, new: 'trend' }), label: 'Set a trend goal' },
                  {
                    href: buildChartUrl({ ...trend, chart_type: 'trend', lookback_days: lookbackDays }),
                    label: 'Open trend in Chart Explorer',
                  },
                ]
              : undefined
          }
        />
      </div>
      <MeasureChartBody
        item={item}
        lookbackDays={lookbackDays}
        measure={measure}
        range={range}
        withLine={withLine}
      />
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
  const definition = definitions?.find((d) => d.name === name)
  const typeName = definition?.display_name ?? toDisplayName(name)

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
        {sessions.length > 0 && (
          <>
            <ShareExercise key={`share-${value}`} name={name} field={field} value={value} />
            <MergeItemValue
              key={value}
              name={name}
              field={field}
              value={value}
              sessionCount={sessions.length}
            />
          </>
        )}
      </header>

      <ExerciseIdentity
        catalog={itemFieldCatalog(definition?.data_schema ?? undefined, field)}
        name={name}
        field={field}
        value={value}
        showsMerge={sessions.length > 0}
      />

      {query.isLoading && <p class="loading">Loading...</p>}
      {query.isError && <p class="error">Failed to load sessions</p>}
      {query.data && sessions.length === 0 && (
        <p class="activity-type-item-empty">No sessions with {value}.</p>
      )}

      {sessions.length > 0 && (
        <>
          <Records item={item} sessions={sessions} />

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

          <MeasureChart all={sessions} item={item} lookback={lookback} />

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
