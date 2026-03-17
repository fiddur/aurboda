import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'

import { ScreentimeCategoriesSettings } from '../../components/ScreentimeCategoriesSettings'
import { fetchProductivity } from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

const DATA_TYPES = ['App usage (mobile)', 'Per-app screen time', 'Productivity categories']

export function ActivityWatchAndroidSource() {
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
    (r) => r.source === 'activitywatch' && r.is_mobile,
  )
  const hasData = awProductivity.length > 0

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
        <h1>ActivityWatch (Android)</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://activitywatch.net" target="_blank" rel="noopener noreferrer">
            ActivityWatch for Android
          </a>{' '}
          tracks which apps you use on your phone. The Aurboda Android app acts as a companion, syncing
          ActivityWatch data to your Aurboda server automatically.
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
          {hasData ? 'Mobile screen time data syncing' : 'ActivityWatch mobile not set up'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/ActivityWatch/aw-android/releases"
            target="_blank"
            rel="noopener noreferrer"
            class="external-link"
          >
            ActivityWatch for Android
          </a>
          <a
            href="https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk"
            class="external-link"
          >
            Download Aurboda APK
          </a>
        </div>

        {!hasData && (
          <div class="setup-instructions">
            <h3>Setup</h3>
            <ol>
              <li>
                Install{' '}
                <a
                  href="https://github.com/ActivityWatch/aw-android/releases"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  ActivityWatch for Android
                </a>{' '}
                from GitHub.
              </li>
              <li>Install the Aurboda Android app.</li>
              <li>In the Aurboda app, go to the Sync tab and enable &quot;ActivityWatch Sync&quot;.</li>
            </ol>
          </div>
        )}
      </div>

      <ScreentimeCategoriesSettings />
    </div>
  )
}
