import type { AuditLogEntry } from '@aurboda/api-spec'

import { useQuery } from '@tanstack/react-query'
import { useState } from 'preact/hooks'

import { fetchAuditLog } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const LEVEL_ICONS: Record<string, string> = {
  error: '❌',
  info: 'ℹ️',
  warn: '⚠️',
}

const PAGE_SIZE = 50

export function AuditLog() {
  const isLoggedIn = auth.value.token
  const [levelFilter, setLevelFilter] = useState<string>('')
  const [categoryFilter, setCategoryFilter] = useState<string>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(0)

  const { data, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () =>
      fetchAuditLog({
        category: categoryFilter || undefined,
        level: levelFilter || undefined,
        limit: PAGE_SIZE,
        offset: page * PAGE_SIZE,
      }),
    queryKey: ['auditLog', levelFilter, categoryFilter, page],
    refetchInterval: 30000,
  })

  const entries = data?.data ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const toggleExpand = (id: string) => {
    setExpandedId(expandedId === id ? null : id)
  }

  const formatTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleString(undefined, {
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      month: 'short',
      second: '2-digit',
    })
  }

  return (
    <div class="audit-log-page">
      <h1>Audit Log</h1>

      <div class="audit-log-filters">
        <select
          value={levelFilter}
          onChange={(e) => {
            setLevelFilter((e.target as HTMLSelectElement).value)
            setPage(0)
          }}
        >
          <option value="">All levels</option>
          <option value="info">Info</option>
          <option value="warn">Warning</option>
          <option value="error">Error</option>
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => {
            setCategoryFilter((e.target as HTMLSelectElement).value)
            setPage(0)
          }}
        >
          <option value="">All categories</option>
          <option value="sync">Sync</option>
          <option value="auth">Auth</option>
          <option value="settings">Settings</option>
          <option value="data">Data</option>
          <option value="system">System</option>
        </select>
        <span class="audit-log-count">{total} entries</span>
      </div>

      {isLoading && <p class="loading">Loading...</p>}

      {!isLoading && entries.length === 0 && <p class="empty">No log entries found.</p>}

      <div class="audit-log-list">
        {entries.map((entry: AuditLogEntry) => (
          <div
            key={entry.id}
            class={`audit-log-entry level-${entry.level}${expandedId === entry.id ? ' expanded' : ''}`}
            onClick={() => toggleExpand(entry.id)}
          >
            <div class="audit-log-row">
              <span class="audit-log-icon">{LEVEL_ICONS[entry.level] ?? ''}</span>
              <span class="audit-log-time">{formatTime(entry.timestamp)}</span>
              <span class="audit-log-category">{entry.category}</span>
              <span class="audit-log-message">{entry.message}</span>
            </div>
            {expandedId === entry.id && entry.details && (
              <pre class="audit-log-details">{JSON.stringify(entry.details, null, 2)}</pre>
            )}
          </div>
        ))}
      </div>

      {totalPages > 1 && (
        <div class="audit-log-pagination">
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button disabled={page >= totalPages - 1} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      )}
    </div>
  )
}
