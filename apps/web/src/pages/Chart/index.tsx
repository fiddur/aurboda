/**
 * Chart exploration page — configurable trend + bar chart with URL-driven state.
 *
 * Reads/writes config via query params so charts are shareable/bookmarkable:
 *   /chart?source_type=tag&tag_definition_id=<uuid>&lookback_days=90&display_period=monthly&half_life_days=15
 *   /chart?source_type=metric&pattern=weight&lookback_days=180&aggregation=mean
 *   /chart?source_type=tag&pattern=coffee&chart_type=bar&bucket_size=1d&lookback_days=30
 */
import type { TagDefinition } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useCallback, useMemo, useState } from 'preact/hooks'

import { BarChart } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { MetricPicker } from '../../components/MetricPicker'
import { TagPicker } from '../../components/TagPicker'
import {
  fetchChartData,
  type FetchChartDataParams,
  fetchScreentimeCategories,
  fetchTagDefinitions,
  fetchTrend,
  type FetchTrendParams,
  type TrendDisplayPeriod,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

type SourceType = 'tag' | 'metric' | 'productivity_category' | 'activity_type'
type ChartType = 'trend' | 'bar'
type BucketSize = '1d' | '1w' | '1M'

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
]

const HALF_LIFE_OPTIONS = [
  { label: '7 days (Quick)', value: 7 },
  { label: '15 days (Responsive)', value: 15 },
  { label: '30 days (Stable)', value: 30 },
]

const BUCKET_SIZE_OPTIONS: { label: string; value: BucketSize }[] = [
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1w' },
  { label: 'Monthly', value: '1M' },
]

interface ChartState {
  aggregation: 'count' | 'mean' | 'sum'
  bucket_size: BucketSize
  chart_type: ChartType
  display_period: TrendDisplayPeriod
  half_life_days: number
  lookback_days: number
  pattern: string
  source_type: SourceType
  tag_definition_id: string
}

/** Parse URL query params into chart config state. */
function parseQuery(query: Record<string, string>): ChartState {
  return {
    aggregation: (query.aggregation ?? 'count') as 'count' | 'mean' | 'sum',
    bucket_size: (query.bucket_size ?? '1d') as BucketSize,
    chart_type: (query.chart_type ?? 'trend') as ChartType,
    display_period: (query.display_period ?? 'monthly') as TrendDisplayPeriod,
    half_life_days: Number(query.half_life_days) || 15,
    lookback_days: Number(query.lookback_days) || 90,
    pattern: query.pattern ?? '',
    source_type: (query.source_type ?? 'tag') as SourceType,
    tag_definition_id: query.tag_definition_id ?? '',
  }
}

/** Sync current state to URL query params. */
function syncUrl(state: ChartState) {
  const params = new URLSearchParams()
  params.set('source_type', state.source_type)
  if (state.pattern) params.set('pattern', state.pattern)
  if (state.tag_definition_id) params.set('tag_definition_id', state.tag_definition_id)
  params.set('lookback_days', String(state.lookback_days))
  params.set('chart_type', state.chart_type)
  if (state.chart_type === 'trend') {
    params.set('display_period', state.display_period)
    params.set('half_life_days', String(state.half_life_days))
  } else {
    params.set('bucket_size', state.bucket_size)
  }
  if (state.source_type === 'metric' && state.aggregation !== 'count') {
    params.set('aggregation', state.aggregation)
  }
  history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

/** Compute start/end ISO strings from lookback_days. */
function lookbackToRange(lookbackDays: number): { start: string; end: string } {
  const end = new Date()
  const start = new Date()
  start.setDate(start.getDate() - lookbackDays)
  return { end: end.toISOString(), start: start.toISOString() }
}

/** Simple category picker for screentime categories. */
function CategoryPicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { data: categories = [] } = useQuery({
    queryFn: fetchScreentimeCategories,
    queryKey: ['screentime-categories'],
    staleTime: 5 * 60 * 1000,
  })

  return (
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      <option value="">Select a category...</option>
      {categories.map((cat) => (
        <option key={cat.id} value={cat.name.join(' > ')}>
          {cat.name.join(' > ')}
        </option>
      ))}
    </select>
  )
}

