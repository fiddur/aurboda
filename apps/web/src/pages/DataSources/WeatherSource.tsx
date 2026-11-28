import type { ProviderSyncStatus, SyncWeatherBody } from '@aurboda/api-spec'

import { useQuery, useQueryClient } from '@tanstack/react-query'
import axios from 'axios'
import { useCallback, useState } from 'preact/hooks'

import { fetchUserSettings, fetchWeatherSyncStatus, syncWeather, updateUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { apiErrorText } from '../../utils/profile'
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
import { invalidateSourceQueries } from './sourceQueries'
import './style.css'
import { refetchWhileSyncing } from './syncPolling'
import { weatherSyncMessage } from './weatherSync'

const DATA_TYPES: DataTypeItem[] = [
  { label: 'Weather condition (WMO code)' },
  { label: 'Outdoor temperature' },
  { label: 'Precipitation' },
  { label: 'Wind speed' },
]

const WEATHER_DEFAULT_INTERVAL_MINUTES = 180

const DOCS_URL = 'https://github.com/fiddur/aurboda/blob/develop/docs/open-meteo.md'

const errorText = (err: unknown, fallback: string): string =>
  axios.isAxiosError(err)
    ? apiErrorText((err.response?.data as { error?: unknown } | undefined)?.error, err.message)
    : err instanceof Error
      ? err.message
      : fallback

function WeatherToggleSection({ enabled }: { enabled: boolean }) {
  const queryClient = useQueryClient()
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })
  const [saving, setSaving] = useState<boolean | null>(null)
  const checked = saving ?? enabled

  const save = async (next: boolean) => {
    setSaving(next)
    setSaveStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ weather_enabled: next })
      await invalidateSourceQueries(queryClient, result)
      setSaveStatus({ status: 'saved' })
    } catch (err) {
      setSaveStatus({ error: errorText(err, 'Failed to save'), status: 'error' })
    } finally {
      setSaving(null)
    }
  }

  return (
    <section class="settings-section">
      <div class="section-header-row">
        <h2>Weather</h2>
        <SaveStatusIndicator state={saveStatus} />
      </div>
      <div class="form-field">
        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={checked}
            onChange={(e) => void save((e.target as HTMLInputElement).checked)}
          />
          <span>Fetch the weather where I was</span>
        </label>
        <p class="field-description">
          Nothing is fetched while this is off. Turning it off keeps the weather already stored.
        </p>
      </div>
    </section>
  )
}

function WeatherSyncSection({
  syncStates,
  syncStatusLoading,
}: {
  syncStates: ProviderSyncStatus[] | undefined
  syncStatusLoading: boolean
}) {
  const queryClient = useQueryClient()
  const [syncStatus, setSyncStatus] = useState<'idle' | 'syncing' | 'done' | 'error'>('idle')
  const [syncMessage, setSyncMessage] = useState('')
  const [olderFrom, setOlderFrom] = useState('')

  const runSync = useCallback(
    async (body: SyncWeatherBody) => {
      setSyncStatus('syncing')
      setSyncMessage('')
      try {
        const { result } = await syncWeather(body)
        setSyncStatus(result?.status === 'success' ? 'done' : 'error')
        setSyncMessage(result ? weatherSyncMessage(result) : 'Sync failed')
        await queryClient.invalidateQueries({ queryKey: ['weatherSyncStatus'] })
      } catch (err) {
        setSyncStatus('error')
        setSyncMessage(errorText(err, 'Sync failed'))
      }
    },
    [queryClient],
  )

  const handleSyncNow = useCallback(() => runSync({}), [runSync])

  return (
    <section class="settings-section">
      <SyncStatusBar states={syncStates} isLoading={syncStatusLoading} onSyncNow={handleSyncNow} />
      <div class="form-field">
        <label for="weather-older-from">Fetch older history from</label>
        <div class="garmin-button-row">
          <input
            id="weather-older-from"
            type="date"
            value={olderFrom}
            onInput={(e) => setOlderFrom((e.target as HTMLInputElement).value)}
          />
          <button
            type="button"
            class="connect-button"
            disabled={!olderFrom || syncStatus === 'syncing'}
            onClick={() => void runSync({ start_date: olderFrom })}
          >
            {syncStatus === 'syncing' ? 'Fetching...' : 'Fetch'}
          </button>
        </div>
        <p class="field-description">
          The first sync covers the last 90 days. Pick an earlier date to fetch the weather of older location
          history too.
        </p>
      </div>
      {syncMessage && <p class={`garmin-sync-message ${syncStatus}`}>{syncMessage}</p>}
    </section>
  )
}

export function WeatherSource() {
  const isLoggedIn = auth.value.token

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const enabled = userSettings?.weather_enabled ?? false

  const { data: syncStatusData, isLoading: syncStatusLoading } = useQuery({
    enabled: !!isLoggedIn && enabled,
    queryFn: fetchWeatherSyncStatus,
    queryKey: ['weatherSyncStatus'],
    refetchInterval: (query) => refetchWhileSyncing(query.state.data),
  })

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="page page--full data-sources-page">
      <div class="page-header">
        <h1>Weather</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          Aurboda can look up the hourly weather where you were, from your location history (OwnTracks, Home
          Assistant or activity GPS), so a day or an activity can show the weather it had. Only your
          coordinates rounded to 0.1° (about 11 km) are sent to Open-Meteo, never your exact position.
        </p>

        <DataTypesList types={DATA_TYPES} />
        <StatusBanner connected={enabled} label={enabled ? 'Weather is on' : 'Weather is off'} />

        <div class="links-row">
          <a href={DOCS_URL} target="_blank" rel="noopener noreferrer" class="doc-link">
            Weather documentation
          </a>
        </div>

        {isLoading ? (
          <div class="loading">Loading...</div>
        ) : (
          <>
            <WeatherToggleSection enabled={enabled} />
            {enabled && (
              <WeatherSyncSection syncStates={syncStatusData?.states} syncStatusLoading={syncStatusLoading} />
            )}
            <SyncIntervalField provider="weather" defaultMinutes={WEATHER_DEFAULT_INTERVAL_MINUTES} />
          </>
        )}

        <p class="field-description">
          <a href="https://open-meteo.com/" target="_blank" rel="noopener noreferrer">
            Weather data by Open-Meteo.com
          </a>{' '}
          (
          <a href="https://creativecommons.org/licenses/by/4.0/" target="_blank" rel="noopener noreferrer">
            CC BY 4.0
          </a>
          ), free for non-commercial use.
        </p>
      </div>
    </div>
  )
}
