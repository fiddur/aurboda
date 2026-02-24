import type { CalendarConfig } from '@aurboda/api-spec'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import { CustomMetricsSettings } from '../../components/CustomMetricsSettings'
import { GoalsSettings } from '../../components/GoalsSettings'
import { LastFmTagRulesSettings } from '../../components/LastFmTagRulesSettings'
import { TagMappingsSettings } from '../../components/TagMappingsSettings'
import { API_URL } from '../../config'
import {
  fetchUserSettings,
  generateApiToken,
  HrZoneThresholds,
  UpdateSettingsInput,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
import { defaultHrZoneThresholds } from '../../utils/hrZones'
import { parseZoneValue, updateZoneThreshold, validateHrZoneThresholds } from '../../utils/settings'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; time?: Date; error?: string }

const formatSavedTime = (time: Date): string => {
  const now = new Date()
  const diffSec = Math.floor((now.getTime() - time.getTime()) / 1000)
  if (diffSec < 5) return 'just now'
  if (diffSec < 60) return `${diffSec} seconds ago`
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} minute${diffMin > 1 ? 's' : ''} ago`
  return time.toLocaleTimeString()
}

function SaveStatusIndicator({ saveStatus }: { saveStatus: SaveStatus }) {
  if (saveStatus.status === 'idle') return null
  return (
    <span class={`save-indicator ${saveStatus.status}`}>
      {saveStatus.status === 'saving' && 'Saving...'}
      {saveStatus.status === 'saved' && saveStatus.time && `Saved ${formatSavedTime(saveStatus.time)}`}
      {saveStatus.status === 'error' && (saveStatus.error ?? 'Error saving')}
    </span>
  )
}

// eslint-disable-next-line complexity -- TODO: refactor
export function Settings() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  // Form state
  const [birthDate, setBirthDate] = useState<string>('')
  const [hrZones, setHrZones] = useState<HrZoneThresholds | null>(null)
  const [rescueTimeKey, setRescueTimeKey] = useState<string>('')
  const [lastfmUsername, setLastfmUsername] = useState<string>('')

  // Calendar form state
  const [newCalendarName, setNewCalendarName] = useState('')
  const [newCalendarUrl, setNewCalendarUrl] = useState('')

  // ActivityWatch push agent token
  const [activityWatchToken, setActivityWatchToken] = useState<string>('')
  const [activityWatchTokenStatus, setActivityWatchTokenStatus] = useState<'idle' | 'loading' | 'copied'>(
    'idle',
  )

  // Save status for each section
  const [birthDateStatus, setBirthDateStatus] = useState<SaveStatus>({ status: 'idle' })
  const [rescueTimeStatus, setRescueTimeStatus] = useState<SaveStatus>({ status: 'idle' })
  const [lastfmStatus, setLastfmStatus] = useState<SaveStatus>({ status: 'idle' })
  const [hrZonesStatus, setHrZonesStatus] = useState<SaveStatus>({ status: 'idle' })
  const [calendarsStatus, setCalendarsStatus] = useState<SaveStatus>({ status: 'idle' })

  // Initialize form when data loads
  const initializeForm = () => {
    setBirthDate(userSettings?.birth_date ?? '')
    setHrZones(userSettings?.hr_zone_start ?? null)
    setRescueTimeKey('')
    setLastfmUsername(userSettings?.lastfm_username ?? '')
  }

  // Track if form has been initialized
  const [initialized, setInitialized] = useState(false)
  if (userSettings && !initialized) {
    initializeForm()
    setInitialized(true)
  }

  // Generic save function for a section
  const saveSection = useCallback(
    async (params: UpdateSettingsInput, setStatus: (s: SaveStatus) => void) => {
      setStatus({ status: 'saving' })
      try {
        const result = await updateUserSettings(params)
        queryClient.setQueryData(['userSettings'], result)
        setStatus({ status: 'saved', time: new Date() })
      } catch (err) {
        setStatus({
          error: err instanceof Error ? err.message : 'Failed to save',
          status: 'error',
        })
      }
    },
    [queryClient],
  )

  const handleBirthDateChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    setBirthDate(value)
  }

  const handleBirthDateBlur = () => {
    const serverValue = userSettings?.birth_date ?? ''
    if (birthDate === serverValue) return

    // Validate format if not empty
    if (birthDate && !/^\d{4}-\d{2}-\d{2}$/.test(birthDate)) {
      setBirthDateStatus({ error: 'Invalid date format', status: 'error' })
      return
    }

    saveSection({ birth_date: birthDate || null }, setBirthDateStatus)
  }

  const handleZoneChange = (zone: keyof HrZoneThresholds, value: string) => {
    const numValue = parseZoneValue(value)
    if (numValue === null) return

    setHrZones(updateZoneThreshold(hrZones, zone, numValue))
  }

  const handleZoneBlur = () => {
    const currentZones = hrZones ?? defaultHrZoneThresholds
    const serverZones = userSettings?.hr_zone_start ?? defaultHrZoneThresholds

    if (JSON.stringify(currentZones) === JSON.stringify(serverZones)) return

    // Validate zones
    const validation = validateHrZoneThresholds(currentZones)
    if (!validation.valid) {
      setHrZonesStatus({ error: validation.error, status: 'error' })
      return
    }

    saveSection({ hr_zone_start: hrZones }, setHrZonesStatus)
  }

  const handleResetZones = () => {
    setHrZones(null)
    saveSection({ hr_zone_start: null }, setHrZonesStatus)
  }

  const handleRescueTimeKeyChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    setRescueTimeKey(value)
  }

  const handleRescueTimeKeyBlur = () => {
    if (!rescueTimeKey) return

    saveSection({ rescue_time_key: rescueTimeKey }, setRescueTimeStatus)
    setRescueTimeKey('')
  }

  const handleLastfmUsernameChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    setLastfmUsername(value)
  }

  const handleLastfmUsernameBlur = () => {
    const serverValue = userSettings?.lastfm_username ?? ''
    if (lastfmUsername === serverValue) return

    saveSection({ lastfm_username: lastfmUsername || null }, setLastfmStatus)
  }

  const handleAddCalendar = () => {
    if (!newCalendarName.trim() || !newCalendarUrl.trim()) return

    const currentCalendars: CalendarConfig[] = userSettings?.calendars ?? []
    const updatedCalendars = [
      ...currentCalendars,
      { name: newCalendarName.trim(), url: newCalendarUrl.trim() },
    ]
    saveSection({ calendars: updatedCalendars }, setCalendarsStatus)
    setNewCalendarName('')
    setNewCalendarUrl('')
  }

  const handleRemoveCalendar = (index: number) => {
    const currentCalendars: CalendarConfig[] = userSettings?.calendars ?? []
    const updatedCalendars = currentCalendars.filter((_, i) => i !== index)
    saveSection({ calendars: updatedCalendars }, setCalendarsStatus)
  }

  const handleGenerateActivityWatchToken = async () => {
    setActivityWatchTokenStatus('loading')
    try {
      const token = await generateApiToken()
      setActivityWatchToken(token)
      setActivityWatchTokenStatus('idle')
    } catch {
      setActivityWatchTokenStatus('idle')
    }
  }

  const handleCopyActivityWatchToken = () => {
    if (!activityWatchToken) return
    navigator.clipboard.writeText(activityWatchToken).then(() => {
      setActivityWatchTokenStatus('copied')
      setTimeout(() => setActivityWatchTokenStatus('idle'), 2000)
    })
  }

  const handleConnectOura = () => {
    // Redirect to Oura OAuth flow
    window.location.href = `${API_URL}/auth/connectOura`
  }

  if (!isLoggedIn) {
    return (
      <div class="settings-page">
        <h1>Settings</h1>
        <p>Please log in to view and edit your settings.</p>
      </div>
    )
  }

  if (isLoading) {
    return (
      <div class="settings-page">
        <h1>Settings</h1>
        <p class="loading">Loading...</p>
      </div>
    )
  }

  const displayZones = hrZones ?? defaultHrZoneThresholds

  return (
    <div class="settings-page">
      <h1>Settings</h1>

      <section class="settings-section">
        <div class="section-header-row">
          <h2>Personal Information</h2>
          <SaveStatusIndicator saveStatus={birthDateStatus} />
        </div>
        <div class="form-field">
          <label for="birth-date">Birth Date</label>
          <input
            id="birth-date"
            type="date"
            value={birthDate}
            onInput={handleBirthDateChange}
            onBlur={handleBirthDateBlur}
          />
          <p class="field-description">
            Used to calculate age-based HR zone thresholds if custom zones are not set.
          </p>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-header-row">
          <h2>Data Sources</h2>
          <SaveStatusIndicator saveStatus={rescueTimeStatus} />
        </div>

        <div class="form-field">
          <label>Oura Ring</label>
          {userSettings?.oura_connected ?
            <p class="connected-status">Connected</p>
          : userSettings?.oura_configured === false ?
            <button type="button" class="connect-button" disabled>
              Connect Oura
            </button>
          : <button type="button" class="connect-button" onClick={handleConnectOura}>
              Connect Oura
            </button>
          }
          {userSettings?.oura_configured === false ?
            <p class="field-description warning">
              Oura OAuth is not configured on the server. Ask your administrator to set up OURA_CLIENT and
              OURA_SECRET environment variables.
            </p>
          : <p class="field-description">Connect your Oura Ring to sync sleep scores, readiness, and more.</p>
          }
        </div>

        <div class="form-field">
          <label for="rescuetime-key">RescueTime API Key</label>
          {userSettings?.rescue_time_key ?
            <p class="connected-status">Configured</p>
          : null}
          <input
            id="rescuetime-key"
            type="password"
            value={rescueTimeKey}
            onInput={handleRescueTimeKeyChange}
            onBlur={handleRescueTimeKeyBlur}
            placeholder={
              userSettings?.rescue_time_key ? 'Enter new key to update' : 'Enter your RescueTime API key'
            }
          />
          <p class="field-description">
            Get your API key from{' '}
            <a href="https://www.rescuetime.com/anapi/manage" target="_blank" rel="noopener noreferrer">
              RescueTime API settings
            </a>
            . Used to sync productivity data. Saves automatically when you leave the field.
          </p>
        </div>

        <div class="form-field">
          <div class="field-header-row">
            <label for="lastfm-username">Last.fm Username</label>
            <SaveStatusIndicator saveStatus={lastfmStatus} />
          </div>
          {userSettings?.lastfm_username ?
            <p class="connected-status">Configured</p>
          : null}
          {userSettings?.lastfm_configured === false ?
            <p class="field-description warning">
              Last.fm API key is not configured on the server. Ask your administrator to configure the Last.fm
              API key in Admin Settings.
            </p>
          : <>
              <input
                id="lastfm-username"
                type="text"
                value={lastfmUsername}
                onInput={handleLastfmUsernameChange}
                onBlur={handleLastfmUsernameBlur}
                placeholder="Enter your Last.fm username"
              />
              <p class="field-description">
                Enter your Last.fm username to sync scrobbles and create auto-tags based on your listening
                history. Find your username on your{' '}
                <a href="https://www.last.fm/user/_" target="_blank" rel="noopener noreferrer">
                  Last.fm profile
                </a>
                .
              </p>
            </>
          }
        </div>
        <div class="form-field">
          <label>ActivityWatch</label>
          <p class="field-description">
            <a href="https://activitywatch.net" target="_blank" rel="noopener noreferrer">
              ActivityWatch
            </a>{' '}
            is an open-source, privacy-first activity tracker. Install it on your desktop and configure the
            push agent to sync your window activity to Aurboda. See{' '}
            <a href="https://docs.aurboda.net/activitywatch" target="_blank" rel="noopener noreferrer">
              the setup guide
            </a>{' '}
            for instructions.
          </p>
          <div class="activitywatch-token-section">
            <p class="field-description">
              The push agent needs your Aurboda API token. Generate one and paste it into the agent config.
            </p>
            <div class="token-actions">
              <button
                type="button"
                class="connect-button"
                onClick={handleGenerateActivityWatchToken}
                disabled={activityWatchTokenStatus === 'loading'}
              >
                {activityWatchTokenStatus === 'loading' ? 'Generating...' : 'Generate API Token'}
              </button>
              {activityWatchToken && (
                <>
                  <input
                    class="token-display"
                    type="text"
                    readOnly
                    value={activityWatchToken}
                    onClick={(e) => (e.target as HTMLInputElement).select()}
                  />
                  <button type="button" class="connect-button" onClick={handleCopyActivityWatchToken}>
                    {activityWatchTokenStatus === 'copied' ? 'Copied!' : 'Copy'}
                  </button>
                </>
              )}
            </div>
            {activityWatchToken && (
              <p class="field-description warning">
                Store this token securely — it grants access to your Aurboda account.
              </p>
            )}
          </div>
        </div>
      </section>

      <section class="settings-section">
        <div class="section-header-row">
          <h2>Calendars</h2>
          <SaveStatusIndicator saveStatus={calendarsStatus} />
        </div>
        <p class="section-description">
          Add calendar ICS URLs to correlate calendar events with your health data. Events will appear as tags
          in trends and correlation analysis.
        </p>

        {(userSettings?.calendars ?? []).length > 0 && (
          <div class="calendars-list">
            {(userSettings?.calendars ?? []).map((cal, index) => (
              <div class="calendar-item" key={`${cal.name}-${index}`}>
                <div class="calendar-info">
                  <span class="calendar-name">{cal.name}</span>
                  <span class="calendar-url">{cal.url}</span>
                </div>
                <button
                  type="button"
                  class="remove-calendar-button"
                  onClick={() => handleRemoveCalendar(index)}
                >
                  Remove
                </button>
              </div>
            ))}
          </div>
        )}

        <div class="add-calendar-form">
          <div class="form-field">
            <label for="calendar-name">Calendar Name</label>
            <input
              id="calendar-name"
              type="text"
              value={newCalendarName}
              onInput={(e) => setNewCalendarName((e.target as HTMLInputElement).value)}
              placeholder="e.g., Work, Personal"
            />
          </div>
          <div class="form-field">
            <label for="calendar-url">ICS URL</label>
            <input
              id="calendar-url"
              type="url"
              value={newCalendarUrl}
              onInput={(e) => setNewCalendarUrl((e.target as HTMLInputElement).value)}
              placeholder="https://calendar.google.com/calendar/ical/..."
            />
          </div>
          <button
            type="button"
            class="connect-button"
            onClick={handleAddCalendar}
            disabled={!newCalendarName.trim() || !newCalendarUrl.trim()}
          >
            Add Calendar
          </button>
        </div>

        <p class="field-description">
          For Google Calendar: Go to Settings &gt; calendar &gt; Integrate calendar &gt; copy the "Secret
          address in iCal format" URL.
        </p>
      </section>

      <section class="settings-section">
        <div class="section-header-row">
          <h2>HR Zone Thresholds</h2>
          <SaveStatusIndicator saveStatus={hrZonesStatus} />
        </div>
        <p class="section-description">
          Customize the heart rate thresholds for each zone. These values represent the starting BPM for each
          zone. Changes save automatically.
        </p>

        <div class="hr-zones-form">
          {([1, 2, 3, 4, 5] as const).map((zone) => (
            <div class="zone-input" key={zone}>
              <label for={`zone-${zone}`}>Zone {zone} starts at</label>
              <div class="input-with-unit">
                <input
                  id={`zone-${zone}`}
                  type="number"
                  min="40"
                  max="220"
                  value={displayZones[zone]}
                  onInput={(e) => handleZoneChange(zone, (e.target as HTMLInputElement).value)}
                  onBlur={handleZoneBlur}
                />
                <span class="unit">bpm</span>
              </div>
            </div>
          ))}
        </div>

        <button type="button" class="reset-zones-button" onClick={handleResetZones}>
          Reset to defaults
        </button>
        {hrZones === null && (
          <p class="field-description">Using default thresholds (or age-based if birth date is set).</p>
        )}
      </section>

      <CustomMetricsSettings />

      <LastFmTagRulesSettings />

      <GoalsSettings goals={userSettings?.goals ?? []} />

      <TagMappingsSettings />
    </div>
  )
}
