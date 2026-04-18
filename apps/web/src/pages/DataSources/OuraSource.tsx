import type { ProviderSyncStatus, UserSettingsResponse } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'

import { fetchOuraSyncStatus, fetchUserSettings, getOuraConnectUrl, syncOura } from '../../state/api'
import { auth } from '../../state/auth'
import { type DataTypeItem, DataTypesList, LoginRequired, StatusBanner, SyncStatusBar } from './shared'
import './style.css'

const DATA_TYPES: DataTypeItem[] = [
  { label: 'Sleep (duration, stages, scores)', href: '/sleep' },
  { label: 'Readiness score', href: '/metric/readiness_score' },
  { label: 'Resilience', href: '/metric/resilience_score' },
  { label: 'HRV (resting)', href: '/metric/hrv_rmssd' },
  { label: 'Cardiovascular age', href: '/metric/cardiovascular_age' },
  { label: 'Resting heart rate', href: '/metric/resting_heart_rate' },
  { label: 'Meditation / breathing sessions' },
  { label: 'Oura tags (mood, symptoms, etc.)' },
]

function OuraConnection({
  userSettings,
  syncStates,
  syncStatusLoading,
}: {
  userSettings: UserSettingsResponse
  syncStates: ProviderSyncStatus[] | undefined
  syncStatusLoading: boolean
}) {
  const queryClient = useQueryClient()
  const isOuraConnected = userSettings.oura_connected ?? false

  const [ouraSyncStatus, setOuraSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [ouraSyncMessage, setOuraSyncMessage] = useState<string>('')

  const handleConnectOura = useCallback(async () => {
    try {
      const url = await getOuraConnectUrl()
      window.location.href = url
    } catch (err) {
      setOuraSyncStatus('error')
      setOuraSyncMessage(err instanceof Error ? err.message : 'Failed to start Oura connection')
    }
  }, [])

  const handleSyncNow = useCallback(async () => {
    await syncOura(false)
    await queryClient.invalidateQueries({ queryKey: ['ouraSyncStatus'] })
  }, [queryClient])

  const handleOuraFullResync = useCallback(async () => {
    setOuraSyncStatus('syncing')
    setOuraSyncMessage('')
    try {
      const response = await syncOura(true)
      const totalRecords = (response.results ?? []).reduce((sum, r) => sum + (r.records_processed ?? 0), 0)
      setOuraSyncStatus('done')
      setOuraSyncMessage(`Synced ${totalRecords} records`)
      await queryClient.invalidateQueries()
    } catch (err) {
      setOuraSyncStatus('error')
      setOuraSyncMessage(err instanceof Error ? err.message : 'Sync failed')
    }
  }, [queryClient])

  return (
    <>
      <StatusBanner
        connected={isOuraConnected}
        label={isOuraConnected ? 'Oura Ring is connected' : 'Oura Ring not connected'}
      />

      {isOuraConnected && (
        <SyncStatusBar states={syncStates} isLoading={syncStatusLoading} onSyncNow={handleSyncNow} />
      )}

      <section class="settings-section">
        <h2>Connection</h2>

        {isOuraConnected ? (
          <div class="oura-connected-row">
            <p class="connected-status">Connected</p>
            <button
              type="button"
              class="connect-button oura-resync-button"
              disabled={ouraSyncStatus === 'syncing'}
              onClick={handleOuraFullResync}
            >
              {ouraSyncStatus === 'syncing' ? 'Syncing...' : 'Full Re-sync'}
            </button>
            {ouraSyncMessage && <span class={`oura-sync-message ${ouraSyncStatus}`}>{ouraSyncMessage}</span>}
          </div>
        ) : userSettings.oura_configured === false ? (
          <>
            <button type="button" class="connect-button" disabled>
              Connect Oura
            </button>
            <p class="field-description warning">
              Oura OAuth is not configured on the server. Ask your administrator to set up OURA_CLIENT and
              OURA_SECRET environment variables.
            </p>
          </>
        ) : (
          <>
            <button type="button" class="connect-button" onClick={handleConnectOura}>
              Connect Oura
            </button>
            <p class="field-description">
              Click to authorize Aurboda to access your Oura data. You will be redirected to Oura to grant
              permission.
            </p>
          </>
        )}
      </section>
    </>
  )
}

export function OuraSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const isOuraConnected = userSettings?.oura_connected ?? false

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && isOuraConnected,
    queryFn: fetchOuraSyncStatus,
    queryKey: ['ouraSyncStatus'],
  })

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Oura Ring</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          The{' '}
          <a href="https://ouraring.com/" target="_blank" rel="noopener noreferrer">
            Oura Ring
          </a>{' '}
          provides detailed sleep analysis, readiness scores, and HRV data. Aurboda syncs data automatically
          via the Oura Cloud API and receives real-time updates via webhooks.
        </p>

        <DataTypesList types={DATA_TYPES} />

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/oura.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            Oura integration documentation
          </a>
        </div>

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : userSettings ? (
          <OuraConnection
            userSettings={userSettings}
            syncStates={syncStatusData?.states}
            syncStatusLoading={syncStatusLoading}
          />
        ) : null}
      </div>
    </div>
  )
}
