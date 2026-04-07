/**
 * Metric meta page — overview of a metric type (e.g. "weight", "body_fat", or custom metrics).
 * Shows description, unit, trend chart, recent values, and edit for custom metrics.
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { MiniTrendChart } from '../../components/MiniTrendChart'
import {
  deleteMetricPoint,
  fetchCustomMetrics,
  fetchMetricTimeSeriesWithSource,
  fetchTrend,
  updateCustomMetric,
  type CustomMetricDefinition,
  type FetchTrendParams,
  type MetricDataPointWithSource,
} from '../../state/api'
import { buildChartUrl } from '../../utils/chart-url'
import { formatDateTime } from '../EntityDetail/format-utils'
import './style.css'

const LOOKBACK_OPTIONS = [
  { label: '30 days', value: 30 },
  { label: '90 days', value: 90 },
  { label: '180 days', value: 180 },
  { label: '1 year', value: 365 },
  { label: '2 years', value: 730 },
  { label: 'All time', value: 3650 },
]

/** Map metric name to human-readable display label. */
const formatMetricLabel = (metric: string): string =>
  metric.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

/** Format a value with appropriate precision. */
const formatValue = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

/** Format a data source name for display. */
const formatSourceLabel = (source: string): string =>
  source.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

function SourceFilteredChart({ metric, unit, lookback }: { metric: string; unit: string; lookback: number }) {
  const [selectedSource, setSelectedSource] = useState<string | null>(null)

  const end = new Date()
  const start = new Date(end.getTime() - lookback * 86400000)

  const { data, isLoading } = useQuery({
    queryFn: () => fetchMetricTimeSeriesWithSource(metric, start, end),
    queryKey: ['metric-with-source', metric, lookback],
    staleTime: 5 * 60 * 1000,
  })

  if (isLoading) return <p class="loading">Loading...</p>
  if (!data || data.length === 0) return <p class="metric-meta-empty">No data available</p>

  // Extract unique sources
  const sources = [...new Set(data.map((d) => d.source))].sort()

  // Only show this section if there are multiple sources
  if (sources.length < 2) return null

  // Filter data by selected source
  const filtered: MetricDataPointWithSource[] = selectedSource
    ? data.filter((d) => d.source === selectedSource)
    : data

  // Convert to chart data format
  const chartData: { date: string; value: number }[] = filtered.map((d) => ({
    date: d.time.toISOString().split('T')[0],
    value: d.value,
  }))

  return (
    <section class="metric-meta-section">
      <h2>By Source</h2>
      <div class="source-filter-chips">
        <button
          type="button"
          class={`source-chip ${selectedSource === null ? 'active' : ''}`}
          onClick={() => setSelectedSource(null)}
        >
          All ({data.length})
        </button>
        {sources.map((source) => {
          const count = data.filter((d) => d.source === source).length
          return (
            <button
              type="button"
              key={source}
              class={`source-chip ${selectedSource === source ? 'active' : ''}`}
              onClick={() => setSelectedSource(selectedSource === source ? null : source)}
            >
              {formatSourceLabel(source)} ({count})
            </button>
          )
        })}
      </div>
      {chartData.length >= 2 && <MiniTrendChart data={chartData} color="#2563eb" />}
      {chartData.length < 2 && chartData.length > 0 && (
        <p class="metric-meta-empty">
          {formatValue(chartData[0].value)} {unit} ({chartData[0].date})
        </p>
      )}
    </section>
  )
}

