import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'preact/hooks'
import { API_URL } from '../../config'
import { fetchUserSettings, HrZoneThresholds, updateUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { defaultHrZoneThresholds } from '../../utils/hrZones'
import { computeSettingsUpdateParams, parseZoneValue, updateZoneThreshold } from '../../utils/settings'

import './style.css'

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
  const [hasChanges, setHasChanges] = useState(false)

  // Initialize form when data loads
  const initializeForm = () => {
    setBirthDate(userSettings?.birth_date ?? '')
    setHrZones(userSettings?.hr_zone_start ?? null)
    setRescueTimeKey(userSettings?.rescue_time_key ?? '')
    setHasChanges(false)
  }

  // Reset form to server values
  const handleReset = () => {
    initializeForm()
  }

  // Track if form has been initialized
  const [initialized, setInitialized] = useState(false)
  if (userSettings && !initialized) {
    initializeForm()
    setInitialized(true)
  }

  const mutation = useMutation({
    mutationFn: updateUserSettings,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['userSettings'] })
      setHasChanges(false)
    },
  })

  const handleBirthDateChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    setBirthDate(value)
    setHasChanges(true)
  }

  const handleZoneChange = (zone: keyof HrZoneThresholds, value: string) => {
    const numValue = parseZoneValue(value)
    if (numValue === null) return

    setHrZones(updateZoneThreshold(hrZones, zone, numValue))
    setHasChanges(true)
  }

  const handleResetZones = () => {
    setHrZones(null)
    setHasChanges(true)
  }

  const handleRescueTimeKeyChange = (e: Event) => {
    const value = (e.target as HTMLInputElement).value
    setRescueTimeKey(value)
    setHasChanges(true)
  }

  const handleSave = () => {
    const params = computeSettingsUpdateParams(birthDate, hrZones, rescueTimeKey, userSettings)
    if (params) {
      mutation.mutate(params)
    }
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
        <h2>Personal Information</h2>
        <div class="form-field">
          <label for="birth-date">Birth Date</label>
          <input id="birth-date" type="date" value={birthDate} onChange={handleBirthDateChange} />
          <p class="field-description">
            Used to calculate age-based HR zone thresholds if custom zones are not set.
          </p>
        </div>
      </section>

      <section class="settings-section">
        <h2>Data Sources</h2>

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
          <input
            id="rescuetime-key"
            type="password"
            value={rescueTimeKey}
            onInput={handleRescueTimeKeyChange}
            placeholder="Enter your RescueTime API key"
          />
          <p class="field-description">
            Get your API key from{' '}
            <a href="https://www.rescuetime.com/anapi/manage" target="_blank" rel="noopener noreferrer">
              RescueTime API settings
            </a>
            . Used to sync productivity data.
          </p>
        </div>
      </section>

      <section class="settings-section">
        <h2>HR Zone Thresholds</h2>
        <p class="section-description">
          Customize the heart rate thresholds for each zone. These values represent the starting BPM for each
          zone.
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

      {mutation.isError && (
        <p class="error">
          Error saving settings: {mutation.error instanceof Error ? mutation.error.message : 'Unknown error'}
        </p>
      )}

      {mutation.isSuccess && <p class="success">Settings saved successfully.</p>}

      <div class="button-group">
        <button type="button" onClick={handleReset} disabled={!hasChanges || mutation.isPending}>
          Cancel
        </button>
        <button
          type="button"
          class="primary"
          onClick={handleSave}
          disabled={!hasChanges || mutation.isPending}
        >
          {mutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </div>
  )
}
