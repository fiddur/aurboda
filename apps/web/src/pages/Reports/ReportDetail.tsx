import type { Confidence, ReportEntry, ReportFlag } from '@aurboda/api-spec'

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useMemo, useState } from 'preact/hooks'

import { ReferenceRangeBar } from '../../components/ReferenceRangeBar'
import { SparklineChart } from '../../components/SparklineChart'
import { deleteReport, fetchReport, fetchReports, type Report } from '../../state/api'
import { NotesSection } from '../EntityDetail/NotesSection'
import './ReportDetail.css'

const formatType = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

const formatValue = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
}

const formatDelta = (delta: number): string => {
  const prefix = delta > 0 ? '+' : ''
  if (Number.isInteger(delta)) return `${prefix}${delta}`
  return `${prefix}${delta.toFixed(2)}`
}

const FLAG_DISPLAY: Record<ReportFlag, { label: string; className: string }> = {
  critical_high: { className: 'flag-critical', label: 'Critical High' },
  critical_low: { className: 'flag-critical', label: 'Critical Low' },
  high: { className: 'flag-warning', label: 'High' },
  low: { className: 'flag-warning', label: 'Low' },
  normal: { className: 'flag-normal', label: 'Normal' },
}

const CONFIDENCE_DISPLAY: Record<Confidence, { label: string; className: string }> = {
  derived: { className: 'confidence-derived', label: 'Derived' },
  estimated: { className: 'confidence-estimated', label: 'Estimated' },
  measured: { className: 'confidence-measured', label: 'Measured' },
}

function formatMetricLabel(metric: string): string {
  return metric.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())
}

interface ComparisonData {
  delta: number
  previous_value: number
}

/** Build comparison data and sparkline histories from all reports of the same type. */
function useReportComparison(report: Report | undefined, allReports: Report[] | undefined) {
  return useMemo(() => {
    if (!report || !allReports || allReports.length < 2) {
      return {
        comparisons: new Map<string, ComparisonData>(),
        sparklines: new Map<string, [Date, number][]>(),
      }
    }

    // Sort by date ascending
    const sorted = [...allReports].sort((a, b) => a.date.getTime() - b.date.getTime())

    // Find the previous report (the one before the current)
    const currentIdx = sorted.findIndex((r) => r.id === report.id)
    const previous = currentIdx > 0 ? sorted[currentIdx - 1] : undefined

    // Build comparison map: metric -> { delta, previous_value }
    const comparisons = new Map<string, ComparisonData>()
    if (previous) {
      const prevEntries = new Map(previous.entries.map((e) => [e.metric, e]))
      for (const entry of report.entries) {
        const prev = prevEntries.get(entry.metric)
        if (prev && prev.value != null && entry.value != null) {
          comparisons.set(entry.metric, {
            delta: entry.value - prev.value,
            previous_value: prev.value,
          })
        }
      }
    }

    // Build sparkline data: metric -> [Date, number][] from all reports
    const sparklines = new Map<string, [Date, number][]>()
    for (const r of sorted) {
      for (const entry of r.entries) {
        if (entry.value == null) continue
        const existing = sparklines.get(entry.metric) ?? []
        existing.push([r.date, entry.value])
        sparklines.set(entry.metric, existing)
      }
    }

    return { comparisons, sparklines }
  }, [report, allReports])
}

function DeltaIndicator({ delta, unit }: { delta: number; unit: string }) {
  const arrow = delta > 0 ? '\u2191' : delta < 0 ? '\u2193' : ''
  const className = delta > 0 ? 'delta-up' : delta < 0 ? 'delta-down' : 'delta-neutral'

  return (
    <span class={`report-entry-delta ${className}`} title={`Change: ${formatDelta(delta)} ${unit}`}>
      {formatDelta(delta)} {arrow}
    </span>
  )
}

function EntryRow({
  entry,
  comparison,
  sparklineData,
}: {
  entry: ReportEntry
  comparison?: ComparisonData
  sparklineData?: [Date, number][]
}) {
  const flagInfo = entry.flag ? FLAG_DISPLAY[entry.flag] : undefined
  const confidenceInfo = entry.confidence ? CONFIDENCE_DISPLAY[entry.confidence] : undefined

  return (
    <div class="report-entry-row">
      <div class="report-entry-metric">
        <a href={`/metric/${encodeURIComponent(entry.metric)}`}>{formatMetricLabel(entry.metric)}</a>
      </div>
      <div class="report-entry-value">
        <span>
          {formatValue(entry.value)} <span class="report-entry-unit">{entry.unit}</span>
        </span>
        {comparison && <DeltaIndicator delta={comparison.delta} unit={entry.unit} />}
      </div>
      <div class="report-entry-sparkline">
        {sparklineData && sparklineData.length >= 2 && (
          <SparklineChart data={sparklineData} color="#673ab8" width={80} height={24} />
        )}
      </div>
      <div class="report-entry-range">
        <ReferenceRangeBar
          value={entry.value}
          reference_low={entry.reference_low}
          reference_high={entry.reference_high}
          flag={entry.flag}
        />
      </div>
      <div class="report-entry-badges">
        {flagInfo && <span class={`report-flag-badge ${flagInfo.className}`}>{flagInfo.label}</span>}
        {confidenceInfo && (
          <span class={`report-confidence-badge ${confidenceInfo.className}`}>{confidenceInfo.label}</span>
        )}
        {entry.method && <span class="report-method-badge">{entry.method}</span>}
      </div>
    </div>
  )
}

