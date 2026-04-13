import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'

import { fetchUserSettings, type UpdateSettingsInput, updateUserSettings } from '../../state/api'
import { auth } from '../../state/auth'
import { DataTypesList, LoginRequired, type SaveStatus, SaveStatusIndicator, StatusBanner } from './shared'
import './style.css'

const DATA_TYPES = ['Music scrobbles']

export function LastFmSource() {
  const isLoggedIn = auth.value.token
  const queryClient = useQueryClient()

  const { data: userSettings, isLoading } = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
  })

  const isConfigured = !!userSettings?.lastfm_username

  const [lastfmUsername, setLastfmUsername] = useState<string>('')
  const [initialized, setInitialized] = useState(false)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>({ status: 'idle' })

  if (userSettings && !initialized) {
    setLastfmUsername(userSettings.lastfm_username ?? '')
    setInitialized(true)
  }

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

  const handleLastfmUsernameBlur = () => {
    const serverValue = userSettings?.lastfm_username ?? ''
    if (lastfmUsername === serverValue) return
    saveSection({ lastfm_username: lastfmUsername || null }, setSaveStatus)
  }

  if (!isLoggedIn) return <LoginRequired />

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Last.fm</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://www.last.fm/" target="_blank" rel="noopener noreferrer">
            Last.fm
          </a>{' '}
          (Audioscrobbler) tracks your music listening across Spotify, Apple Music, and other players. Aurboda
          syncs your scrobbles. Use deduction rules with scrobble conditions to automatically create
          activities from what you listen to.
        </p>

        <DataTypesList types={DATA_TYPES} />
        <StatusBanner
          connected={isConfigured}
          label={isConfigured ? `Connected as ${userSettings?.lastfm_username}` : 'Not configured'}
        />

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/lastfm.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            Last.fm integration documentation
          </a>
        </div>

        {!isLoading && (
          <section class="settings-section">
            <div class="section-header-row">
              <h2>Username</h2>
              <SaveStatusIndicator state={saveStatus} />
            </div>
            {userSettings?.lastfm_configured === false ? (
              <p class="field-description warning">
                Last.fm API key is not configured on the server. Ask your administrator to configure the
                Last.fm API key in Admin Settings.
              </p>
            ) : (
              <div class="form-field">
                {isConfigured && <p class="connected-status">Configured</p>}
                <input
                  type="text"
                  value={lastfmUsername}
                  onInput={(e) => setLastfmUsername((e.target as HTMLInputElement).value)}
                  onBlur={handleLastfmUsernameBlur}
                  placeholder="Enter your Last.fm username"
                />
                <p class="field-description">
                  Enter your Last.fm username to sync scrobbles. Find your username on your{' '}
                  <a href="https://www.last.fm/user/_" target="_blank" rel="noopener noreferrer">
                    Last.fm profile
                  </a>
                  . Saves automatically when you leave the field.
                </p>
              </div>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
