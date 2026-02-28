import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useState } from 'preact/hooks'
import { LastFmTagRulesSettings } from '../../components/LastFmTagRulesSettings'
import { fetchUserSettings, type UpdateSettingsInput, updateUserSettings } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

type SaveStatus = { status: 'idle' | 'saving' | 'saved' | 'error'; error?: string }

const DATA_TYPES = ['Music scrobbles', 'Auto-generated tags from listening rules']

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

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <p>Please log in to view data source settings.</p>
      </div>
    )
  }

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
          syncs your scrobbles and can automatically create tags based on what you listen to — for example,
          tagging when you do vocal exercises or meditate with specific music.
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

        <div class={`status-banner ${isConfigured ? 'connected' : 'not-connected'}`}>
          <span class={`status-dot ${isConfigured ? 'connected' : 'not-connected'}`} />
          {isConfigured ? `Connected as ${userSettings?.lastfm_username}` : 'Not configured'}
        </div>

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
              {saveStatus.status === 'saving' && <span class="save-indicator saving">Saving...</span>}
              {saveStatus.status === 'saved' && <span class="save-indicator saved">Saved</span>}
              {saveStatus.status === 'error' && <span class="save-indicator error">{saveStatus.error}</span>}
            </div>
            {userSettings?.lastfm_configured === false ?
              <p class="field-description warning">
                Last.fm API key is not configured on the server. Ask your administrator to configure the
                Last.fm API key in Admin Settings.
              </p>
            : <div class="form-field">
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
            }
          </section>
        )}
      </div>

      <LastFmTagRulesSettings />
    </div>
  )
}
