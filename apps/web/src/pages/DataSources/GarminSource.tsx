import type {
  GarminDataSources,
  GarminDataType,
  GarminOAuthStatus,
  GarminPersonalKeyStatus,
  ProviderSyncStatus,
} from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

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
import {
  garminConnectionFlags,
  garminDataTypeNote,
  garminDataTypeSourceNote,
  garminLoginOnlyData,
  type GarminSwitchStep,
  garminSwitchStep,
  joinList,
} from './garminConnection'
import { GarminOAuth } from './GarminOAuth'
import { GarminPersonalKey } from './GarminPersonalKey'
import {
  type DataTypeItem,
  DataTypesList,
  LoginRequiredToFinish,
  StatusBanner,
  SyncIntervalField,
  SyncStatusBar,
} from './shared'
import './style.css'

interface GarminDataTypeInfo {
  type: GarminDataType
  label: string
  href?: string
  hc_note?: string // Health Connect overlap note (undefined = Garmin only)
  key_note?: string
  push_note?: string
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
    key_note: 'Without the stage timeline',
  },
  { type: 'stress', label: 'Stress level', href: '/metric/stress_level', key_note: 'Needs the Garmin login' },
  { type: 'bodyBattery', label: 'Body Battery', href: '/metric/body_battery' },
  {
    type: 'activities',
    label: 'Activities (exercise with HR, VO2 max)',
    hc_note: 'Also available via Health Connect. Garmin adds VO2 max, activity type detail.',
    key_note: 'Per-second detail, GPS and strength sets from the FIT file',
    push_note: 'Per-second detail, GPS and strength sets from the FIT file',
  },
  { type: 'spo2', label: 'SpO2 (blood oxygen)', href: '/metric/spo2' },
  { type: 'respiration', label: 'Respiration rate', href: '/metric/respiratory_rate' },
  {
    type: 'trainingReadiness',
    label: 'Training readiness',
    href: '/metric/training_readiness',
    key_note: 'Needs the Garmin login',
    push_note: 'Needs the Garmin login',
  },
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

function GarminDataTypeRow({
  dt,
  enabled,
  note,
  sourceNote,
  onToggle,
}: {
  dt: GarminDataTypeInfo
  enabled: boolean
  note: string | undefined
  sourceNote: string | undefined
  onToggle: () => void
}) {
  return (
    <label class={`garmin-data-type-row ${enabled ? '' : 'disabled'}`}>
      <input type="checkbox" checked={enabled} onChange={onToggle} />
      <div class="garmin-data-type-info">
        {dt.href ? (
          <a class="garmin-data-type-label" href={dt.href}>
            {dt.label}
          </a>
        ) : (
          <span class="garmin-data-type-label">{dt.label}</span>
        )}
        <span class="garmin-data-type-note">{dt.hc_note ?? 'Garmin only'}</span>
        {note && <span class="garmin-data-type-note">{note}</span>}
        {sourceNote && <span class="garmin-data-type-note">{sourceNote}</span>}
      </div>
    </label>
  )
}

function GarminDataTypeToggles({
  disabledTypes,
  keyOnly,
  pushOnly,
  sources,
  onToggle,
}: {
  disabledTypes: GarminDataType[]
  keyOnly: boolean
  pushOnly: boolean
  sources: GarminDataSources | undefined
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
        Toggle which data types Aurboda takes from Garmin, whichever connection brings them. Disable types
        that are already synced via Health Connect to avoid duplicates.
      </p>
      <div class="garmin-data-types-grid">
        {GARMIN_DATA_TYPES.map((dt) => (
          <GarminDataTypeRow
            key={dt.type}
            dt={dt}
            enabled={!disabledSet.has(dt.type)}
            note={garminDataTypeNote(dt, { keyOnly, pushOnly })}
            sourceNote={garminDataTypeSourceNote(dt.type, sources)}
            onToggle={() => handleToggle(dt.type)}
          />
        ))}
      </div>
    </div>
  )
}

function GarminDataTypesSection({
  isConnected,
  keyOnly,
  pushOnly,
  sources,
  disabledTypes,
  queryClient,
}: {
  isConnected: boolean
  keyOnly: boolean
  pushOnly: boolean
  sources: GarminDataSources | undefined
  disabledTypes: GarminDataType[]
  queryClient: ReturnType<typeof useQueryClient>
}) {
  if (!isConnected) return <DataTypesList types={DATA_TYPES} />

  return (
    <GarminDataTypeToggles
      disabledTypes={disabledTypes}
      keyOnly={keyOnly}
      pushOnly={pushOnly}
      sources={sources}
      onToggle={async (types) => {
        await updateUserSettings({ garmin_disabled_data_types: types })
        await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      }}
    />
  )
}

