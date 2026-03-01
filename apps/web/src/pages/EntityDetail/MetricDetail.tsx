/**
 * Metric data point detail view.
 */
import { metricUnits as builtinMetricUnits } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import {
  fetchCustomMetrics,
  fetchMetricTimeSeriesWithSource,
  type MetricDataPointWithSource,
} from '../../state/api'
import { formatDateTime } from './format-utils'

/** Parse a metric entity ID (format: "iso_time|metric_name|source"). */
export const parseMetricEntityId = (
  entityId: string,
): { time: string; metric: string; source: string } | null => {
  const parts = entityId.split('|')
  if (parts.length !== 3) return null
  const [time, metric, source] = parts
  if (!time || !metric || !source) return null
  const d = new Date(time)
  if (isNaN(d.getTime())) return null
  return { metric, source, time }
}

/** Map metric name to human-readable display label. */
const formatMetricLabel = (metric: string): string =>
  metric.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())

export const MetricDetail = ({ entityId }: { entityId: string }) => {
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

  if (!parsed) {
    return <p class="error">Invalid metric reference</p>
  }

  const metricLabel = formatMetricLabel(parsed.metric)
  const customUnit = customMetricsQuery.data?.find((m) => m.name === parsed.metric)?.unit
  const unit = customUnit ?? (builtinMetricUnits as Record<string, string>)[parsed.metric] ?? ''
  const point = pointQuery.data
  const time = new Date(parsed.time)
  const displayValue = point ? Number(point.value.toFixed(2)) : null

  return (
    <div class="entity-info">
      <div class="entity-meta">
        <span class="entity-type-badge">metric</span>
        <span class="entity-source">Source: {parsed.source}</span>
      </div>

      <h2>{metricLabel}</h2>

      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Time</span>
          <span class="field-value">{formatDateTime(time)}</span>
        </div>
        <div class="field-row">
          <span class="field-label">Value</span>
          <span class="field-value">
            {pointQuery.isLoading ?
              'Loading...'
            : displayValue !== null ?
              `${displayValue}${unit ? ` ${unit}` : ''}`
            : 'Not found'}
          </span>
        </div>
        <div class="field-row">
          <span class="field-label">Metric</span>
          <span class="field-value">{parsed.metric}</span>
        </div>
      </div>
    </div>
  )
}
