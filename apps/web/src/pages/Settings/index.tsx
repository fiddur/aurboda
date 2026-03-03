import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import { TimelineIconsSettings } from '../../components/TimelineIconsSettings'
import { fetchUserSettings, HrZoneThresholds, UpdateSettingsInput, updateUserSettings } from '../../state/api'
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

  // Save status for each section
  const [birthDateStatus, setBirthDateStatus] = useState<SaveStatus>({ status: 'idle' })
  const [hrZonesStatus, setHrZonesStatus] = useState<SaveStatus>({ status: 'idle' })

  // Initialize form when data loads
  const initializeForm = () => {
    setBirthDate(userSettings?.birth_date ?? '')
    setHrZones(userSettings?.hr_zone_start ?? null)
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

      <TimelineIconsSettings />

      <section class="settings-section">
        <p class="section-description">
          Data source settings (Oura, RescueTime, Last.fm, ActivityWatch, Calendars) and related configuration
          (screen time categories, tag mappings, custom metrics, goals) have moved to{' '}
          <a href="/data-sources">Data Sources</a>.
        </p>
      </section>
    </div>
  )
}
