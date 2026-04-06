import { useQuery, useQueryClient } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useCallback, useState } from 'preact/hooks'

import {
  fetchProductivity,
  fetchUserSettings,
  type UpdateSettingsInput,
  updateUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
import { DataTypesList, LoginRequired, type SaveStatus, SaveStatusIndicator, StatusBanner } from './shared'
import './style.css'

const DATA_TYPES = ['App usage', 'Website usage', 'Productivity scores', 'Time spent per category']

function getStatusLabel(isConfigured: boolean, hasProductivity: boolean): string {
  if (isConfigured && hasProductivity) return 'Screen time data syncing'
  if (isConfigured) return 'RescueTime configured but no recent data synced'
  return 'RescueTime not configured'
}

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

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
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

        <DataTypesList types={DATA_TYPES} />
        <StatusBanner
          connected={isConfigured && hasProductivity}
          label={getStatusLabel(isConfigured, hasProductivity)}
        />

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
              <SaveStatusIndicator state={saveStatus} />
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

      <section class="settings-section">
        <a href="/screentime-categories" class="manage-link">
          Manage screentime categories
        </a>
      </section>
    </div>
  )
}
