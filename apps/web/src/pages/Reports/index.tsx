import type { ReportFlag } from '@aurboda/api-spec'
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'
import { useState } from 'preact/hooks'

import { fetchReports, type Report } from '../../state/api'
import './style.css'

const formatType = (type: string): string =>
  type.replaceAll('_', ' ').replaceAll(/\b\w/g, (c) => c.toUpperCase())

const FLAG_LABELS: Record<ReportFlag, string> = {
  critical_high: 'Critical High',
  critical_low: 'Critical Low',
  high: 'High',
  low: 'Low',
  normal: 'Normal',
}

function flagSummary(report: Report): string {
  const nonNormal = report.entries.filter((e) => e.flag && e.flag !== 'normal')
  if (nonNormal.length === 0) return ''

  const counts = new Map<ReportFlag, number>()
  for (const entry of nonNormal) {
    counts.set(entry.flag!, (counts.get(entry.flag!) ?? 0) + 1)
  }

  return [...counts.entries()].map(([flag, count]) => `${count} ${FLAG_LABELS[flag]}`).join(', ')
}

function flagBadgeClass(report: Report): string {
  const flags = report.entries.map((e) => e.flag).filter(Boolean) as ReportFlag[]
  if (flags.some((f) => f === 'critical_low' || f === 'critical_high')) return 'report-flag-critical'
  if (flags.some((f) => f === 'low' || f === 'high')) return 'report-flag-warning'
  return ''
}

export function Reports() {
  const [filterType, setFilterType] = useState('')

  const { data: reports, isLoading } = useQuery({
    queryFn: () => fetchReports(filterType ? { report_type: filterType } : undefined),
    queryKey: ['reports', filterType],
    staleTime: 5 * 60 * 1000,
  })

  // Get unique report types for filter dropdown
  const { data: allReports } = useQuery({
    queryFn: () => fetchReports(),
    queryKey: ['reports', ''],
    staleTime: 5 * 60 * 1000,
  })

  const reportTypes = [...new Set((allReports ?? []).map((r) => r.report_type))].sort()

  // Sort newest first
  const sorted = [...(reports ?? [])].sort((a, b) => b.date.getTime() - a.date.getTime())

  return (
    <div class="reports-page">
      <div class="reports-header">
        <h1>Lab Reports</h1>
        <a href="/reports/add" class="btn-primary">
          + Add Report
        </a>
      </div>

      {reportTypes.length > 0 && (
        <div class="reports-filter">
          <select value={filterType} onChange={(e) => setFilterType((e.target as HTMLSelectElement).value)}>
            <option value="">All types</option>
            {reportTypes.map((type) => (
              <option key={type} value={type}>
                {formatType(type)}
              </option>
            ))}
          </select>
        </div>
      )}

      {isLoading && <p class="loading">Loading reports...</p>}

      {!isLoading && sorted.length === 0 && (
        <div class="reports-empty">
          <p>No lab reports yet.</p>
          <p>
            <a href="/reports/add">Add your first report</a>
          </p>
        </div>
      )}

      <div class="reports-list">
        {sorted.map((report) => {
          const summary = flagSummary(report)
          const badgeClass = flagBadgeClass(report)
          return (
            <a key={report.id} href={`/reports/${report.id}`} class="report-card">
              <div class="report-card-header">
                <span class="report-card-type">{formatType(report.report_type)}</span>
                <span class="report-card-date">{format(report.date, 'yyyy-MM-dd')}</span>
              </div>
              <div class="report-card-meta">
                {report.location && <span class="report-card-location">{report.location}</span>}
                <span class="report-card-entries">
                  {report.entries.length} {report.entries.length === 1 ? 'entry' : 'entries'}
                </span>
              </div>
              {summary && <div class={`report-card-flags ${badgeClass}`}>{summary}</div>}
            </a>
          )
        })}
      </div>
    </div>
  )
}