function RecentValues({ metric, unit }: { metric: string; unit: string }) {
  const queryClient = useQueryClient()
  const end = new Date()
  const start = new Date(end.getTime() - 30 * 86400000)

  const { data, isLoading } = useQuery({
    queryFn: () => fetchMetricTimeSeriesWithSource(metric, start, end),
    queryKey: ['metric-recent', metric],
    staleTime: 5 * 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: ({ time, source }: { time: string; source: string }) =>
      deleteMetricPoint(metric, time, source),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['metric-recent', metric] })
      queryClient.invalidateQueries({ queryKey: ['trend'] })
      queryClient.invalidateQueries({ queryKey: ['metric-with-source', metric] })
    },
  })

  if (isLoading) return <p class="loading">Loading...</p>
  if (!data || data.length === 0) return <p class="metric-meta-empty">No data in the last 30 days</p>

  // Show up to 10 most recent
  const recent = data.slice(-10).reverse()

  return (
    <div class="metric-meta-recent-list">
      {recent.map((point) => {
        const entityId = `${point.time.toISOString()}|${metric}|${point.source}`
        return (
          <div key={point.time.toISOString() + point.source} class="metric-meta-recent-item">
            <a href={`/detail/metric/${encodeURIComponent(entityId)}`} class="metric-meta-recent-link">
              <span class="metric-meta-recent-time">{formatDateTime(point.time)}</span>
              <span class="metric-meta-recent-value">
                {formatValue(point.value)}
                {unit ? ` ${unit}` : ''}
              </span>
            </a>
            <button
              type="button"
              class="metric-meta-delete-btn"
              title="Delete this measurement"
              disabled={deleteMutation.isPending}
              onClick={(e) => {
                e.preventDefault()
                e.stopPropagation()
                deleteMutation.mutate({ source: point.source, time: point.time.toISOString() })
              }}
            >
              ×
            </button>
          </div>
        )
      })}
      {data.length > 10 && (
        <p class="metric-meta-more">
          +{data.length - 10} more in last 30 days ({data.length} total)
        </p>
      )}
    </div>
  )
}

