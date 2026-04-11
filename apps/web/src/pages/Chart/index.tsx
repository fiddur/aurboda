/**
 * Chart exploration page — configurable trend + bar chart with URL-driven state.
 *
 * Reads/writes config via query params so charts are shareable/bookmarkable:
 *   /chart?source_type=activity_type&pattern=coffee&lookback_days=90&display_period=monthly&half_life_days=15
 *   /chart?source_type=metric&pattern=weight&lookback_days=180&aggregation=mean
 *   /chart?source_type=activity_type&pattern=coffee&chart_type=bar&bucket_size=1d&lookback_days=30
 */
import type { DashboardConfig, DashboardSection, DashboardWidget, SectionType } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation } from 'preact-iso'
import { useCallback, useMemo, useState } from 'preact/hooks'

import { BarChart, type BarClickInfo } from '../../components/charts/BarChart'
import { TrendLineChart } from '../../components/charts/TrendLineChart'
import { MetricPicker } from '../../components/MetricPicker'
import {
  fetchActivityTypeDefinitions,
  fetchChartData,
  type FetchChartDataParams,
  fetchDashboard,
  fetchScreentimeCategories,
  fetchTrend,
  type FetchTrendParams,
  saveDashboard,
  type TrendDisplayPeriod,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

type SourceType = 'tag' | 'metric' | 'productivity_category' | 'activity_type'
type ChartType = 'trend' | 'bar'
type BucketSize = '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'

const LOOKBACK_OPTIONS = [
  { label: '1 day', value: 1 },
  { label: '3 days', value: 3 },
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

const HALF_LIFE_OPTIONS = [
  { label: '7 days (Quick)', value: 7 },
  { label: '15 days (Responsive)', value: 15 },
  { label: '30 days (Stable)', value: 30 },
]

const BUCKET_SIZE_OPTIONS: { label: string; value: BucketSize }[] = [
  { label: '1 min', value: '1m' },
  { label: '5 min', value: '5m' },
  { label: '15 min', value: '15m' },
  { label: 'Hourly', value: '1h' },
  { label: 'Daily', value: '1d' },
  { label: 'Weekly', value: '1w' },
  { label: 'Monthly', value: '1M' },
]

interface ChartState {
  aggregation: 'count' | 'mean' | 'sum'
  breakdown_fields: string[]
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
    breakdown_fields: query.breakdown_fields ? query.breakdown_fields.split(',').filter(Boolean) : [],
    bucket_size: (query.bucket_size ?? '1d') as BucketSize,
    chart_type: (query.chart_type ?? 'trend') as ChartType,
    display_period: (query.display_period ?? 'monthly') as TrendDisplayPeriod,
    half_life_days: Number(query.half_life_days) || 15,
    lookback_days: Number(query.lookback_days) || 90,
    pattern: query.pattern ?? '',
    source_type: (query.source_type ?? 'activity_type') as SourceType,
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
  if (
    (state.source_type === 'metric' || state.source_type === 'activity_type') &&
    state.aggregation !== 'count'
  ) {
    params.set('aggregation', state.aggregation)
  }
  if (state.breakdown_fields.length > 0) {
    params.set('breakdown_fields', state.breakdown_fields.join(','))
  }
  history.replaceState(null, '', `${window.location.pathname}?${params}`)
}

/** Compute start/end ISO strings from lookback_days, rounded to day boundaries for stable query keys. */
function lookbackToRange(lookbackDays: number): { start: string; end: string } {
  const now = new Date()
  const end = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59))
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - lookbackDays)
  start.setUTCHours(0, 0, 0, 0)
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

