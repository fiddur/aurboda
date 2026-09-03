/**
 * Shared components for data source pages — save status indicators, status banners, etc.
 */
import type { ProviderSyncStatus, SyncIntervals } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useState } from 'preact/hooks'

import { type SaveStatus, SaveStatusIndicator } from '../../components/SaveStatusIndicator'
import { fetchUserSettings, updateUserSettings } from '../../state/api'

export { type SaveStatus, SaveStatusIndicator }

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

function SyncStatusText({
  syncing,
  lastSyncTime,
  hasError,
  warningCount,
}: {
  syncing: boolean
  lastSyncTime?: string | null
  hasError: boolean
  warningCount: number
}) {
  if (syncing) return <span class="sync-status-time">Syncing...</span>

  const timeText = lastSyncTime ? `Last synced ${formatSyncTime(lastSyncTime)}` : 'Never synced'

  return (
    <span class="sync-status-time">
      {timeText}
      {hasError && <span class="sync-status-error"> (some data types have errors)</span>}
      {!hasError && warningCount > 0 && (
        <span class="sync-status-warning"> ({warningCount} data type(s) had partial failures)</span>
      )}
    </span>
  )
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
  const [localSyncing, setLocalSyncing] = useState(false)
  const [syncResult, setSyncResult] = useState<{ status: 'done' | 'error'; message: string } | null>(null)

  // Detect syncing from backend status (e.g. navigated to page while sync in progress)
  const backendSyncing = states?.some((s) => s.status === 'syncing') ?? false
  const syncing = localSyncing || backendSyncing

  const handleSync = useCallback(async () => {
    setLocalSyncing(true)
    setSyncResult(null)
    try {
      await onSyncNow()
    } catch (err) {
      setSyncResult({ status: 'error', message: err instanceof Error ? err.message : 'Sync failed' })
    } finally {
      setLocalSyncing(false)
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
      <SyncStatusText
        syncing={syncing}
        lastSyncTime={lastSync?.last_sync_time}
        hasError={hasError ?? false}
        warningCount={warnings.length}
      />
      <button type="button" class="sync-now-button" disabled={syncing} onClick={handleSync}>
        {syncing && <span class="sync-spinner" />}
        {syncing ? 'Syncing...' : 'Sync Now'}
      </button>
      {syncResult && <span class={`sync-result ${syncResult.status}`}>{syncResult.message}</span>}
    </div>
  )
}

/** Server fallback when neither the provider nor `default` has an entry (mirrors the backend). */
export const DEFAULT_SYNC_INTERVAL_MINUTES = 30
const MIN_SYNC_INTERVAL_MINUTES = 5
const MAX_SYNC_INTERVAL_MINUTES = 1440

export type SyncIntervalProvider =
  | 'calendar'
  | 'default'
  | 'garmin'
  | 'gravl'
  | 'lastfm'
  | 'oura'
  | 'rescuetime'

/**
 * Background poll interval for one pull-based provider (#1042). Empty means
 * "use the default": the user's `default` entry, else the server's 30 minutes.
 * Saves on blur; the same setting drives both the scheduler and the
 * before-query auto-sync.
 */
export function SyncIntervalField({ provider }: { provider: SyncIntervalProvider }) {
  const queryClient = useQueryClient()
  const { data: userSettings } = useQuery({ queryFn: fetchUserSettings, queryKey: ['userSettings'] })
  const intervals: SyncIntervals = userSettings?.sync_intervals ?? {}
  const configured = intervals[provider]
  const fallback =
    provider === 'default'
      ? DEFAULT_SYNC_INTERVAL_MINUTES
      : (intervals.default ?? DEFAULT_SYNC_INTERVAL_MINUTES)

  const [value, setValue] = useState(configured === undefined ? '' : String(configured))
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  useEffect(() => {
    setValue(configured === undefined ? '' : String(configured))
  }, [configured])

  const save = useCallback(async () => {
    const trimmed = value.trim()
    const next: SyncIntervals = { ...intervals }
    if (trimmed === '') {
      delete next[provider]
    } else {
      const minutes = Number(trimmed)
      if (
        !Number.isInteger(minutes) ||
        minutes < MIN_SYNC_INTERVAL_MINUTES ||
        minutes > MAX_SYNC_INTERVAL_MINUTES
      ) {
        setSaveStatus({
          error: `Enter a whole number of minutes between ${MIN_SYNC_INTERVAL_MINUTES} and ${MAX_SYNC_INTERVAL_MINUTES}`,
          status: 'error',
        })
        return
      }
      next[provider] = minutes
    }
    if (next[provider] === configured) return
    setSaveStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ sync_intervals: next })
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved' })
    } catch (err) {
      setSaveStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' })
    }
  }, [configured, intervals, provider, queryClient, value])

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>{provider === 'default' ? 'Default background sync interval' : 'Background sync interval'}</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <div class="form-field">
        <input
          type="number"
          min={MIN_SYNC_INTERVAL_MINUTES}
          max={MAX_SYNC_INTERVAL_MINUTES}
          step={1}
          value={value}
          onInput={(e) => setValue((e.target as HTMLInputElement).value)}
          onBlur={save}
          placeholder={`${fallback} (default)`}
        />
        <p class="field-description">
          Minutes between background polls
          {provider === 'default'
            ? ' for every pull-based source without its own interval.'
            : `. Leave empty to use the default (${fallback} min).`}{' '}
          Saves automatically when you leave the field.
        </p>
      </div>
    </section>
  )
}
