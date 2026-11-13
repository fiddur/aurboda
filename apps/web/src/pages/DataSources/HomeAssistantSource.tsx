import type { ProviderSyncStatus } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useCallback, useEffect, useRef, useState } from 'preact/hooks'

import {
  fetchHomeAssistantEntities,
  fetchHomeAssistantSyncStatus,
  fetchUserSettings,
  syncHomeAssistant,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
import { apiErrorText } from '../../utils/profile'
import { connectionUpdate, syncResultMessage, tokenWillBeRemoved } from './homeAssistantConnection'
import {
  type DataTypeItem,
  DataTypesList,
  LoginRequired,
  type SaveStatus,
  SaveStatusIndicator,
  StatusBanner,
  SyncIntervalField,
  SyncStatusBar,
} from './shared'
import './style.css'
import { refetchWhileSyncing } from './syncPolling'

const DATA_TYPES: DataTypeItem[] = [
  { label: 'GPS location' },
  { label: 'Home Assistant zones' },
  { href: '/places', label: 'Visited places' },
]

const HOME_ASSISTANT_DEFAULT_INTERVAL_MINUTES = 10

const DOCS_URL = 'https://github.com/fiddur/aurboda/blob/develop/docs/home-assistant.md'

const errorText = (err: unknown, fallback: string): string =>
  axios.isAxiosError(err)
    ? apiErrorText((err.response?.data as { error?: unknown } | undefined)?.error, err.message)
    : err instanceof Error
      ? err.message
      : fallback

function HomeAssistantConnectionSection({
  storedUrl,
  tokenSet,
}: {
  storedUrl: string | null
  tokenSet: boolean
}) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(storedUrl ?? '')
  const [token, setToken] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [disconnecting, setDisconnecting] = useState(false)

  useEffect(() => {
    setUrl(storedUrl ?? '')
  }, [storedUrl])

  const stored = { tokenSet, url: storedUrl }
  const form = { token, url }
  const pending = connectionUpdate(stored, form)
  const hasChanges = 'error' in pending || Object.keys(pending.update).length > 0
  const removesToken = tokenWillBeRemoved(stored, form)

  const saveSettings = useCallback(
    async (update: Parameters<typeof updateUserSettings>[0]) => {
      const result = await updateUserSettings(update)
      queryClient.setQueryData(['userSettings'], result)
      await queryClient.invalidateQueries({ queryKey: ['homeAssistantEntities'] })
    },
    [queryClient],
  )

  const handleSave = async (e: Event) => {
    e.preventDefault()
    if ('error' in pending) {
      setSaveStatus({ error: pending.error, status: 'error' })
      return
    }
    if (Object.keys(pending.update).length === 0) return
    setSaveStatus({ status: 'saving' })
    try {
      await saveSettings(pending.update)
      setToken('')
      setSaveStatus({ status: 'saved' })
    } catch (err) {
      setSaveStatus({ error: errorText(err, 'Failed to save'), status: 'error' })
    }
  }

  const handleDisconnect = async () => {
    setDisconnecting(true)
    setSaveStatus({ status: 'idle' })
    try {
      await saveSettings({
        home_assistant_entity_id: null,
        home_assistant_token: null,
        home_assistant_url: null,
      })
      setToken('')
    } catch (err) {
      setSaveStatus({ error: errorText(err, 'Failed to disconnect'), status: 'error' })
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Connection</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <form onSubmit={handleSave}>
        <div class="form-field">
          <label for="ha-url">Home Assistant URL</label>
          <input
            id="ha-url"
            type="url"
            value={url}
            onInput={(e) => setUrl((e.target as HTMLInputElement).value)}
            placeholder="https://ha.example.org"
            autocomplete="off"
          />
          <p class="field-description">
            The address the Aurboda server reaches Home Assistant at. It must use https unless the server
            administrator allows private addresses.
          </p>
        </div>
        <div class="form-field">
          <label for="ha-token">Long-lived access token</label>
          <input
            id="ha-token"
            type="password"
            value={token}
            onInput={(e) => setToken((e.target as HTMLInputElement).value)}
            placeholder={tokenSet ? 'A token is stored: enter a new one to replace it' : 'Paste the token'}
            autocomplete="off"
          />
          <p class="field-description">
            Create it in Home Assistant under your profile, Security, Long-lived access tokens. The token is
            never shown again. Changing the URL to another host removes the stored token.
          </p>
          {removesToken && (
            <p class="field-description warning">
              Saving this URL removes the stored token, since it points at another host. Enter the token again
              to keep the connection.
            </p>
          )}
        </div>
        <div class="garmin-button-row">
          <button
            type="submit"
            class="connect-button"
            disabled={!hasChanges || saveStatus.status === 'saving'}
          >
            {saveStatus.status === 'saving' ? 'Saving...' : 'Save'}
          </button>
          {(storedUrl || tokenSet) && (
            <button
              type="button"
              class="connect-button disconnect-button"
              disabled={disconnecting}
              onClick={handleDisconnect}
            >
              {disconnecting ? 'Disconnecting...' : 'Disconnect'}
            </button>
          )}
        </div>
      </form>
    </section>
  )
}

function HomeAssistantEntitySection({
  storedUrl,
  storedEntity,
  enabled,
}: {
  storedUrl: string | null
  storedEntity: string | null
  enabled: boolean
}) {
  const queryClient = useQueryClient()
  const [entity, setEntity] = useState(storedEntity ?? '')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const lastSent = useRef(storedEntity ?? '')

  useEffect(() => {
    setEntity(storedEntity ?? '')
    lastSent.current = storedEntity ?? ''
  }, [storedEntity])

  const entitiesQuery = useQuery({
    enabled,
    queryFn: fetchHomeAssistantEntities,
    queryKey: ['homeAssistantEntities', storedUrl],
    retry: false,
  })
  const entities = entitiesQuery.data?.data ?? []

  const save = async () => {
    const value = entity.trim()
    if (value === lastSent.current) return
    lastSent.current = value
    setSaveStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ home_assistant_entity_id: value || null })
      queryClient.setQueryData(['userSettings'], result)
      setSaveStatus({ status: 'saved' })
    } catch (err) {
      lastSent.current = storedEntity ?? ''
      setSaveStatus({ error: errorText(err, 'Failed to save'), status: 'error' })
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Tracker entity</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <div class="form-field">
        <input
          type="text"
          list="ha-entities"
          value={entity}
          disabled={!enabled}
          onInput={(e) => setEntity((e.target as HTMLInputElement).value)}
          onChange={() => void save()}
          onBlur={() => void save()}
          placeholder="device_tracker.pixel_8"
          autocomplete="off"
        />
        <datalist id="ha-entities">
          {entities.map((e) => (
            <option
              key={e.entity_id}
              value={e.entity_id}
              label={e.name ? `${e.name} (${e.entity_id})` : e.entity_id}
            />
          ))}
        </datalist>
        <p class="field-description">
          {enabled
            ? 'The phone’s device_tracker.* carries altitude and speed; a person.* merges several trackers. Saves automatically when you leave the field.'
            : 'Save the URL and token first.'}
        </p>
        {enabled && entitiesQuery.isError && (
          <p class="garmin-sync-message error">
            Could not connect: {errorText(entitiesQuery.error, 'Failed to list entities')}
          </p>
        )}
        {enabled && entitiesQuery.isSuccess && (
          <p class="field-description">
            {entities.length > 0
              ? `Connected: Home Assistant lists ${entities.length} entit${entities.length === 1 ? 'y' : 'ies'} with a position.`
              : 'Connected, but Home Assistant lists no person or device_tracker entity with a position.'}
          </p>
        )}
      </div>
    </section>
  )
}

