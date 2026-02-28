import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import { TagMappingsSettings } from '../../components/TagMappingsSettings'
import { API_URL } from '../../config'
import { fetchUserSettings, syncOura } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

const DATA_TYPES = [
  'Sleep (duration, stages, scores)',
  'Readiness score',
  'Resilience',
  'HRV (resting)',
  'Cardiovascular age',
  'Resting heart rate',
  'Meditation / breathing sessions',
  'Oura tags (mood, symptoms, etc.)',
]

export function OuraSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const [ouraSyncStatus, setOuraSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [ouraSyncMessage, setOuraSyncMessage] = useState<string>('')

  const handleConnectOura = () => {
    window.location.href = `${API_URL}/auth/connectOura`
  }

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

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view data source settings.</p>
      </div>
    )
  }

  const isOuraConnected = userSettings?.oura_connected ?? false

  return (
    <div class="data-sources-page">
      <a href="/data-sources" class="back-link">
        &larr; All Data Sources
      </a>

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

        <div class="data-types-section">
          <h2>Data provided</h2>
          <div class="data-types-list">
            {DATA_TYPES.map((dt) => (
              <span key={dt} class="data-type-badge">
                {dt}
              </span>
            ))}
          </div>
        </div>

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

        {isLoading ?
          <div class="loading">Loading...</div>
        : <>
            <div class={`status-banner ${isOuraConnected ? 'connected' : 'not-connected'}`}>
              <span class={`status-dot ${isOuraConnected ? 'connected' : 'not-connected'}`} />
              {isOuraConnected ? 'Oura Ring is connected' : 'Oura Ring not connected'}
            </div>

            <section class="settings-section">
              <h2>Connection</h2>

              {isOuraConnected ?
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
                  {ouraSyncMessage && (
                    <span class={`oura-sync-message ${ouraSyncStatus}`}>{ouraSyncMessage}</span>
                  )}
                </div>
              : userSettings?.oura_configured === false ?
                <>
                  <button type="button" class="connect-button" disabled>
                    Connect Oura
                  </button>
                  <p class="field-description warning">
                    Oura OAuth is not configured on the server. Ask your administrator to set up OURA_CLIENT
                    and OURA_SECRET environment variables.
                  </p>
                </>
              : <>
                  <button type="button" class="connect-button" onClick={handleConnectOura}>
                    Connect Oura
                  </button>
                  <p class="field-description">
                    Click to authorize Aurboda to access your Oura data. You will be redirected to Oura to
                    grant permission.
                  </p>
                </>
              }
            </section>
          </>
        }
      </div>

      <TagMappingsSettings />
    </div>
  )
}