function EntryCard({
  entry,
  comparison,
  sparklineData,
}: {
  entry: ReportEntry
  comparison?: ComparisonData
  sparklineData?: [Date, number][]
}) {
  const flagInfo = entry.flag ? FLAG_DISPLAY[entry.flag] : undefined
  const confidenceInfo = entry.confidence ? CONFIDENCE_DISPLAY[entry.confidence] : undefined

  return (
    <div class="report-entry-card">
      <div class="report-entry-card-header">
        <a href={`/metric/${encodeURIComponent(entry.metric)}`} class="report-entry-card-metric">
          {formatMetricLabel(entry.metric)}
        </a>
        <div class="report-entry-card-value-group">
          <span class="report-entry-card-value">
            {formatValue(entry.value)} {entry.unit}
          </span>
          {comparison && <DeltaIndicator delta={comparison.delta} unit={entry.unit} />}
        </div>
      </div>
      {sparklineData && sparklineData.length >= 2 && (
        <div class="report-entry-card-sparkline">
          <SparklineChart data={sparklineData} color="#673ab8" width={120} height={28} />
        </div>
      )}
      <ReferenceRangeBar
        value={entry.value}
        reference_low={entry.reference_low}
        reference_high={entry.reference_high}
        flag={entry.flag}
      />
      <div class="report-entry-card-badges">
        {flagInfo && <span class={`report-flag-badge ${flagInfo.className}`}>{flagInfo.label}</span>}
        {confidenceInfo && (
          <span class={`report-confidence-badge ${confidenceInfo.className}`}>{confidenceInfo.label}</span>
        )}
        {entry.method && <span class="report-method-badge">{entry.method}</span>}
      </div>
    </div>
  )
}

export function ReportDetail() {
  const { params } = useRoute()
  const { route } = useLocation()
  const queryClient = useQueryClient()
  const id = params.id as string
  const [confirmDelete, setConfirmDelete] = useState(false)

  const {
    data: report,
    isLoading,
    error,
  } = useQuery({
    queryFn: () => fetchReport(id),
    queryKey: ['report', id],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch all reports of the same type for comparison
  const { data: allReports } = useQuery({
    enabled: !!report,
    queryFn: () => fetchReports({ report_type: report!.report_type }),
    queryKey: ['reports', report?.report_type],
    staleTime: 5 * 60 * 1000,
  })

  const { comparisons, sparklines } = useReportComparison(report, allReports)

  const deleteMutation = useMutation({
    mutationFn: () => deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      route('/reports')
    },
  })

  if (isLoading) {
    return (
      <div class="report-detail-page">
        <p class="loading">Loading report...</p>
      </div>
    )
  }
  if (error || !report) {
    return (
      <div class="report-detail-page">
        <p class="error">Report not found</p>
      </div>
    )
  }

  const hasPrevious = comparisons.size > 0

  return (
    <div class="report-detail-page">
      <div class="report-detail-nav">
        <a href="/reports">&larr; All Reports</a>
      </div>

      <div class="report-detail-header">
        <h1>{formatType(report.report_type)}</h1>
        <div class="report-detail-meta">
          <span class="report-detail-date">{format(report.date, 'yyyy-MM-dd HH:mm')}</span>
          {report.location && <span class="report-detail-location">{report.location}</span>}
        </div>
        {report.notes && <p class="report-detail-notes">{report.notes}</p>}
      </div>

      <section class="report-entries-section">
        <h2>
          {report.entries.length} {report.entries.length === 1 ? 'Entry' : 'Entries'}
        </h2>

        {/* Desktop table view */}
        <div class="report-entries-table">
          <div class={`report-entries-table-header ${hasPrevious ? 'with-comparison' : ''}`}>
            <span>Metric</span>
            <span>Value</span>
            {hasPrevious && <span>Trend</span>}
            <span>Range</span>
            <span>Status</span>
          </div>
          {report.entries.map((entry) => (
            <EntryRow
              key={entry.id ?? entry.metric}
              entry={entry}
              comparison={comparisons.get(entry.metric)}
              sparklineData={sparklines.get(entry.metric)}
            />
          ))}
        </div>

        {/* Mobile card view */}
        <div class="report-entries-cards">
          {report.entries.map((entry) => (
            <EntryCard
              key={entry.id ?? entry.metric}
              entry={entry}
              comparison={comparisons.get(entry.metric)}
              sparklineData={sparklines.get(entry.metric)}
            />
          ))}
        </div>
      </section>

      <NotesSection entityType="report" entityId={id} />

      <section class="report-detail-actions">
        {!confirmDelete ? (
          <button type="button" class="btn-danger" onClick={() => setConfirmDelete(true)}>
            Delete Report
          </button>
        ) : (
          <div class="report-delete-confirm">
            <span>Delete this report and its metric data?</span>
            <button
              type="button"
              class="btn-danger"
              onClick={() => deleteMutation.mutate()}
              disabled={deleteMutation.isPending}
            >
              {deleteMutation.isPending ? 'Deleting...' : 'Confirm Delete'}
            </button>
            <button type="button" class="btn-secondary" onClick={() => setConfirmDelete(false)}>
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