/** Tag definition picker -- searchable dropdown of all definitions. */
function TagDefinitionPicker({
  definitions,
  selectedId,
  onChange,
}: {
  definitions: TagDefinition[]
  selectedId: string
  onChange: (id: string, pattern: string) => void
}) {
  const [search, setSearch] = useState('')
  const filtered = useMemo(
    () =>
      search
        ? definitions.filter(
            (d) =>
              d.name.toLowerCase().includes(search.toLowerCase()) ||
              d.aliases.some((a) => a.toLowerCase().includes(search.toLowerCase())),
          )
        : definitions,
    [definitions, search],
  )

  return (
    <div>
      <input
        type="text"
        value={search}
        onInput={(e) => setSearch((e.target as HTMLInputElement).value)}
        placeholder="Search tag definitions..."
      />
      <select
        value={selectedId}
        onChange={(e) => {
          const id = (e.target as HTMLSelectElement).value
          const def = definitions.find((d) => d.id === id)
          onChange(id, def ? def.aliases.join('|') : '')
        }}
        style={{ marginTop: '0.25rem' }}
      >
        <option value="">Select a tag definition...</option>
        {filtered.map((def) => (
          <option key={def.id} value={def.id}>
            {def.icon ? `${def.icon} ` : ''}
            {def.name} ({def.aliases.join(', ')})
          </option>
        ))}
      </select>
    </div>
  )
}

/** Source picker shared between both chart modes. */
function SourcePicker({
  state,
  onUpdate,
}: {
  state: ChartState
  onUpdate: (patch: Partial<ChartState>) => void
}) {
  const { data: tagDefinitions = [] } = useQuery({
    queryFn: fetchTagDefinitions,
    queryKey: ['tag-definitions'],
    staleTime: 5 * 60 * 1000,
  })

  return (
    <div class="chart-controls-row">
      <label>
        Source Type
        <select
          value={state.source_type}
          onChange={(e) => {
            const source_type = (e.target as HTMLSelectElement).value as SourceType
            onUpdate({ source_type, pattern: '', tag_definition_id: '' })
          }}
        >
          <option value="tag">Tag</option>
          <option value="metric">Metric</option>
          <option value="productivity_category">Screentime Category</option>
          <option value="activity_type">Activity Type</option>
        </select>
      </label>

      <label class="source-picker">
        {state.source_type === 'tag' && tagDefinitions.length > 0 ? (
          <>
            Tag Definition
            <TagDefinitionPicker
              definitions={tagDefinitions}
              selectedId={state.tag_definition_id}
              onChange={(id, pattern) => onUpdate({ tag_definition_id: id, pattern })}
            />
          </>
        ) : state.source_type === 'tag' ? (
          <>
            Tags
            <TagPicker
              selectedTags={state.pattern ? state.pattern.split('|').filter(Boolean) : []}
              onChange={(tags) => onUpdate({ pattern: tags.join('|') })}
            />
          </>
        ) : state.source_type === 'productivity_category' ? (
          <>
            Category
            <CategoryPicker value={state.pattern} onChange={(pattern) => onUpdate({ pattern })} />
          </>
        ) : state.source_type === 'activity_type' ? (
          <>
            Activity Type
            <input
              type="text"
              value={state.pattern}
              onInput={(e) => onUpdate({ pattern: (e.target as HTMLInputElement).value })}
              placeholder="e.g. running, cycling..."
            />
          </>
        ) : (
          <>
            Metric
            <MetricPicker
              value={state.pattern}
              onChange={(pattern) => onUpdate({ pattern })}
              placeholder="Search metrics..."
            />
          </>
        )}
      </label>
    </div>
  )
}