/** Source picker shared between both chart modes. */
function SourcePicker({
  state,
  onUpdate,
}: {
  state: ChartState
  onUpdate: (patch: Partial<ChartState>) => void
}) {
  const { data: activityTypes = [] } = useQuery({
    queryFn: fetchActivityTypeDefinitions,
    queryKey: ['activity-type-definitions'],
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
          <option value="activity_type">Activity Type</option>
          <option value="metric">Metric</option>
          <option value="productivity_category">Screentime Category</option>
        </select>
      </label>

      <label class="source-picker">
        {state.source_type === 'productivity_category' ? (
          <>
            Category
            <CategoryPicker value={state.pattern} onChange={(pattern) => onUpdate({ pattern })} />
          </>
        ) : state.source_type === 'activity_type' ? (
          <>
            Activity Type
            <select
              value={state.pattern}
              onChange={(e) =>
                onUpdate({ breakdown_fields: [], pattern: (e.target as HTMLSelectElement).value })
              }
            >
              <option value="">-- select --</option>
              {activityTypes.map((d) => (
                <option key={d.name} value={d.name}>
                  {d.display_name} ({d.name})
                </option>
              ))}
            </select>
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

      {state.source_type === 'activity_type' &&
        state.pattern &&
        (() => {
          const typeDef = activityTypes.find((d) => d.name === state.pattern)
          const categoricalFields = typeDef?.data_schema?.fields.filter((f) => f.is_categorical) ?? []
          if (categoricalFields.length === 0) return null
          return (
            <div class="breakdown-fields">
              <span class="breakdown-label">Breakdown by:</span>
              {categoricalFields.map((field) => (
                <label key={field.name} class="breakdown-checkbox">
                  <input
                    type="checkbox"
                    checked={state.breakdown_fields.includes(field.name)}
                    onChange={() => {
                      const next = state.breakdown_fields.includes(field.name)
                        ? state.breakdown_fields.filter((f) => f !== field.name)
                        : [...state.breakdown_fields, field.name]
                      onUpdate({ breakdown_fields: next })
                    }}
                  />
                  {field.label ?? field.name}
                </label>
              ))}
            </div>
          )
        })()}
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

        {(state.source_type === 'metric' || state.source_type === 'activity_type') && (
          <label>
            Aggregation
            <select
              value={state.aggregation}
              onChange={(e) =>
                onUpdate({ aggregation: (e.target as HTMLSelectElement).value as 'count' | 'mean' | 'sum' })
              }
            >
              {state.source_type === 'metric' && <option value="mean">Average</option>}
              <option value="sum">Sum (hours)</option>
              <option value="count">Count</option>
            </select>
          </label>
        )}
      </div>
    </div>
  )
}

const SERIES_COLORS = ['#8b5cf6', '#f97316', '#22c55e', '#3b82f6', '#ef4444', '#f59e0b', '#ec4899', '#14b8a6']

function BreakdownLegend({ series, colors }: { series: string[]; colors: string[] }) {
  return (
    <div class="breakdown-legend">
      {series.map((name, i) => (
        <span key={name} class="breakdown-legend-item">
          <span class="breakdown-legend-dot" style={{ background: colors[i % colors.length] }} />
          {name}
        </span>
      ))}
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

  if (!params.pattern) return <div class="chart-empty">Select a source to view trend data.</div>
  if (trendQuery.isLoading) return <div class="chart-loading">Loading trend data...</div>
  if (trendQuery.isError || !trendQuery.data) return <div class="chart-error">Failed to load trend data.</div>

  const { breakdown_histories, breakdown_series, current_value, display_unit, history } = trendQuery.data

  if (breakdown_series?.length && breakdown_histories) {
    return (
      <div class="chart-display">
        <BreakdownLegend series={breakdown_series} colors={SERIES_COLORS} />
        <TrendLineChart
          data={[]}
          color="#8b5cf6"
          height={350}
          multiSeries={breakdown_series.map((name, i) => ({
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            data: (breakdown_histories[name] ?? []).map((p) => ({ date: p.date, value: p.value })),
            name,
          }))}
        />
      </div>
    )
  }

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

/** Compute the end of a bucket given its start and size. */
const computeBucketEnd = (start: Date, bucketSize: string): Date => {
  const end = new Date(start)
  switch (bucketSize) {
    case '1m':
      end.setMinutes(end.getMinutes() + 1)
      break
    case '5m':
      end.setMinutes(end.getMinutes() + 5)
      break
    case '15m':
      end.setMinutes(end.getMinutes() + 15)
      break
    case '1h':
      end.setHours(end.getHours() + 1)
      break
    case '1d':
      end.setDate(end.getDate() + 1)
      break
    case '1w':
      end.setDate(end.getDate() + 7)
      break
    case '1M':
      end.setMonth(end.getMonth() + 1)
      break
  }
  return end
}

/** Build a /data URL for a bar click. */
const buildBarDataHref = (
  info: BarClickInfo,
  pattern: string,
  bucketSize: string,
  breakdownFields?: string[],
): string => {
  const bucketStart = new Date(info.bucket_start)
  const bucketEnd = computeBucketEnd(bucketStart, bucketSize)

  const urlParams = new URLSearchParams()
  urlParams.set('from', bucketStart.toISOString())
  urlParams.set('to', bucketEnd.toISOString())
  urlParams.set('date', bucketStart.toISOString().slice(0, 10))
  urlParams.set('types', pattern)
  urlParams.set('hide', 'location,music,meal,report,screentime')

  if (info.series_name && breakdownFields?.length) {
    const values = info.series_name.split(' / ')
    const filters = breakdownFields.map((field, i) => `${field}:${values[i] ?? '(none)'}`).join(',')
    urlParams.set('data_filter', filters)
  }

  return `/data?${urlParams}`
}

function BarDisplay({ params }: { params: FetchChartDataParams }) {
  const getBarHref =
    params.source_type === 'activity_type' && params.pattern
      ? (info: BarClickInfo) =>
          buildBarDataHref(info, params.pattern!, params.bucket_size ?? '1d', params.breakdown_fields)
      : undefined

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

  const result = barQuery.data

  if (result?.breakdown_buckets?.length) {
    const series = result.breakdown_series ?? []
    return (
      <div class="chart-display">
        <BreakdownLegend series={series} colors={SERIES_COLORS} />
        <BarChart
          data={[]}
          height={350}
          bucketSize={params.bucket_size}
          rangeStart={params.start}
          rangeEnd={params.end}
          getBarHref={getBarHref}
          multiSeries={series.map((name, i) => ({
            color: SERIES_COLORS[i % SERIES_COLORS.length],
            data: result.breakdown_buckets!.map((b) => ({
              bucket_start: b.bucket_start,
              value: b.series[name] ?? 0,
            })),
            name,
          }))}
        />
      </div>
    )
  }

  const buckets = result?.buckets ?? []

  return (
    <div class="chart-display">
      <BarChart
        data={buckets}
        color="#8b5cf6"
        height={350}
        bucketSize={params.bucket_size}
        rangeStart={params.start}
        rangeEnd={params.end}
        getBarHref={getBarHref}
      />
    </div>
  )
}

/** Generate unique ID for widgets and sections. */
const generateId = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`

/** Build a dashboard widget config from the current chart state. */
function buildWidgetFromState(state: ChartState, title: string): DashboardWidget {
  if (state.chart_type === 'bar') {
    return {
      config: {
        aggregation: state.aggregation,
        bucket_size: state.bucket_size,
        lookback_days: state.lookback_days,
        ...(state.pattern ? { pattern: state.pattern } : {}),
        source_type: state.source_type,
        ...(state.tag_definition_id ? { tag_definition_id: state.tag_definition_id } : {}),
        ...(title ? { title } : {}),
      },
      id: generateId('widget'),
      type: 'bar_chart',
    } as DashboardWidget
  }

  return {
    config: {
      aggregation: state.aggregation,
      display_period: state.display_period,
      half_life_days: state.half_life_days,
      lookback_days: state.lookback_days,
      pattern: state.pattern,
      source_type:
        state.source_type === 'activity_type' || state.source_type === 'metric'
          ? state.source_type
          : 'activity_type',
      ...(state.tag_definition_id ? { tag_definition_id: state.tag_definition_id } : {}),
      ...(title ? { title } : {}),
    },
    id: generateId('widget'),
    type: 'trend_chart',
  } as DashboardWidget
}

/** Modal for adding the current chart to a dashboard section. */
function AddToDashboardModal({ state, onClose }: { state: ChartState; onClose: () => void }) {
  const queryClient = useQueryClient()
  const [title, setTitle] = useState('')
  const [selectedSectionId, setSelectedSectionId] = useState('')
  const [newSectionTitle, setNewSectionTitle] = useState('')
  const [saved, setSaved] = useState(false)

  const dashboardQuery = useQuery({
    queryFn: fetchDashboard,
    queryKey: ['dashboard'],
    staleTime: 5 * 60 * 1000,
  })

  const saveMutation = useMutation({
    mutationFn: saveDashboard,
    onSuccess: (data) => {
      queryClient.setQueryData(['dashboard'], data)
      setSaved(true)
    },
  })

  const dashboard: DashboardConfig | undefined = dashboardQuery.data
  const chartsSections = dashboard?.sections.filter((s) => s.type === 'charts') ?? []

  const handleSave = () => {
    if (!dashboard) return

    const widget = buildWidgetFromState(state, title)

    let newDashboard: DashboardConfig
    if (selectedSectionId === '__new__') {
      const sectionTitle = newSectionTitle.trim() || 'Charts'
      const newSection: DashboardSection = {
        id: generateId('section'),
        title: sectionTitle,
        type: 'charts' as SectionType,
        widgets: [widget],
      }
      newDashboard = { ...dashboard, sections: [...dashboard.sections, newSection] }
    } else {
      newDashboard = {
        ...dashboard,
        sections: dashboard.sections.map((section) =>
          section.id === selectedSectionId ? { ...section, widgets: [...section.widgets, widget] } : section,
        ),
      }
    }

    saveMutation.mutate(newDashboard)
  }

  const canSave =
    !saveMutation.isPending &&
    (selectedSectionId === '__new__' ? newSectionTitle.trim().length > 0 : selectedSectionId.length > 0)

  return (
    <div class="dashboard-editor-overlay" onClick={onClose}>
      <div class="dashboard-editor-modal" onClick={(e) => e.stopPropagation()}>
        <div class="modal-header">
          <h3>Add to Dashboard</h3>
          <button class="close-btn" onClick={onClose}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div class="modal-content">
          {saved ? (
            <div class="add-to-dash-success">Widget added to dashboard!</div>
          ) : (
            <div class="config-form">
              <div class="form-group">
                <label>Title (optional)</label>
                <input
                  type="text"
                  value={title}
                  onInput={(e) => setTitle((e.target as HTMLInputElement).value)}
                  placeholder={state.pattern || 'Chart title'}
                />
              </div>

              <div class="form-group">
                <label>Dashboard Section</label>
                <select
                  value={selectedSectionId}
                  onChange={(e) => setSelectedSectionId((e.target as HTMLSelectElement).value)}
                >
                  <option value="">Select a section...</option>
                  {chartsSections.map((section) => (
                    <option key={section.id} value={section.id}>
                      {section.title}
                    </option>
                  ))}
                  <option value="__new__">+ Create new section</option>
                </select>
              </div>

              {selectedSectionId === '__new__' && (
                <div class="form-group">
                  <label>New Section Title</label>
                  <input
                    type="text"
                    value={newSectionTitle}
                    onInput={(e) => setNewSectionTitle((e.target as HTMLInputElement).value)}
                    placeholder="e.g., My Charts"
                  />
                </div>
              )}
            </div>
          )}
        </div>

        <div class="modal-footer">
          {saved ? (
            <button class="btn-primary" onClick={onClose}>
              Done
            </button>
          ) : (
            <>
              <button class="btn-secondary" onClick={onClose}>
                Cancel
              </button>
              <button class="btn-primary" onClick={handleSave} disabled={!canSave}>
                {saveMutation.isPending ? 'Saving...' : 'Add Widget'}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

export function Chart() {
  const isLoggedIn = auth.value.token
  const { query } = useLocation()
  const [state, setState] = useState(() => parseQuery(query))
  const [showAddToDashboard, setShowAddToDashboard] = useState(false)

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

  const { start, end } = useMemo(() => lookbackToRange(state.lookback_days), [state.lookback_days])

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
            aggregation: state.aggregation,
            breakdown_fields: state.breakdown_fields.length > 0 ? state.breakdown_fields : undefined,
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
            aggregation: state.aggregation,
            breakdown_fields: state.breakdown_fields.length > 0 ? state.breakdown_fields : undefined,
            bucket_size: state.bucket_size,
            end,
            pattern: state.pattern || undefined,
            source_type: state.source_type,
            start,
            ...(state.tag_definition_id ? { tag_definition_id: state.tag_definition_id } : {}),
          }}
        />
      )}

      {(state.pattern || state.tag_definition_id) && (
        <div class="add-to-dashboard-row">
          <button class="btn-add-to-dashboard" onClick={() => setShowAddToDashboard(true)}>
            <svg
              width="16"
              height="16"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
            >
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add to Dashboard
          </button>
        </div>
      )}

      {showAddToDashboard && (
        <AddToDashboardModal state={state} onClose={() => setShowAddToDashboard(false)} />
      )}
    </div>
  )
}