function HomeAssistantSyncSection({
  syncStates,
  syncStatusLoading,
}: {
  syncStates: ProviderSyncStatus[] | undefined
  syncStatusLoading: boolean
}) {
  const queryClient = useQueryClient()
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')

  const isSyncing = syncStates?.some((s) => s.status === 'syncing') ?? false
  const prevSyncingRef = useRef(false)
  useEffect(() => {
    if (prevSyncingRef.current && !isSyncing && syncStatus === 'syncing') {
      setSyncStatus('done')
      queryClient.invalidateQueries()
    }
    prevSyncingRef.current = isSyncing
  }, [isSyncing, syncStatus, queryClient])

  const handleSync = useCallback(
    async (fullResync: boolean) => {
      setSyncStatus('syncing')
      setSyncMessage('')
      try {
        const response = await syncHomeAssistant(fullResync)
        const result = response.result
        if (result) {
          setSyncStatus(result.status === 'success' ? 'done' : 'error')
          setSyncMessage(syncResultMessage(result))
          if (result.status === 'success') await queryClient.invalidateQueries()
        } else {
          setSyncStatus('error')
          setSyncMessage('Sync failed')
        }
        await queryClient.invalidateQueries({ queryKey: ['homeAssistantSyncStatus'] })
      } catch (err) {
        setSyncStatus('error')
        setSyncMessage(errorText(err, 'Sync failed'))
      }
    },
    [queryClient],
  )

  const handleSyncNow = useCallback(() => handleSync(false), [handleSync])
  const handleFullResync = useCallback(() => handleSync(true), [handleSync])

  return (
    <section class="settings-section">
      <SyncStatusBar states={syncStates} isLoading={syncStatusLoading} onSyncNow={handleSyncNow} />
      <div class="garmin-button-row">
        <button
          type="button"
          class="connect-button"
          disabled={syncStatus === 'syncing'}
          onClick={handleFullResync}
        >
          {syncStatus === 'syncing' ? 'Syncing...' : 'Full re-sync (last 10 days)'}
        </button>
      </div>
      {syncMessage && <p class={`garmin-sync-message ${syncStatus}`}>{syncMessage}</p>}
    </section>
  )
}

