import type { CalendarConfig } from '@aurboda/api-spec'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import { fetchUserSettings, type UpdateSettingsInput, updateUserSettings } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }

const DATA_TYPES = ['Calendar events (imported as tags)', 'Event titles and times']

export function CalendarsSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const hasCalendars = (userSettings?.calendars ?? []).length > 0

  const [newCalendarName, setNewCalendarName] = useState('')
  const [newCalendarUrl, setNewCalendarUrl] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  const saveSection = useCallback(
    async (params: UpdateSettingsInput, setStatus: (s: SaveStatus) => void) => {
      setStatus({ status: 'saving' })
      try {
        const result = await updateUserSettings(params)
        queryClient.setQueryData(['userSettings'], result)
        setStatus({ status: 'saved' })
      } catch (err) {
        setStatus({
          error: err instanceof Error ? err.message : 'Failed to save',
          status: 'error',
        })
      }
    },
    [queryClient],
  )

  const handleAddCalendar = () => {
    if (!newCalendarName.trim() || !newCalendarUrl.trim()) return

    const currentCalendars: CalendarConfig[] = userSettings?.calendars ?? []
    const updatedCalendars = [
      ...currentCalendars,
      { name: newCalendarName.trim(), url: newCalendarUrl.trim() },
    ]
    saveSection({ calendars: updatedCalendars }, setSaveStatus)
    setNewCalendarName('')
    setNewCalendarUrl('')
  }

  const handleRemoveCalendar = (index: number) => {
    const currentCalendars: CalendarConfig[] = userSettings?.calendars ?? []
    const updatedCalendars = currentCalendars.filter((_, i) => i !== index)
    saveSection({ calendars: updatedCalendars }, setSaveStatus)
  }

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view data source settings.</p>
      </div>
    )
  }

  return (
    <div class="data-sources-page">
      <a href="/data-sources" class="back-link">
        &larr; All Data Sources
      </a>

      <div class="page-header">
        <h1>Calendars (ICS)</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          Add calendar ICS URLs to import calendar events as tags. Events appear in trends and correlation
          analysis, allowing you to see how meetings, appointments, and other scheduled events correlate with
          your health data.
        </p>

        <div class="data-types-section">
          <h2>Data provided</h2>
          <div class="data-types-list">
            {DATA_TYPES.map((dt) => (
              <span key={dt} class="data-type-badge">
                {dt}
              </span>
            ))}
          </div>
        </div>

        <div class={`status-banner ${hasCalendars ? 'connected' : 'not-connected'}`}>
          <span class={`status-dot ${hasCalendars ? 'connected' : 'not-connected'}`} />
          {hasCalendars ? `${userSettings?.calendars?.length} calendar(s) configured` : 'No calendars added'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/calendars.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            Calendar integration documentation
          </a>
        </div>

        {!isLoading && (
          <section class="settings-section">
            <div class="section-header-row">
              <h2>Calendars</h2>
              {saveStatus.status === 'saving' && <span class="save-indicator saving">Saving...</span>}
              {saveStatus.status === 'saved' && <span class="save-indicator saved">Saved</span>}
              {saveStatus.status === 'error' && <span class="save-indicator error">{saveStatus.error}</span>}
            </div>

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
              For Google Calendar: Go to Settings &gt; calendar &gt; Integrate calendar &gt; copy the
              &quot;Secret address in iCal format&quot; URL.
            </p>
          </section>
        )}
      </div>
    </div>
  )
}
