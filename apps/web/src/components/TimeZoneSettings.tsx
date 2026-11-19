import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { fetchUserSettings, updateUserSettings } from '../state/api'
import { auth } from '../state/auth'
import { browserTimezone } from '../utils/browserTimezone'
import { type SaveStatus, SaveStatusIndicator } from './SaveStatusIndicator'
import { SettingsSection } from './SettingsSection'
import { supportedTimezones, timeZoneSettingsView } from './time-zone-settings'

const SECTION_ID = 'time-zone'

export function TimeZoneSettings() {
  const queryClient = useQueryClient()
  const { data: settings } = useQuery({
    enabled: Boolean(auth.value.token),
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })
  const [status, setStatus] = useState<SaveStatus>({ status: 'idle' })
  const scrolled = useRef(false)
  const supported = useMemo(supportedTimezones, [])
  const view = timeZoneSettingsView(settings?.tz ?? null, browserTimezone(), supported)

  useEffect(() => {
    if (scrolled.current || settings === undefined || window.location.hash !== `#${SECTION_ID}`) return
    scrolled.current = true
    document.getElementById(SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [settings])

  const save = async (tz: string | null) => {
    setStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings({ tz })
      queryClient.setQueryData(['userSettings'], result)
      setStatus({ status: 'saved', time: new Date() })
    } catch (err) {
      setStatus({ error: err instanceof Error ? err.message : 'Failed to save', status: 'error' })
    }
  }

  return (
    <SettingsSection
      id={SECTION_ID}
      title="Time zone"
      description="Reminders and daily figures follow this time zone. The Android app updates it from the phone when it syncs."
      headerExtra={<SaveStatusIndicator state={status} />}
    >
      <div class="form-field">
        <label for="time-zone-select">Time zone</label>
        <select
          id="time-zone-select"
          value={view.selected}
          onChange={(e) => void save(view.toSave((e.target as HTMLSelectElement).value))}
        >
          {view.options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>
      {view.browserOffer && (
        <button type="button" class="btn-secondary" onClick={() => void save(view.browserOffer)}>
          Use this browser&apos;s time zone ({view.browserOffer})
        </button>
      )}
    </SettingsSection>
  )
}
