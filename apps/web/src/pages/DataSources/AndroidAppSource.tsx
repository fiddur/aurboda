import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'
import { fetchActivities, fetchHeartRate } from '../../state/api'
import { auth } from '../../state/auth'

import './style.css'

const DATA_TYPES = [
  'Heart rate',
  'HRV',
  'Weight',
  'Body composition',
  'Steps',
  'Sleep',
  'Exercise',
  'Blood pressure',
  'Blood glucose',
  'Body temperature',
  'Oxygen saturation',
  'Respiratory rate',
  '40+ Health Connect record types',
]

export function AndroidAppSource() {
  const isLoggedIn = auth.value.token

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  const heartRateQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchHeartRate(start7days, end),
    queryKey: ['heartRate7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const sleepQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchActivities(start7days, end, ['sleep']),
    queryKey: ['sleep7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const exerciseQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchActivities(start7days, end, ['exercise']),
    queryKey: ['exercise7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const hasHeartRate = (heartRateQuery.data?.length ?? 0) > 0
  const hasSleep = (sleepQuery.data?.length ?? 0) > 0
  const hasExercise = (exerciseQuery.data?.length ?? 0) > 0
  const hasData = hasHeartRate || hasSleep || hasExercise

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
        <h1>Aurboda Android</h1>
      </div>

      <div class="data-source-detail">
        <p class="source-description">
          The Aurboda Android app syncs health data from your phone using{' '}
          <a
            href="https://developer.android.com/health-and-fitness/guides/health-connect"
            target="_blank"
            rel="noopener noreferrer"
          >
            Health Connect
          </a>
          . Any app that writes to Health Connect (Strava, Garmin, Samsung Health, etc.) will have its data
          forwarded to Aurboda. The Android app also supports real-time Bluetooth heart rate monitoring and
          can sync ActivityWatch mobile data.
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
          {hasData ? 'Data detected in the last 7 days' : 'No data from the Android app in the last 7 days'}
        </div>

        <div class="links-row">
          <a
            href="https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk"
            class="external-link"
          >
            Download Android APK
          </a>
          <a
            href="https://github.com/fiddur/aurboda/blob/develop/docs/health-connect.md"
            target="_blank"
            rel="noopener noreferrer"
            class="doc-link"
          >
            Health Connect documentation
          </a>
        </div>

        {!hasData && (
          <div class="setup-instructions">
            <h3>Setup</h3>
            <ol>
              <li>Download and install the Aurboda APK on your Android phone.</li>
              <li>Open the app and log in with your Aurboda credentials.</li>
              <li>Grant Health Connect permissions when prompted.</li>
              <li>
                For real-time heart rate monitoring, connect a Bluetooth heart rate monitor (e.g. Polar H10)
                from the app&apos;s Live screen.
              </li>
              <li>
                Workouts recorded in Strava, Garmin, or other apps will sync automatically via Health Connect.
              </li>
            </ol>
          </div>
        )}
      </div>
    </div>
  )
}