const statusLabel = (hasConnection: boolean, isConnected: boolean): string => {
  if (isConnected) return 'Home Assistant is connected'
  if (hasConnection) return 'Pick a tracker entity to start syncing'
  return 'Home Assistant not connected'
}

export function HomeAssistantSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const storedUrl = userSettings?.home_assistant_url ?? null
  const tokenSet = userSettings?.home_assistant_token_set ?? false
  const storedEntity = userSettings?.home_assistant_entity_id ?? null
  const hasConnection = !!storedUrl && tokenSet
  const isConnected = hasConnection && !!storedEntity

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && isConnected,
    queryFn: fetchHomeAssistantSyncStatus,
    queryKey: ['homeAssistantSyncStatus'],
    refetchInterval: (query) => refetchWhileSyncing(query.state.data),
  })

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Home Assistant</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://www.home-assistant.io/" target="_blank" rel="noopener noreferrer">
            Home Assistant
          </a>{' '}
          knows where your phone is through its companion app. Aurboda pulls that position history from your
          Home Assistant server with a long-lived access token and stores each fix as a GPS location, with the
          Home Assistant zone it was in, so visits show up on the Places page just like with OwnTracks.
        </p>

        <DataTypesList types={DATA_TYPES} />
        <StatusBanner connected={isConnected} label={statusLabel(hasConnection, isConnected)} />

        <div class="links-row">
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" class="doc-link">
            Home Assistant integration documentation
          </a>
          <a
            href="https://companion.home-assistant.io/"
            target="_blank"
            rel="noopener noreferrer"
            class="external-link"
          >
            Companion app
          </a>
        </div>

        {isConnected && (
          <HomeAssistantSyncSection
            syncStates={syncStatusData?.states}
            syncStatusLoading={syncStatusLoading}
          />
        )}

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <>
            <HomeAssistantConnectionSection storedUrl={storedUrl} tokenSet={tokenSet} />
            <HomeAssistantEntitySection
              storedUrl={storedUrl}
              storedEntity={storedEntity}
              enabled={hasConnection}
            />
            <SyncIntervalField
              provider="home_assistant"
              defaultMinutes={HOME_ASSISTANT_DEFAULT_INTERVAL_MINUTES}
            />
          </>
        )}

        {!isConnected && (
          <div class="setup-instructions">
            <h3>Setup</h3>
            <ol>
              <li>Install the Home Assistant companion app on your phone and allow it to report location.</li>
              <li>
                In Home Assistant, create a dedicated non-admin user for Aurboda: a long-lived token is not
                scoped, so it can do whatever its user can.
              </li>
              <li>Log in as that user and create a long-lived access token (profile, Security).</li>
              <li>Enter the Home Assistant URL and the token above and save.</li>
              <li>Pick the phone’s device_tracker (or your person) as the tracker entity.</li>
            </ol>
            <p>
              See the{' '}
              <a href={DOCS_URL} target="_blank" rel="noopener noreferrer">
                documentation
              </a>{' '}
              for details.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
