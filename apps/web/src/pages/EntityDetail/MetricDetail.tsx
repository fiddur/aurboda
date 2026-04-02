/**
 * Metric data point detail view.
 * Supports read mode (plain text) and edit mode (input fields).
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'preact/hooks'

import {
  fetchCustomMetrics,
  fetchMetricTimeSeriesWithSource,
  type MetricDataPointWithSource,
} from '../../state/api'
import { formatDateTime } from './format-utils'

export interface MetricDraft {
  time: string // yyyy-MM-ddTHH:mm for datetime-local
  value: string // string so input binding works naturally
}

/** Parse a metric entity ID (format: "iso_time|metric_name|source" or "iso_time|metric_name"). */
export const parseMetricEntityId = (
  entityId: string,
): { time: string; metric: string; source: string | undefined } | null => {
  const parts = entityId.split('|')
  if (parts.length < 2 || parts.length > 3) return null
  const [time, metric, source] = parts
  if (!time || !metric) return null
  const d = new Date(time)
  if (isNaN(d.getTime())) return null
  return { metric, source, time }
}

/** Map metric name to human-readable display label. */
const formatMetricLabel = (metric: string): string =>
  metric.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

interface MetricDetailProps {
  entityId: string
  isEditing?: boolean
  draft?: MetricDraft
  onDraftChange?: (draft: MetricDraft) => void
  /** Called once when the point loads, so parent can populate draft value. */
  onDraftInit?: (partial: Partial<MetricDraft>) => void
}

export const MetricDetail = ({
  entityId,
  isEditing = false,
  draft,
  onDraftChange,
  onDraftInit,
}: MetricDetailProps) => {
  const parsed = parseMetricEntityId(entityId)

  const customMetricsQuery = useQuery({
    queryFn: fetchCustomMetrics,
    queryKey: ['custom-metrics'],
    staleTime: 30 * 60 * 1000,
  })

  const pointQuery = useQuery({
    enabled: parsed !== null,
    queryFn: async (): Promise<MetricDataPointWithSource | null> => {
      if (!parsed) return null
      const time = new Date(parsed.time)
      const start = new Date(time.getTime() - 500)
      const end = new Date(time.getTime() + 500)
      const points = await fetchMetricTimeSeriesWithSource(parsed.metric, start, end)
      return points.find((p) => p.source === parsed.source) ?? points[0] ?? null
    },
    queryKey: ['metric-point', entityId],
    staleTime: 60_000,
  })

  const point = pointQuery.data

  // When point loads, populate draft value for editing
  useEffect(() => {
    if (point && onDraftInit) {
      onDraftInit({ value: String(point.value) })
    }
  }, [point, onDraftInit])

  if (!parsed) {
    return <p class="error">Invalid metric reference</p>
  }

  const metricLabel = formatMetricLabel(parsed.metric)
  const customUnit = customMetricsQuery.data?.find((m) => m.name === parsed.metric)?.unit
  const unit = customUnit ?? (builtinMetricUnits as Record<string, string>)[parsed.metric] ?? ''
  const source = parsed.source ?? point?.source ?? '…'

  if (isEditing && draft && onDraftChange) {
    return (
      <MetricEditView
        metric={parsed.metric}
        metricLabel={metricLabel}
        source={source}
        unit={unit}
        draft={draft}
        onDraftChange={onDraftChange}
      />
    )
  }

  const time = new Date(parsed.time)
  const displayValue = point ? Number(point.value.toFixed(2)) : null

  return (
    <MetricReadView
      metric={parsed.metric}
      metricLabel={metricLabel}
      source={source}
      unit={unit}
      time={time}
      displayValue={displayValue}
      isLoading={pointQuery.isLoading}
    />
  )
}

const MetricEditView = ({
  metric,
  metricLabel,
  source,
  unit,
  draft,
  onDraftChange,
}: {
  metric: string
  metricLabel: string
  source: string
  unit: string
  draft: MetricDraft
  onDraftChange: (draft: MetricDraft) => void
}) => (
  <div class="entity-info">
    <div class="entity-meta">
      <span class="entity-type-badge">metric</span>
      <span class="entity-source">Source: {source}</span>
    </div>

    <h2>
      <a href={`/metric/${encodeURIComponent(metric)}`} class="entity-meta-link">
        {metricLabel}
      </a>
    </h2>

    <div class="entity-fields">
      <div class="field-row">
        <span class="field-label">Time</span>
        <span class="field-value">
          <input
            type="datetime-local"
            class="edit-datetime-input"
            value={draft.time}
            onInput={(e) => onDraftChange({ ...draft, time: (e.target as HTMLInputElement).value })}
          />
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Value</span>
        <span class="field-value">
          <input
            type="number"
            step="any"
            class="edit-value-input"
            value={draft.value}
            onInput={(e) => onDraftChange({ ...draft, value: (e.target as HTMLInputElement).value })}
          />
          {unit && <span class="edit-value-unit">{unit}</span>}
        </span>
      </div>
      <div class="field-row">
        <span class="field-label">Metric</span>
        <span class="field-value">{metric}</span>
      </div>
    </div>
  </div>
)

const formatValueDisplay = (displayValue: number | null, unit: string): string => {
  if (displayValue === null) return 'Not found'
  return `${displayValue}${unit ? ` ${unit}` : ''}`
}

const MetricReadView = ({
  metric,
  metricLabel,
  source,
  unit,
  time,
  displayValue,
  isLoading,
}: {
  metric: string
  metricLabel: string
  source: string
  unit: string
  time: Date
  displayValue: number | null
  isLoading: boolean
}) => (
  <div class="entity-info">
    <div class="entity-meta">
      <span class="entity-type-badge">metric</span>
      <span class="entity-source">Source: {source}</span>
    </div>

    <h2>
      <a href={`/metric/${encodeURIComponent(metric)}`} class="entity-meta-link">
        {metricLabel}
      </a>
    </h2>

    <div class="entity-fields">
      <div class="field-row">
        <span class="field-label">Time</span>
        <span class="field-value">{formatDateTime(time)}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Value</span>
        <span class="field-value">{isLoading ? 'Loading...' : formatValueDisplay(displayValue, unit)}</span>
      </div>
      <div class="field-row">
        <span class="field-label">Metric</span>
        <span class="field-value">{metric}</span>
      </div>
    </div>
  </div>
)
