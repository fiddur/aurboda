/**
 * Shared components for data source pages — save status indicators, status banners, etc.
 */
import type { ProviderSyncStatus } from '@aurboda/api-spec'

import { useCallback, useState } from 'preact/hooks'

export { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'

export function StatusBanner({ connected, label }: { connected: boolean; label: string }) {
  return (
    <div class={`status-banner ${connected ? 'connected' : 'not-connected'}`}>
      <span class={`status-dot ${connected ? 'connected' : 'not-connected'}`} />
      {label}
    </div>
  )
}

export interface DataTypeItem {
  label: string
  href?: string
}

export function DataTypesList({ types }: { types: (string | DataTypeItem)[] }) {
  return (
    <div class="data-types-section">
      <h2>Data provided</h2>
      <div class="data-types-list">
        {types.map((dt) => {
          const item = typeof dt === 'string' ? { label: dt } : dt
          return item.href ? (
            <a key={item.label} class="data-type-badge data-type-link" href={item.href}>
              {item.label}
            </a>
          ) : (
            <span key={item.label} class="data-type-badge">
              {item.label}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function LoginRequired() {
  return (
    <div class="data-sources-page">
      <p>Please log in to view data source settings.</p>
    </div>
  )
}

const formatSyncTime = (iso: string): string => {
  const date = new Date(iso)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)

  if (diffMin < 1) return 'just now'
  if (diffMin < 60) return `${diffMin} min ago`

  const diffHours = Math.floor(diffMin / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

/** Shows the most recent sync time across all data types, with a "Sync Now" button. */
export function SyncStatusBar({
  states,
  isLoading,
  onSyncNow,
}: {
  states: ProviderSyncStatus[] | undefined
  isLoading: boolean
  onSyncNow: () => Promise<void>
}) {
  const [syncing, setSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ status: 'done' | 'error'; message: string } | null>(null)

  const handleSync = useCallback(async () => {
    setSyncing(true)
    setSyncResult(null)
    try {
      await onSyncNow()
      setSyncResult({ status: 'done', message: 'Sync complete' })
    } catch (err) {
      setSyncResult({ status: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setSyncing(false)
    }
  }, [onSyncNow])

  if (isLoading) return null

  const lastSync = states
    ?.filter((s) => s.last_sync_time)
    .sort((a, b) => new Date(b.last_sync_time!).getTime() - new Date(a.last_sync_time!).getTime())[0]

  const hasError = states?.some((s) => s.status === 'error')
  const warnings = states?.filter((s) => s.error_message && s.status !== 'error') ?? []

  return (
    <div class="sync-status-bar">
      <span class="sync-status-time">
        {lastSync?.last_sync_time ? `Last synced ${formatSyncTime(lastSync.last_sync_time)}` : 'Never synced'}
        {hasError && <span class="sync-status-error"> (some data types have errors)</span>}
        {!hasError && warnings.length > 0 && (
          <span class="sync-status-warning"> ({warnings.length} data type(s) had partial failures)</span>
        )}
      </span>
      <button type="button" class="sync-now-button" disabled={syncing} onClick={handleSync}>
        {syncing && <span class="sync-spinner" />}
        {syncing ? 'Syncing...' : 'Sync Now'}
      </button>
      {syncResult && <span class={`sync-result ${syncResult.status}`}>{syncResult.message}</span>}
    </div>
  )
}
