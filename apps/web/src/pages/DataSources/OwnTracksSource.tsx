import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { fetchPlaces } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

const DATA_TYPES = ['GPS location', 'Visited places', 'Geofence regions']

export function OwnTracksSource() {
  const isLoggedIn = auth.value.token

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  const locationsQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPlaces(start7days, end),
    queryKey: ['locations7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const hasLocations = (locationsQuery.data?.length ?? 0) > 0

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
        <h1>OwnTracks</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          <a href="https://owntracks.org/" target="_blank" rel="noopener noreferrer">
            OwnTracks
          </a>{' '}
          is a privacy-focused location tracker for iOS and Android. It sends your GPS location to Aurboda in
          HTTP mode, allowing you to track where you spend time, correlate locations with health data, and
          view your movement on the Places page.
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

        <div class={`status-banner ${hasLocations ? 'connected' : 'not-connected'}`}>
          <span class={`status-dot ${hasLocations ? 'connected' : 'not-connected'}`} />
          {hasLocations ? 'Location data detected in the last 7 days' : 'No location data in the last 7 days'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/owntracks.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            OwnTracks setup guide
          </a>
          <a href="https://owntracks.org/" target="_blank" rel="noopener noreferrer" class="external-link">
            OwnTracks website
          </a>
        </div>

        {!hasLocations && (
          <div class="setup-instructions">
            <h3>Setup</h3>
            <ol>
              <li>Install OwnTracks on your phone (iOS or Android).</li>
              <li>Configure it in HTTP mode pointing to your Aurboda server.</li>
              <li>Set up authentication with your Aurboda credentials.</li>
              <li>See the setup guide above for detailed instructions.</li>
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
