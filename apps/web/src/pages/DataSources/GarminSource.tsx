import type { GarminDataType, ProviderSyncStatus } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'

import {
  connectGarmin,
  disconnectGarmin,
  fetchGarminSyncStatus,
  fetchUserSettings,
  syncGarmin,
  updateUserSettings,
  verifyGarminMfa,
} from '../../state/api'
import { auth } from '../../state/auth'
import { type DataTypeItem, DataTypesList, LoginRequired, StatusBanner, SyncStatusBar } from './shared'
import './style.css'

interface GarminDataTypeInfo {
  type: GarminDataType
  label: string
  href?: string
  hc_note?: string // Health Connect overlap note (undefined = Garmin only)
}

const GARMIN_DATA_TYPES: GarminDataTypeInfo[] = [
  {
    type: 'dailySummary',
    label: 'Daily summary (steps, distance, calories, floors)',
    href: '/metric/steps',
    hc_note: 'Also available via Health Connect',
  },
  {
    type: 'heartRate',
    label: 'Heart rate (resting + samples)',
    href: '/metric/heart_rate',
    hc_note: 'Also available via Health Connect',
  },
  { type: 'hrv', label: 'HRV (last night average)', href: '/metric/hrv_rmssd' },
  {
    type: 'sleep',
    label: 'Sleep (duration, stages, score)',
    href: '/sleep',
    hc_note: 'Also available via Health Connect. Garmin adds sleep score.',
  },
  { type: 'stress', label: 'Stress level', href: '/metric/stress_level' },
  { type: 'bodyBattery', label: 'Body Battery', href: '/metric/body_battery' },
  {
    type: 'activities',
    label: 'Activities (exercise with HR, VO2 max)',
    hc_note: 'Also available via Health Connect. Garmin adds VO2 max, activity type detail.',
  },
  { type: 'spo2', label: 'SpO2 (blood oxygen)', href: '/metric/spo2' },
  { type: 'respiration', label: 'Respiration rate', href: '/metric/respiratory_rate' },
  { type: 'trainingReadiness', label: 'Training readiness', href: '/metric/training_readiness' },
  { type: 'intensityMinutes', label: 'Intensity minutes', href: '/metric/intensity_minutes' },
]

// Static list for when not connected (no toggles)
const DATA_TYPES: DataTypeItem[] = GARMIN_DATA_TYPES.map(({ label, href }) => ({ label, href }))

type LoginStatus = 'idle' | 'loading' | 'mfa' | 'mfa_loading' | 'error'

function GarminMfaForm({ onCancel, onSuccess }: { onCancel: () => void; onSuccess: () => void }) {
  const [mfaCode, setMfaCode] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading'>('idle')
  const [error, setError] = useState('')

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault()
      if (!mfaCode) return

      setStatus('loading')
      setError('')
      try {
        const result = await verifyGarminMfa(mfaCode)
        if (result.success) {
          onSuccess()
        } else {
          setStatus('idle')
          setError(result.error ?? 'Verification failed')
        }
      } catch (err) {
        setStatus('idle')
        setError(err instanceof Error ? err.message : 'Verification failed')
      }
    },
    [mfaCode, onSuccess],
  )

  return (
    <form class="garmin-login-form" onSubmit={handleSubmit}>
      <p class="field-description">
        Garmin has sent a verification code to your email. Enter it below to complete login.
      </p>
      <div class="form-field">
        <label for="garmin-mfa-code">Verification Code</label>
        <input
          id="garmin-mfa-code"
          type="text"
          inputMode="numeric"
          pattern="[0-9]*"
          autoComplete="one-time-code"
          value={mfaCode}
          onInput={(e) => setMfaCode((e.target as HTMLInputElement).value)}
          placeholder="Enter code from email"
          required
          disabled={status === 'loading'}
        />
      </div>
      <button type="submit" class="connect-button" disabled={status === 'loading' || !mfaCode}>
        {status === 'loading' ? 'Verifying...' : 'Verify Code'}
      </button>
      <button type="button" class="connect-button disconnect-button" onClick={onCancel}>
        Cancel
      </button>
      {error && <p class="garmin-login-error">{error}</p>}
    </form>
  )
}