function GarminSwitchGuide({ step, loginOnly }: { step: GarminSwitchStep; loginOnly: string[] | null }) {
  return (
    <div class="garmin-switch-guide">
      <h2>Switching to Connect with Garmin</h2>
      {step === 'connect' && (
        <p>
          This server offers Connect with Garmin, Garmin's official connection: you sign in at Garmin, and
          Garmin sends new data as your watch syncs. To switch from the login, connect it below, wait for the
          first data, then disconnect the login. You can also keep both.
        </p>
      )}
      {step === 'wait' && (
        <p>
          Connect with Garmin is connected. Once it shows data received, you can disconnect the login below,
          or keep both.
        </p>
      )}
      {step === 'ready' && (
        <p>
          Connect with Garmin now delivers your new data, and the login only fetches what it lacks. Keep the
          login for {joinList(loginOnly ?? [])}, or disconnect it below.
        </p>
      )}
    </div>
  )
}

function GarminLoginDeliveredNote({ delivered }: { delivered: number }) {
  if (delivered === 0) return null
  return (
    <p class="field-description">
      Connect with Garmin delivers {delivered} of your data types, so the login no longer fetches those on its
      schedule. It still fetches the rest (see Data types below) and strength sets. Sync Now and Full Re-sync
      fetch everything through the login, including your history. If Garmin stops sending data for a day, the
      login takes over again.
    </p>
  )
}

function GarminLoginSection({
  sessionConnected,
  delivered,
  loginOnly,
  loginStatus,
  setLoginStatus,
  disconnecting,
  handleLoginSuccess,
  handleDisconnect,
}: {
  sessionConnected: boolean
  delivered: number
  loginOnly: string[] | null
  loginStatus: LoginStatus
  setLoginStatus: (s: LoginStatus) => void
  disconnecting: boolean
  handleLoginSuccess: () => Promise<void>
  handleDisconnect: () => Promise<void>
}) {
  return (
    <section class="settings-section">
      <h2>Garmin login (email and password)</h2>
      <p class="field-description">
        Aurboda signs in to Garmin Connect as you and fetches your data on a schedule, including your history,
        training readiness and strength sets. This is not an official Garmin API, so Garmin can ask you to
        sign in again.
      </p>

      {sessionConnected ? (
        <div class="garmin-connected-actions">
          <p class="connected-status">Connected</p>
          <GarminLoginDeliveredNote delivered={delivered} />
          {loginOnly && (
            <p class="field-description">
              If you disconnect the login, these stop: {joinList(loginOnly)}. Everything else keeps arriving.
            </p>
          )}
          <div class="garmin-button-row">
            <button
              type="button"
              class="connect-button disconnect-button"
              disabled={disconnecting}
              onClick={handleDisconnect}
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          </div>
        </div>
      ) : loginStatus === 'mfa' ? (
        <GarminMfaForm onCancel={() => setLoginStatus('idle')} onSuccess={handleLoginSuccess} />
      ) : (
        <GarminLoginForm onMfaRequired={() => setLoginStatus('mfa')} onSuccess={handleLoginSuccess} />
      )}
    </section>
  )
}

function GarminPullSection({
  syncStatusData,
  syncStatusLoading,
  syncStatus,
  syncMessage,
  handleSyncNow,
  handleFullResync,
}: {
  syncStatusData: { states?: ProviderSyncStatus[] } | undefined
  syncStatusLoading: boolean
  syncStatus: string
  syncMessage: string
  handleSyncNow: () => Promise<void>
  handleFullResync: () => Promise<void>
}) {
  return (
    <>
      <section class="settings-section">
        <h2>Sync</h2>
        <SyncStatusBar
          states={syncStatusData?.states}
          isLoading={syncStatusLoading}
          onSyncNow={handleSyncNow}
        />
        <div class="garmin-button-row">
          <button
            type="button"
            class="connect-button"
            disabled={syncStatus === 'syncing'}
            onClick={handleFullResync}
          >
            {syncStatus === 'syncing' ? 'Syncing...' : 'Full Re-sync'}
          </button>
        </div>
        {syncMessage && <p class={`garmin-sync-message ${syncStatus}`}>{syncMessage}</p>}
      </section>

      <SyncIntervalField provider="garmin" />
    </>
  )
}

