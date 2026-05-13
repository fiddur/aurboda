import type { ProviderSyncStatus, StravaQueueStatusType } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import {
  disconnectStrava,
  fetchStravaSyncStatus,
  fetchUserSettings,
  getStravaConnectUrl,
  syncStrava,
} from '../../state/api'
import { auth } from '../../state/auth'
import { type DataTypeItem, DataTypesList, LoginRequired, StatusBanner, SyncStatusBar } from './shared'
import './style.css'

const DATA_TYPES: DataTypeItem[] = [
  { label: 'Activities (running, cycling, swimming, etc.)' },
  { label: 'Heart rate (per-second during activities)' },
  { label: 'GPS routes and elevation' },
  { label: 'Cadence and power data' },
  { label: 'Suffer score and activity stats' },
]

function StravaConnection({
  isConnected,
  isConfigured,
  queue,
  syncStates,
  syncStatusLoading,
}: {
  isConnected: boolean
  isConfigured: boolean
  queue: StravaQueueStatusType | undefined
  syncStates: ProviderSyncStatus[] | undefined
  syncStatusLoading: boolean
}) {
  const queryClient = useQueryClient()

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [disconnecting, setDisconnecting] = useState(false)

  const isSyncing = syncStates?.some((s) => s.status === 'syncing') ?? false

  const prevSyncingRef = useRef(false)
  useEffect(() => {
    if (prevSyncingRef.current && !isSyncing && syncStatus === 'syncing') {
      const hasError = syncStates?.some((s) => s.status === 'error')
      setSyncStatus(hasError ? 'error' : 'done')
      setSyncMessage(hasError ? 'Sync completed with errors' : 'Sync complete')
      queryClient.invalidateQueries()
    }
    prevSyncingRef.current = isSyncing
  }, [isSyncing, syncStatus, syncStates, queryClient])

  const handleConnectStrava = useCallback(async () => {
    try {
      const url = await getStravaConnectUrl()
      window.location.href = url
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err instanceof Error ? err.message : 'Failed to start Strava connection')
    }
  }, [])

  const handleSync = useCallback(
    async (fullResync: boolean) => {
      setSyncStatus('syncing')
      setSyncMessage('')
      try {
        await syncStrava(fullResync)
        await queryClient.invalidateQueries({ queryKey: ['stravaSyncStatus'] })
      } catch (err) {
        setSyncStatus('error')
        setSyncMessage(err instanceof Error ? err.message : 'Sync failed')
      }
    },
    [queryClient],
  )

  const handleSyncNow = useCallback(() => handleSync(false), [handleSync])
  const handleFullResync = useCallback(() => handleSync(true), [handleSync])

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await disconnectStrava()
      await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    } catch {
      // Silently handle
    } finally {
      setDisconnecting(false)
    }
  }, [queryClient])

  return (
    <>
      <StatusBanner
        connected={isConnected}
        label={isConnected ? 'Strava is connected' : 'Strava not connected'}
      />

      {isConnected && (
        <SyncStatusBar states={syncStates} isLoading={syncStatusLoading} onSyncNow={handleSyncNow} />
      )}

      {isConnected && queue && (queue.queued_count > 0 || queue.active_count > 0) && (
        <p class="garmin-sync-message">
          Queue: {queue.queued_count} pending, {queue.active_count} active
        </p>
      )}

      <section class="settings-section">
        <h2>Connection</h2>

        {isConnected ? (
          <div class="garmin-connected-actions">
            <p class="connected-status">Connected</p>
            <div class="garmin-button-row">
              <button
                type="button"
                class="connect-button"
                disabled={syncStatus === 'syncing'}
                onClick={handleFullResync}
              >
                {syncStatus === 'syncing' ? 'Syncing...' : 'Full Re-sync'}
              </button>
              <button
                type="button"
                class="connect-button disconnect-button"
                disabled={disconnecting}
                onClick={handleDisconnect}
              >
                {disconnecting ? 'Disconnecting...' : 'Disconnect'}
              </button>
            </div>
            {syncMessage && <p class={`garmin-sync-message ${syncStatus}`}>{syncMessage}</p>}
          </div>
        ) : !isConfigured ? (
          <>
            <button type="button" class="connect-button" disabled>
              Connect Strava
            </button>
            <p class="field-description warning">
              Strava OAuth is not configured on the server. Ask your administrator to set strava_client_id and
              strava_client_secret in server settings.
            </p>
          </>
        ) : (
          <>
            <button type="button" class="connect-button" onClick={handleConnectStrava}>
              Connect Strava
            </button>
            <p class="field-description">
              Click to authorize Aurboda to access your Strava data. You will be redirected to Strava to grant
              permission.
            </p>
          </>
        )}
      </section>
    </>
  )
}

export function StravaSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const isConnected = userSettings?.strava_connected ?? false
  const isConfigured = userSettings?.strava_configured ?? false

  const shouldPoll = isConnected

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && isConnected,
    queryFn: fetchStravaSyncStatus,
    queryKey: ['stravaSyncStatus'],
    refetchInterval: shouldPoll ? 5000 : false,
  })

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Strava</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://www.strava.com/" target="_blank" rel="noopener noreferrer">
            Strava
          </a>{' '}
          tracks running, cycling, swimming, and many other activities. Aurboda syncs your full activity
          history including per-second heart rate, GPS routes, and detailed metrics. New activities are synced
          automatically via webhooks.
        </p>

        <DataTypesList types={DATA_TYPES} />

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <StravaConnection
            isConnected={isConnected}
            isConfigured={isConfigured}
            queue={syncStatusData?.queue}
            syncStates={syncStatusData?.states}
            syncStatusLoading={syncStatusLoading}
          />
        )}
      </div>
    </div>
  )
}
