import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { useState } from 'preact/hooks'

import { fetchProductivity, generateApiToken } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const DATA_TYPES = ['App usage (desktop)', 'Window titles', 'Per-device tracking', 'Productivity categories']

export function ActivityWatchDesktopSource() {
  const isLoggedIn = auth.value.token

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  const productivityQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchProductivity(start7days, end),
    queryKey: ['productivity7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const awProductivity = (productivityQuery.data ?? []).filter(
    (r) => r.source === 'activitywatch' && !r.is_mobile,
  )
  const hasData = awProductivity.length > 0

  // Token generation
  const [activityWatchToken, setActivityWatchToken] = useState<string>('')
  const [tokenStatus, setTokenStatus] = useState<'idle' | 'loading' | 'copied'>('idle')

  const handleGenerateToken = async () => {
    setTokenStatus('loading')
    try {
      const token = await generateApiToken()
      setActivityWatchToken(token)
      setTokenStatus('idle')
    } catch {
      setTokenStatus('idle')
    }
  }

  const handleCopyToken = () => {
    if (!activityWatchToken) return
    navigator.clipboard.writeText(activityWatchToken).then(() => {
      setTokenStatus('copied')
      setTimeout(() => setTokenStatus('idle'), 2000)
    })
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
        <h1>ActivityWatch (Desktop)</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://activitywatch.net" target="_blank" rel="noopener noreferrer">
            ActivityWatch
          </a>{' '}
          is an open-source, privacy-first activity tracker for your desktop. It records which applications
          and websites you use, and a push agent script sends that data to Aurboda for analysis and
          categorization.
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

        <div class={`status-banner ${hasData ? 'connected' : 'not-connected'}`}>
          <span class={`status-dot ${hasData ? 'connected' : 'not-connected'}`} />
          {hasData ? 'Desktop screen time data syncing' : 'ActivityWatch desktop not set up'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/activitywatch.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            Setup guide (push agent)
          </a>
          <a
            href="https://activitywatch.net/"
            target="_blank"
            rel="noopener noreferrer"
            class="external-link"
          >
            ActivityWatch website
          </a>
        </div>

        {!hasData && (
          <div class="setup-instructions">
            <h3>Setup</h3>
            <ol>
              <li>Install ActivityWatch on your computer from the ActivityWatch website.</li>
              <li>Generate an API token below.</li>
              <li>
                Set up the push agent script to sync data to Aurboda. See the setup guide for detailed
                instructions.
              </li>
            </ol>
          </div>
        )}

        <section class="settings-section">
          <h2>API Token</h2>
          <p class="section-description">
            The push agent needs your Aurboda API token. Generate one and paste it into the agent config.
          </p>
          <div class="activitywatch-token-section">
            <div class="token-actions">
              <button
                type="button"
                class="connect-button"
                onClick={handleGenerateToken}
                disabled={tokenStatus === 'loading'}
              >
                {tokenStatus === 'loading' ? 'Generating...' : 'Generate API Token'}
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
                  <button type="button" class="connect-button" onClick={handleCopyToken}>
                    {tokenStatus === 'copied' ? 'Copied!' : 'Copy'}
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
        </section>
      </div>
    </div>
  )
}
