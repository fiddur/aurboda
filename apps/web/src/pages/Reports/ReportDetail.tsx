import type { Confidence, ReportEntry, ReportFlag } from '@aurboda/api-spec'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useLocation, useRoute } from 'preact-iso'
import { useState } from 'preact/hooks'

import { ReferenceRangeBar } from '../../components/ReferenceRangeBar'
import { deleteReport, fetchReport } from '../../state/api'
import './ReportDetail.css'

const formatType = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

const formatValue = (value: number): string => {
  if (Number.isInteger(value)) return String(value)
  return value.toFixed(2)
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

function EntryRow({ entry }: { entry: ReportEntry }) {
  const flagInfo = entry.flag ? FLAG_DISPLAY[entry.flag] : undefined
  const confidenceInfo = entry.confidence ? CONFIDENCE_DISPLAY[entry.confidence] : undefined

  return (
    <div class="report-entry-row">
      <div class="report-entry-metric">
        <a href={`/metric/${encodeURIComponent(entry.metric)}`}>{formatMetricLabel(entry.metric)}</a>
      </div>
      <div class="report-entry-value">
        {formatValue(entry.value)} <span class="report-entry-unit">{entry.unit}</span>
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

function EntryCard({ entry }: { entry: ReportEntry }) {
  const flagInfo = entry.flag ? FLAG_DISPLAY[entry.flag] : undefined
  const confidenceInfo = entry.confidence ? CONFIDENCE_DISPLAY[entry.confidence] : undefined

  return (
    <div class="report-entry-card">
      <div class="report-entry-card-header">
        <a href={`/metric/${encodeURIComponent(entry.metric)}`} class="report-entry-card-metric">
          {formatMetricLabel(entry.metric)}
        </a>
        <span class="report-entry-card-value">
          {formatValue(entry.value)} {entry.unit}
        </span>
      </div>
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

  const { data: report, isLoading, error } = useQuery({
    queryFn: () => fetchReport(id),
    queryKey: ['report', id],
    staleTime: 5 * 60 * 1000,
  })

  const deleteMutation = useMutation({
    mutationFn: () => deleteReport(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports'] })
      route('/reports')
    },
  })

  if (isLoading) return <div class="report-detail-page"><p class="loading">Loading report...</p></div>
  if (error || !report) {
    return <div class="report-detail-page"><p class="error">Report not found</p></div>
  }

  return (
    <div class="report-detail-page">
      <div class="report-detail-nav">
        <a href="/reports">&larr; All Reports</a>
      </div>

      <header class="report-detail-header">
        <h1>{formatType(report.report_type)}</h1>
        <div class="report-detail-meta">
          <span class="report-detail-date">{format(report.date, 'yyyy-MM-dd HH:mm')}</span>
          {report.location && <span class="report-detail-location">{report.location}</span>}
        </div>
        {report.notes && <p class="report-detail-notes">{report.notes}</p>}
      </header>

      <section class="report-entries-section">
        <h2>{report.entries.length} {report.entries.length === 1 ? 'Entry' : 'Entries'}</h2>

        {/* Desktop table view */}
        <div class="report-entries-table">
          <div class="report-entries-table-header">
            <span>Metric</span>
            <span>Value</span>
            <span>Range</span>
            <span>Status</span>
          </div>
          {report.entries.map((entry) => (
            <EntryRow key={entry.id ?? entry.metric} entry={entry} />
          ))}
        </div>

        {/* Mobile card view */}
        <div class="report-entries-cards">
          {report.entries.map((entry) => (
            <EntryCard key={entry.id ?? entry.metric} entry={entry} />
          ))}
        </div>
      </section>

      <section class="report-detail-actions">
        {!confirmDelete ? (
          <button
            type="button"
            class="btn-danger"
            onClick={() => setConfirmDelete(true)}
          >
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
            <button
              type="button"
              class="btn-secondary"
              onClick={() => setConfirmDelete(false)}
            >
              Cancel
            </button>
          </div>
        )}
      </section>
    </div>
  )
}