function GarminConnectionSection({
  isConnected,
  oauth,
  sessionConnected,
  personalKey,
  onPersonalKeyChanged,
  loginStatus,
  setLoginStatus,
  disconnecting,
  handleLoginSuccess,
  handleDisconnect,
}: {
  isConnected: boolean
  oauth: GarminOAuthStatus
  sessionConnected: boolean
  personalKey: GarminPersonalKeyStatus | undefined
  onPersonalKeyChanged: () => Promise<void>
  loginStatus: LoginStatus
  setLoginStatus: (s: LoginStatus) => void
  disconnecting: boolean
  handleLoginSuccess: () => Promise<void>
  handleDisconnect: () => Promise<void>
}) {
  const switchStep = garminSwitchStep({ oauth, sessionConnected })
  const loginOnly = garminLoginOnlyData({
    keyConnected: personalKey?.connected ?? false,
    oauthConnected: oauth.connected && !oauth.needs_reconnect,
  })

  return (
    <>
      <StatusBanner
        connected={isConnected}
        label={isConnected ? 'Garmin is connected' : 'Garmin not connected'}
      />

      {switchStep && <GarminSwitchGuide step={switchStep} loginOnly={loginOnly} />}

      <GarminOAuth status={oauth} onChanged={onPersonalKeyChanged} hasLogin={sessionConnected} />

      <GarminLoginSection
        sessionConnected={sessionConnected}
        delivered={oauth.delivers.length}
        loginOnly={loginOnly}
        loginStatus={loginStatus}
        setLoginStatus={setLoginStatus}
        disconnecting={disconnecting}
        handleLoginSuccess={handleLoginSuccess}
        handleDisconnect={handleDisconnect}
      />

      {personalKey && <GarminPersonalKey status={personalKey} onChanged={onPersonalKeyChanged} />}
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

  const { canPull, isConnected, keyOnly, oauth, personalKey, sessionConnected } =
    garminConnectionFlags(userSettings)

  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  const shouldPoll = syncStatus === 'syncing'

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && canPull,
    queryFn: fetchGarminSyncStatus,
    queryKey: ['garminSyncStatus'],
    refetchInterval: shouldPoll ? 3000 : false,
  })

  const isSyncing = syncStatusData?.states?.some((s) => s.status === 'syncing') ?? false

  const [loginStatus, setLoginStatus] = useState<LoginStatus>('idle')

  const [disconnecting, setDisconnecting] = useState(false)

  // When polling detects sync finished, update local state
  const prevSyncingRef = useRef(false)
  useEffect(() => {
    if (prevSyncingRef.current && !isSyncing && syncStatus === 'syncing') {
      const hasError = syncStatusData?.states?.some((s) => s.status === 'error')
      setSyncStatus(hasError ? 'error' : 'done')
      setSyncMessage(hasError ? 'Sync completed with errors' : 'Sync complete')
      queryClient.invalidateQueries()
    }
    prevSyncingRef.current = isSyncing
  }, [isSyncing, syncStatus, syncStatusData, queryClient])

  const handleLoginSuccess = useCallback(async () => {
    setLoginStatus('idle')
    await queryClient.invalidateQueries({ queryKey: ['userSettings'] })
  }, [queryClient])

  const handlePersonalKeyChanged = useCallback(async () => {
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
    setSyncStatus('syncing')
    setSyncMessage('')
    try {
      await syncGarmin(false)
      await queryClient.invalidateQueries({ queryKey: ['garminSyncStatus'] })
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed')
    }
  }, [queryClient])

  const handleFullResync = useCallback(async () => {
    setSyncStatus('syncing')
    setSyncMessage('')
    try {
      await syncGarmin(true)
      // Sync runs in background — polling will detect completion
      await queryClient.invalidateQueries({ queryKey: ['garminSyncStatus'] })
    } catch (err) {
      setSyncStatus('error')
      setSyncMessage(err instanceof Error ? err.message : 'Sync failed')
    }
  }, [queryClient])

  if (!isLoggedIn) return <LoginRequiredToFinish provider="garmin" providerName="Garmin" />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Garmin</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://connect.garmin.com/" target="_blank" rel="noopener noreferrer">
            Garmin Connect
          </a>{' '}
          provides fitness and health data from Garmin wearable devices. Aurboda can connect to your Garmin
          account in the ways below. They work alone or together and fill the same records, so nothing is
          counted twice.
        </p>

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <>
            <GarminConnectionSection
              isConnected={isConnected}
              oauth={oauth}
              sessionConnected={sessionConnected}
              personalKey={personalKey}
              onPersonalKeyChanged={handlePersonalKeyChanged}
              loginStatus={loginStatus}
              setLoginStatus={setLoginStatus}
              disconnecting={disconnecting}
              handleLoginSuccess={handleLoginSuccess}
              handleDisconnect={handleDisconnect}
            />
            {canPull && (
              <GarminPullSection
                syncStatusData={syncStatusData}
                syncStatusLoading={syncStatusLoading}
                syncStatus={syncStatus}
                syncMessage={syncMessage}
                handleSyncNow={handleSyncNow}
                handleFullResync={handleFullResync}
              />
            )}
          </>
        )}

        <GarminDataTypesSection
          isConnected={isConnected}
          keyOnly={keyOnly}
          pushOnly={oauth.connected && !canPull}
          sources={userSettings?.garmin_data_sources}
          disabledTypes={userSettings?.garmin_disabled_data_types ?? []}
          queryClient={queryClient}
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
      </div>
    </div>
  )
}