function ChartControls({
  state,
  onUpdate,
}: {
  state: ChartState
  onUpdate: (patch: Partial<ChartState>) => void
}) {
  return (
    <div class="chart-controls">
      <div class="chart-controls-row">
        <label>
          Chart Type
          <div class="chart-type-toggle">
            <button
              class={`chart-type-btn ${state.chart_type === 'trend' ? 'active' : ''}`}
              onClick={() => onUpdate({ chart_type: 'trend' })}
            >
              Trend (EMA)
            </button>
            <button
              class={`chart-type-btn ${state.chart_type === 'bar' ? 'active' : ''}`}
              onClick={() => onUpdate({ chart_type: 'bar' })}
            >
              Bar
            </button>
          </div>
        </label>
      </div>

      <SourcePicker state={state} onUpdate={onUpdate} />

      <div class="chart-controls-row">
        <label>
          Lookback
          <select
            value={state.lookback_days}
            onChange={(e) => onUpdate({ lookback_days: Number((e.target as HTMLSelectElement).value) })}
          >
            {LOOKBACK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>

        {state.chart_type === 'trend' ? (
          <>
            <label>
              Display Period
              <select
                value={state.display_period}
                onChange={(e) =>
                  onUpdate({ display_period: (e.target as HTMLSelectElement).value as TrendDisplayPeriod })
                }
              >
                <option value="daily">Per day</option>
                <option value="weekly">Per week</option>
                <option value="monthly">Per month</option>
              </select>
            </label>

            <label>
              Half-life
              <select
                value={state.half_life_days}
                onChange={(e) => onUpdate({ half_life_days: Number((e.target as HTMLSelectElement).value) })}
              >
                {HALF_LIFE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : (
          <label>
            Bucket Size
            <select
              value={state.bucket_size}
              onChange={(e) => onUpdate({ bucket_size: (e.target as HTMLSelectElement).value as BucketSize })}
            >
              {BUCKET_SIZE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </label>
        )}

        {state.source_type === 'metric' && (
          <label>
            Aggregation
            <select
              value={state.aggregation}
              onChange={(e) =>
                onUpdate({ aggregation: (e.target as HTMLSelectElement).value as 'count' | 'mean' | 'sum' })
              }
            >
              <option value="mean">Average</option>
              <option value="sum">Sum</option>
              <option value="count">Count</option>
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

function TrendDisplay({ params }: { params: FetchTrendParams }) {
  const trendQuery = useQuery({
    enabled: Boolean(params.pattern),
    queryFn: () => fetchTrend(params),
    queryKey: ['trend', params],
    staleTime: 5 * 60 * 1000,
  })

  if (!params.pattern) {
    return <div class="chart-empty">Select a source to view trend data.</div>
  }

  if (trendQuery.isLoading) {
    return <div class="chart-loading">Loading trend data...</div>
  }

  if (trendQuery.isError || !trendQuery.data) {
    return <div class="chart-error">Failed to load trend data.</div>
  }

  const { current_value, display_unit, history } = trendQuery.data

  return (
    <div class="chart-display">
      <div class="chart-current-value">
        <span class="chart-current-number">{current_value.toFixed(1)}</span>
        <span class="chart-current-unit">{display_unit}</span>
      </div>
      <TrendLineChart data={history} color="#8b5cf6" height={350} />
    </div>
  )
}

function BarDisplay({ params }: { params: FetchChartDataParams }) {
  const barQuery = useQuery({
    enabled: Boolean(params.pattern || params.tag_definition_id),
    queryFn: () => fetchChartData(params),
    queryKey: ['chart-data', params],
    staleTime: 5 * 60 * 1000,
  })

  if (!params.pattern && !params.tag_definition_id) {
    return <div class="chart-empty">Select a source to view chart data.</div>
  }

  if (barQuery.isLoading) {
    return <div class="chart-loading">Loading chart data...</div>
  }

  if (barQuery.isError) {
    return <div class="chart-error">Failed to load chart data.</div>
  }

  const buckets = barQuery.data ?? []

  return (
    <div class="chart-display">
      <BarChart data={buckets} color="#8b5cf6" height={350} />
    </div>
  )
}

export function Chart() {
  const isLoggedIn = auth.value.token
  const { query } = useLocation()
  const [state, setState] = useState(() => parseQuery(query))

  const handleUpdate = useCallback(
    (patch: Partial<ChartState>) => {
      const next = { ...state, ...patch }
      setState(next)
      syncUrl(next)
    },
    [state],
  )

  if (!isLoggedIn) {
    return (
      <div class="chart-page">
        <div class="chart-login-prompt">
          <h2>Please log in to explore charts</h2>
          <a href="/login">Log in</a>
        </div>
      </div>
    )
  }

  const { start, end } = lookbackToRange(state.lookback_days)

  return (
    <div class="chart-page">
      <h1>Chart Explorer</h1>
      <p class="chart-page-description">
        Explore time-weighted averages (EMA) or raw bucketed data for tags, metrics, screentime categories,
        and activity types. Toggle between Trend and Bar chart modes.
      </p>

      <ChartControls state={state} onUpdate={handleUpdate} />

      {state.chart_type === 'trend' ? (
        <TrendDisplay
          params={{
            aggregation: state.source_type === 'metric' ? state.aggregation : 'count',
            display_period: state.display_period,
            half_life_days: state.half_life_days,
            lookback_days: state.lookback_days,
            pattern: state.pattern,
            source_type: state.source_type,
            ...(state.tag_definition_id ? { tag_definition_id: state.tag_definition_id } : {}),
          }}
        />
      ) : (
        <BarDisplay
          params={{
            aggregation: state.source_type === 'metric' ? state.aggregation : 'count',
            bucket_size: state.bucket_size,
            end,
            pattern: state.pattern || undefined,
            source_type: state.source_type,
            start,
            ...(state.tag_definition_id ? { tag_definition_id: state.tag_definition_id } : {}),
          }}
        />
      )}
    </div>
  )
}
