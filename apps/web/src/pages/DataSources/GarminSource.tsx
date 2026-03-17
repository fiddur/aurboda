import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'

import { connectGarmin, disconnectGarmin, fetchUserSettings, syncGarmin } from '../../state/api'
import { auth } from '../../state/auth'
import { DataTypesList, LoginRequired, StatusBanner } from './shared'
import './style.css'

const DATA_TYPES = [
  'Daily summary (steps, distance, calories, floors)',
  'Heart rate (resting + samples)',
  'HRV (last night average)',
  'Sleep (duration, stages, score)',
  'Stress level',
  'Body Battery',
  'Activities (exercise with HR, VO2 max)',
  'SpO2 (blood oxygen)',
  'Respiration rate',
  'Training readiness',
  'Intensity minutes',
]

export function GarminSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const isConnected = userSettings?.garmin_connected ?? false

  // Login form state
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loginStatus, setLoginStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [loginError, setLoginError] = useState('')

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState(false)

  // Sync state
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  const handleLogin = useCallback(
    async (e: Event) => {
      e.preventDefault()
      if (!email || !password) return

      setLoginStatus('loading')
      setLoginError('')
      try {
        const result = await connectGarmin(email, password)
        if (result.success) {
          setEmail('')
          setPassword('')
          setLoginStatus('idle')
          await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
        } else if (result.mfa_required) {
          setLoginStatus('error')
          setLoginError('Garmin requires multi-factor authentication, which is not yet supported.')
        } else {
          setLoginStatus('error')
          setLoginError(result.error ?? 'Login failed')
        }
      } catch (err) {
        setLoginStatus('error')
        setLoginError(err instanceof Error ? err.message : 'Login failed')
      }
    },
    [email, password, queryClient],
  )

  const handleDisconnect = useCallback(async () => {
    setDisconnecting(true)
    try {
      await disconnectGarmin()
      await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
    } catch {
      // Silently handle — the user can try again
    } finally {
      setDisconnecting(false)
    }
  }, [queryClient])

  const handleFullResync = useCallback(async () => {
    setSyncStatus('syncing')
    setSyncMessage('')
    try {
      const response = await syncGarmin(true)
      const totalRecords = (response.results ?? []).reduce((sum, r) => sum + (r.records_processed ?? 0), 0)
      setSyncStatus('done')
      setSyncMessage(`Synced ${totalRecords} records`)
      await queryClient.invalidateQueries()
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed')
    }
  }, [queryClient])

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Garmin Connect</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://connect.garmin.com/" target="_blank" rel="noopener noreferrer">
            Garmin Connect
          </a>{' '}
          provides fitness and health data from Garmin wearable devices. Aurboda syncs data by connecting to
          your Garmin account. Your credentials are used only for the initial login and are never stored —
          only session tokens are persisted.
        </p>

        <DataTypesList types={DATA_TYPES} />

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <>
            <StatusBanner
              connected={isConnected}
              label={isConnected ? 'Garmin Connect is connected' : 'Garmin Connect not connected'}
            />

            <div class="links-row">
              <a
                href="https://github.com/fiddur/aurboda/blob/develop/docs/garmin.md"
                target="_blank"
                rel="noopener noreferrer"
                class="doc-link"
              >
                Garmin integration documentation
              </a>
            </div>

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
              ) : (
                <form class="garmin-login-form" onSubmit={handleLogin}>
                  <div class="form-field">
                    <label for="garmin-email">Garmin Connect Email</label>
                    <input
                      id="garmin-email"
                      type="email"
                      value={email}
                      onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
                      placeholder="your-email@example.com"
                      required
                      disabled={loginStatus === 'loading'}
                    />
                  </div>
                  <div class="form-field">
                    <label for="garmin-password">Password</label>
                    <input
                      id="garmin-password"
                      type="password"
                      value={password}
                      onInput={(e) => setPassword((e.target as HTMLInputElement).value)}
                      placeholder="Your Garmin password"
                      required
                      disabled={loginStatus === 'loading'}
                    />
                  </div>
                  <button
                    type="submit"
                    class="connect-button"
                    disabled={loginStatus === 'loading' || !email || !password}
                  >
                    {loginStatus === 'loading' ? 'Connecting...' : 'Connect Garmin'}
                  </button>
                  <p class="field-description">
                    Your credentials are used only to authenticate with Garmin and are never stored on the
                    server. Only session tokens are saved.
                  </p>
                  {loginError && <p class="garmin-login-error">{loginError}</p>}
                </form>
              )}
            </section>
          </>
        )}
      </div>
    </div>
  )
}
