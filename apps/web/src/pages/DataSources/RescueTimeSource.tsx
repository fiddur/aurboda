import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useState } from 'preact/hooks'
import { ScreentimeCategoriesSettings } from '../../components/ScreentimeCategoriesSettings'
import {
  fetchProductivity,
  fetchUserSettings,
  type UpdateSettingsInput,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }

const DATA_TYPES = ['App usage', 'Website usage', 'Productivity scores', 'Time spent per category']

export function RescueTimeSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const productivityQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchProductivity(start7days, end),
    queryKey: ['productivity7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const hasProductivity = (productivityQuery.data?.length ?? 0) > 0
  const isConfigured = !!userSettings?.rescue_time_key

  const [rescueTimeKey, setRescueTimeKey] = useState<string>('')
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

  const handleRescueTimeKeyBlur = () => {
    if (!rescueTimeKey) return
    saveSection({ rescue_time_key: rescueTimeKey }, setSaveStatus)
    setRescueTimeKey('')
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
        <h1>RescueTime</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://www.rescuetime.com/" target="_blank" rel="noopener noreferrer">
            RescueTime
          </a>{' '}
          tracks which apps and websites you use across your devices and provides productivity scores. Aurboda
          pulls your data periodically via the RescueTime API.
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

        <div class={`status-banner ${isConfigured && hasProductivity ? 'connected' : 'not-connected'}`}>
          <span class={`status-dot ${isConfigured && hasProductivity ? 'connected' : 'not-connected'}`} />
          {isConfigured && hasProductivity ?
            'Screen time data syncing'
          : isConfigured ?
            'RescueTime configured but no recent data synced'
          : 'RescueTime not configured'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/rescuetime.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            RescueTime integration documentation
          </a>
          <a
            href="https://www.rescuetime.com/anapi/manage"
            target="_blank"
            rel="noopener noreferrer"
            class="external-link"
          >
            RescueTime API settings
          </a>
        </div>

        {!isLoading && (
          <section class="settings-section">
            <div class="section-header-row">
              <h2>API Key</h2>
              {saveStatus.status === 'saving' && <span class="save-indicator saving">Saving...</span>}
              {saveStatus.status === 'saved' && <span class="save-indicator saved">Saved</span>}
              {saveStatus.status === 'error' && <span class="save-indicator error">{saveStatus.error}</span>}
            </div>
            {isConfigured && <p class="connected-status">Configured</p>}
            <div class="form-field">
              <input
                type="password"
                value={rescueTimeKey}
                onInput={(e) => setRescueTimeKey((e.target as HTMLInputElement).value)}
                onBlur={handleRescueTimeKeyBlur}
                placeholder={isConfigured ? 'Enter new key to update' : 'Enter your RescueTime API key'}
              />
              <p class="field-description">
                Get your API key from{' '}
                <a href="https://www.rescuetime.com/anapi/manage" target="_blank" rel="noopener noreferrer">
                  RescueTime API settings
                </a>
                . Saves automatically when you leave the field.
              </p>
            </div>
          </section>
        )}
      </div>

      <ScreentimeCategoriesSettings />
    </div>
  )
}
