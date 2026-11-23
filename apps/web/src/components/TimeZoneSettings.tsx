import type { UpdateSettingsInput } from '@aurboda/api-spec'

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
  const view = timeZoneSettingsView(
    settings?.tz ?? null,
    browserTimezone(),
    supported,
    settings?.tz_follows_device ?? true,
  )
  const { browserOffer } = view

  useEffect(() => {
    if (scrolled.current || settings === undefined || window.location.hash !== `#${SECTION_ID}`) return
    scrolled.current = true
    document.getElementById(SECTION_ID)?.scrollIntoView({ block: 'start' })
  }, [settings])

  const save = async (update: UpdateSettingsInput) => {
    setStatus({ status: 'saving' })
    try {
      const result = await updateUserSettings(update)
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
      description="Reminders and daily figures follow this time zone."
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
      <div class="form-field">
        <label class="checkbox-field">
          <input
            type="checkbox"
            checked={view.followsDevice}
            onChange={(e) => void save(view.followToSave((e.target as HTMLInputElement).checked))}
          />
          <span>Use my phone&apos;s time zone</span>
        </label>
        <p class="field-description">
          The Android app sets your time zone from the phone each time it syncs.
        </p>
      </div>
      {browserOffer && (
        <button type="button" class="btn-secondary" onClick={() => void save(view.toSave(browserOffer))}>
          Use this browser&apos;s time zone ({browserOffer})
        </button>
      )}
    </SettingsSection>
  )
}