function CustomMetricEditor({
  metric,
  onUpdated,
}: {
  metric: CustomMetricDefinition
  onUpdated: () => void
}) {
  const [isEditing, setIsEditing] = useState(false)
  const [unit, setUnit] = useState(metric.unit)
  const [description, setDescription] = useState(metric.description ?? '')
  const [minValue, setMinValue] = useState(metric.min_value?.toString() ?? '')
  const [maxValue, setMaxValue] = useState(metric.max_value?.toString() ?? '')

  const updateMutation = useMutation({
    mutationFn: () =>
      updateCustomMetric(metric.name, {
        description: description || undefined,
        max_value: maxValue ? parseFloat(maxValue) : null,
        min_value: minValue ? parseFloat(minValue) : null,
        unit,
      }),
    onSuccess: () => {
      setIsEditing(false)
      onUpdated()
    },
  })

  if (!isEditing) {
    return (
      <div class="metric-meta-custom-info">
        <div class="metric-meta-custom-fields">
          {metric.description && (
            <div class="metric-meta-field-row">
              <span class="metric-meta-field-label">Description</span>
              <span>{metric.description}</span>
            </div>
          )}
          <div class="metric-meta-field-row">
            <span class="metric-meta-field-label">Unit</span>
            <span>{metric.unit}</span>
          </div>
          {(metric.min_value !== undefined || metric.max_value !== undefined) && (
            <div class="metric-meta-field-row">
              <span class="metric-meta-field-label">Range</span>
              <span>
                {metric.min_value ?? '—'} – {metric.max_value ?? '—'}
              </span>
            </div>
          )}
        </div>
        <button type="button" class="btn-secondary" onClick={() => setIsEditing(true)}>
          Edit
        </button>
      </div>
    )
  }

  return (
    <div class="metric-meta-custom-edit">
      <div class="metric-meta-edit-grid">
        <label>
          <span class="metric-meta-field-label">Unit</span>
          <input
            type="text"
            value={unit}
            onInput={(e) => setUnit((e.target as HTMLInputElement).value)}
            placeholder="e.g. kg, mg, count"
          />
        </label>
        <label>
          <span class="metric-meta-field-label">Description</span>
          <input
            type="text"
            value={description}
            onInput={(e) => setDescription((e.target as HTMLInputElement).value)}
            placeholder="Description (optional)"
          />
        </label>
        <label>
          <span class="metric-meta-field-label">Min Value</span>
          <input
            type="number"
            step="any"
            value={minValue}
            onInput={(e) => setMinValue((e.target as HTMLInputElement).value)}
            placeholder="Min (optional)"
          />
        </label>
        <label>
          <span class="metric-meta-field-label">Max Value</span>
          <input
            type="number"
            step="any"
            value={maxValue}
            onInput={(e) => setMaxValue((e.target as HTMLInputElement).value)}
            placeholder="Max (optional)"
          />
        </label>
      </div>
      <div class="metric-meta-edit-actions">
        <button
          type="button"
          class="btn-primary"
          onClick={() => updateMutation.mutate()}
          disabled={updateMutation.isPending || !unit.trim()}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
        <button type="button" class="btn-secondary" onClick={() => setIsEditing(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}

export function MetricMeta() {
  const { params } = useRoute()
  const metricName = decodeURIComponent(params.metricName as string)
  const queryClient = useQueryClient()

  const [lookback, setLookback] = useState(90)

  // Check if it's a custom metric
  const { data: customMetrics } = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['custom-metrics'],
    staleTime: 30 * 60 * 1000,
  })

  const customMetric = customMetrics?.find((m) => m.name === metricName)
  const isBuiltIn = !customMetric && metricName in (builtinMetricUnits as Record<string, string>)
  const unit = customMetric?.unit ?? (builtinMetricUnits as Record<string, string>)[metricName] ?? ''
  const label = formatMetricLabel(metricName)

  // Trend query
  const trendParams: FetchTrendParams = {
    aggregation: 'mean',
    display_period: 'daily',
    half_life_days: 15,
    lookback_days: lookback,
    pattern: metricName,
    source_type: 'metric',
  }

  const trendQuery = useQuery({
    queryFn: () => fetchTrend(trendParams),
    queryKey: ['trend', trendParams],
    staleTime: 5 * 60 * 1000,
  })

  const handleCustomUpdated = () => {
    queryClient.invalidateQueries({ queryKey: ['custom-metrics'] })
    queryClient.invalidateQueries({ queryKey: ['customMetrics'] })
  }

  return (
    <div class="metric-meta-page">
      <div class="metric-meta-header">
        <h1>{label}</h1>
        <div class="metric-meta-subtitle">
          <code>{metricName}</code>
          {unit && <span class="metric-meta-unit-badge">{unit}</span>}
          {isBuiltIn && <span class="metric-meta-type-badge">Built-in</span>}
          {customMetric && <span class="metric-meta-type-badge custom">Custom</span>}
        </div>
      </div>

      {/* Custom metric settings */}
      {customMetric && (
        <section class="metric-meta-section">
          <h2>Definition</h2>
          <CustomMetricEditor metric={customMetric} onUpdated={handleCustomUpdated} />
        </section>
      )}

      {/* Built-in metric info */}
      {isBuiltIn && (
        <section class="metric-meta-section">
          <h2>Info</h2>
          <div class="metric-meta-field-row">
            <span class="metric-meta-field-label">Type</span>
            <span>Built-in metric</span>
          </div>
          <div class="metric-meta-field-row">
            <span class="metric-meta-field-label">Unit</span>
            <span>{unit}</span>
          </div>
        </section>
      )}

      {/* Trend */}
      <section class="metric-meta-section">
        <div class="metric-meta-section-header">
          <h2>Trend</h2>
          <a
            href={buildChartUrl({
              aggregation: 'mean',
              chart_type: 'bar',
              lookback_days: lookback,
              pattern: metricName,
              source_type: 'metric',
            })}
            class="metric-meta-chart-link"
          >
            Explore in Chart
          </a>
          <select
            value={lookback}
            onChange={(e) => setLookback(Number((e.target as HTMLSelectElement).value))}
          >
            {LOOKBACK_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </div>

        {trendQuery.isLoading && <p class="loading">Loading trend...</p>}
        {trendQuery.error && <p class="error">Failed to load trend data</p>}
        {trendQuery.data && (
          <>
            <div class="metric-meta-trend-value">
              <span class="metric-meta-trend-number">{trendQuery.data.current_value.toFixed(2)}</span>
              <span class="metric-meta-trend-unit">{unit || trendQuery.data.display_unit}</span>
            </div>
            <a
              href={`/chart?source_type=metric&pattern=${encodeURIComponent(metricName)}&lookback_days=${lookback}&aggregation=mean`}
              style={{ display: 'block' }}
            >
              <MiniTrendChart data={trendQuery.data.history} color="#2563eb" />
            </a>
          </>
        )}
      </section>

      {/* Source-filtered chart (only shown when multiple sources exist) */}
      <SourceFilteredChart metric={metricName} unit={unit} lookback={lookback} />

      {/* Recent values */}
      <section class="metric-meta-section">
        <h2>Recent Values</h2>
        <RecentValues metric={metricName} unit={unit} />
      </section>

      {/* Quick links */}
      <section class="metric-meta-section">
        <h2>Related</h2>
        <div class="metric-meta-links">
          <a
            href={`/chart?source_type=metric&pattern=${encodeURIComponent(metricName)}`}
            class="metric-meta-link"
          >
            Chart Explorer
          </a>
          <a href="/correlations" class="metric-meta-link">
            Correlations
          </a>
          <a href="/data-sources/aurboda" class="metric-meta-link">
            Custom Metrics Settings
          </a>
        </div>
      </section>
    </div>
  )
}