function GarminLoginForm({ onMfaRequired, onSuccess }: { onMfaRequired: () => void; onSuccess: () => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = useCallback(
    async (e: Event) => {
      e.preventDefault()
      if (!email || !password) return

      setLoading(true)
      setError('')
      try {
        const result = await connectGarmin(email, password)
        if (result.success) {
          setEmail('')
          setPassword('')
          onSuccess()
        } else if (result.mfa_required) {
          onMfaRequired()
        } else {
          setError(result.error ?? 'Login failed')
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Login failed')
      } finally {
        setLoading(false)
      }
    },
    [email, password, onSuccess, onMfaRequired],
  )

  return (
    <form class="garmin-login-form" onSubmit={handleSubmit}>
      <div class="form-field">
        <label for="garmin-email">Garmin Connect Email</label>
        <input
          id="garmin-email"
          type="email"
          value={email}
          onInput={(e) => setEmail((e.target as HTMLInputElement).value)}
          placeholder="your-email@example.com"
          required
          disabled={loading}
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
          disabled={loading}
        />
      </div>
      <button type="submit" class="connect-button" disabled={loading || !email || !password}>
        {loading ? 'Connecting...' : 'Connect Garmin'}
      </button>
      <p class="field-description">
        Your credentials are used only to authenticate with Garmin and are never stored on the server. Only
        session tokens are saved.
      </p>
      {error && <p class="garmin-login-error">{error}</p>}
    </form>
  )
}

function GarminDataTypeToggles({
  disabledTypes,
  onToggle,
}: {
  disabledTypes: GarminDataType[]
  onToggle: (disabledTypes: GarminDataType[]) => Promise<void>
}) {
  // Optimistic local state — updates immediately on click
  const [localDisabled, setLocalDisabled] = useState<GarminDataType[]>(disabledTypes)
  const [saving, setSaving] = useState(false)

  // Sync local state with prop when not saving (e.g. after API response)
  if (!saving && localDisabled !== disabledTypes) {
    setLocalDisabled(disabledTypes)
  }

  const handleToggle = useCallback(
    async (type: GarminDataType) => {
      setLocalDisabled((prev) => {
        const set = new Set(prev)
        return set.has(type) ? prev.filter((t) => t !== type) : [...prev, type]
      })
      setSaving(true)
      try {
        const set = new Set(localDisabled)
        const newDisabled = set.has(type) ? localDisabled.filter((t) => t !== type) : [...localDisabled, type]
        await onToggle(newDisabled)
      } finally {
        setSaving(false)
      }
    },
    [localDisabled, onToggle],
  )

  const disabledSet = new Set(localDisabled)

  return (
    <div class="data-types-section">
      <h2>Data types</h2>
      <p class="field-description">
        Toggle which data types to sync from Garmin. Disable types that are already synced via Health Connect
        to avoid duplicates.
      </p>
      <div class="garmin-data-types-grid">
        {GARMIN_DATA_TYPES.map((dt) => {
          const enabled = !disabledSet.has(dt.type)
          return (
            <label key={dt.type} class={`garmin-data-type-row ${enabled ? '' : 'disabled'}`}>
              <input type="checkbox" checked={enabled} onChange={() => handleToggle(dt.type)} />
              <div class="garmin-data-type-info">
                {dt.href ? (
                  <a class="garmin-data-type-label" href={dt.href}>
                    {dt.label}
                  </a>
                ) : (
                  <span class="garmin-data-type-label">{dt.label}</span>
                )}
                <span class="garmin-data-type-note">{dt.hc_note ?? 'Garmin only'}</span>
              </div>
            </label>
          )
        })}
      </div>
    </div>
  )
}

function GarminDataTypesSection({
  isConnected,
  disabledTypes,
  queryClient,
}: {
  isConnected: boolean
  disabledTypes: GarminDataType[]
  queryClient: ReturnType<typeof useQueryClient>
}) {
  if (!isConnected) return <DataTypesList types={DATA_TYPES} />

  return (
    <GarminDataTypeToggles
      disabledTypes={disabledTypes}
      onToggle={async (types) => {
        await updateUserSettings({ garmin_disabled_data_types: types })
        await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      }}
    />
  )
}

function GarminConnectionSection({
  isConnected,
  syncStatusData,
  syncStatusLoading,
  loginStatus,
  setLoginStatus,
  disconnecting,
  syncStatus,
  syncMessage,
  handleLoginSuccess,
  handleDisconnect,
  handleSyncNow,
  handleFullResync,
}: {
  isConnected: boolean
  syncStatusData: { states?: ProviderSyncStatus[] } | undefined
  syncStatusLoading: boolean
  loginStatus: LoginStatus
  setLoginStatus: (s: LoginStatus) => void
  disconnecting: boolean
  syncStatus: string
  syncMessage: string
  handleLoginSuccess: () => Promise<void>
  handleDisconnect: () => Promise<void>
  handleSyncNow: () => Promise<void>
  handleFullResync: () => Promise<void>
}) {
  return (
    <>
      <StatusBanner
        connected={isConnected}
        label={isConnected ? 'Garmin Connect is connected' : 'Garmin Connect not connected'}
      />

      {isConnected && (
        <SyncStatusBar
          states={syncStatusData?.states}
          isLoading={syncStatusLoading}
          onSyncNow={handleSyncNow}
        />
      )}

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
        ) : loginStatus === 'mfa' ? (
          <GarminMfaForm onCancel={() => setLoginStatus('idle')} onSuccess={handleLoginSuccess} />
        ) : (
          <GarminLoginForm onMfaRequired={() => setLoginStatus('mfa')} onSuccess={handleLoginSuccess} />
        )}
      </section>
    </>
  )
}

export function GarminSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const isConnected = userSettings?.garmin_connected ?? false

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && isConnected,
    queryFn: fetchGarminSyncStatus,
    queryKey: ['garminSyncStatus'],
  })

  const [loginStatus, setLoginStatus] = useState<LoginStatus>('idle')

  // Disconnect state
  const [disconnecting, setDisconnecting] = useState(false)

  // Sync state
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  const handleLoginSuccess = useCallback(async () => {
    setLoginStatus('idle')
    await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
  }, [queryClient])

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

  const handleSyncNow = useCallback(async () => {
    await syncGarmin(false)
    await queryClient.invalidateQueries({ queryKey: ['garminSyncStatus'] })
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

        <GarminDataTypesSection
          isConnected={isConnected}
          disabledTypes={userSettings?.garmin_disabled_data_types ?? []}
          queryClient={queryClient}
        />

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <GarminConnectionSection
            isConnected={isConnected}
            syncStatusData={syncStatusData}
            syncStatusLoading={syncStatusLoading}
            loginStatus={loginStatus}
            setLoginStatus={setLoginStatus}
            disconnecting={disconnecting}
            syncStatus={syncStatus}
            syncMessage={syncMessage}
            handleLoginSuccess={handleLoginSuccess}
            handleDisconnect={handleDisconnect}
            handleSyncNow={handleSyncNow}
            handleFullResync={handleFullResync}
          />
        )}
      </div>
    </div>
  )
}
