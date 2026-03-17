import { useQuery } from '@tanstack/react-query'
import { endOfDay, formatISO, startOfDay, subDays } from 'date-fns'

import {
  fetchActivities,
  fetchActivityWatchStatus,
  fetchHeartRate,
  fetchPlaces,
  fetchProductivity,
  fetchUserSettings,
} from '../../state/api'
import { auth } from '../../state/auth'
import './style.css'

interface DataSourceStatus {
  hasData: boolean
  isConfigured?: boolean
  description: string
}

function StatusIcon({ hasData }: { hasData: boolean }) {
  if (hasData) {
    return (
      <span class="status-icon connected" title="Data detected">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14" />
          <path d="M22 4L12 14.01l-3-3" />
        </svg>
      </span>
    )
  }
  return (
    <span class="status-icon missing" title="No recent data">
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
        <circle cx="12" cy="12" r="10" />
        <line x1="12" y1="8" x2="12" y2="12" />
        <line x1="12" y1="16" x2="12.01" y2="16" />
      </svg>
    </span>
  )
}

function DataSourceCard({
  name,
  status,
  setupSteps,
  links,
}: {
  name: string
  status: DataSourceStatus
  setupSteps: string[]
  links?: { text: string; url: string }[]
}) {
  return (
    <div class={`data-source-card ${status.hasData ? 'has-data' : 'no-data'}`}>
      <div class="card-header">
        <StatusIcon hasData={status.hasData} />
        <h3>{name}</h3>
      </div>
      <p class="card-description">{status.description}</p>
      {!status.hasData && (
        <div class="setup-section">
          <h4>Setup</h4>
          <ol class="setup-steps">
            {setupSteps.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ol>
          {links && links.length > 0 && (
            <div class="links">
              {links.map((link, i) => (
                <a key={i} href={link.url} target="_blank" rel="noopener noreferrer">
                  {link.text}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// eslint-disable-next-line complexity -- TODO: refactor
export function Help() {
  const isLoggedIn = auth.value.token

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  // Fetch user settings to check configuration status
  const settingsQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch heart rate data (from Health Connect or other sources)
  const heartRateQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchHeartRate(start7days, end),
    queryKey: ['heartRate7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch sleep data
  const sleepQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchActivities(start7days, end, ['sleep']),
    queryKey: ['sleep7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch exercise data
  const exerciseQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchActivities(start7days, end, ['exercise']),
    queryKey: ['exercise7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch productivity data (RescueTime)
  const productivityQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchProductivity(start7days, end),
    queryKey: ['productivity7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch location data (OwnTracks)
  const locationsQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPlaces(start7days, end),
    queryKey: ['locations7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  // Fetch ActivityWatch sync status (distinct from RescueTime)
  const awStatusQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchActivityWatchStatus,
    queryKey: ['awStatus'],
    staleTime: 5 * 60 * 1000,
  })

  const isLoading =
    heartRateQuery.isLoading ||
    sleepQuery.isLoading ||
    exerciseQuery.isLoading ||
    productivityQuery.isLoading ||
    locationsQuery.isLoading ||
    settingsQuery.isLoading ||
    awStatusQuery.isLoading

  const hasHeartRate = (heartRateQuery.data?.length ?? 0) > 0
  const hasSleep = (sleepQuery.data?.length ?? 0) > 0
  const hasExercise = (exerciseQuery.data?.length ?? 0) > 0
  const hasProductivity = (productivityQuery.data?.length ?? 0) > 0
  const hasLocations = (locationsQuery.data?.length ?? 0) > 0
  const isOuraConnected = settingsQuery.data?.oura_connected ?? false
  const isRescueTimeConfigured = !!settingsQuery.data?.rescue_time_key
  const hasActivityWatch = (awStatusQuery.data?.length ?? 0) > 0
  const awProductivity = (productivityQuery.data ?? []).filter((r) => r.source === 'activitywatch')
  const hasAwDesktop = awProductivity.some((r) => !r.is_mobile)
  const hasAwMobile = awProductivity.some((r) => r.is_mobile)

  if (!isLoggedIn) {
    return (
      <div class="help-page">
        <h1>Getting Started</h1>
        <p class="login-prompt">Please log in to see your data source status and setup guides.</p>
        <a href="/login" class="login-link">
          Log in
        </a>
      </div>
    )
  }

  return (
    <div class="help-page">
      <div class="page-header">
        <h1>Getting Started</h1>
        <p class="page-subtitle">
          Connect your data sources to start tracking. Below you can see which sources are active and how to
          set up any that are missing.
        </p>
      </div>

      {isLoading && <div class="loading">Checking your data sources...</div>}

      <section class="data-sources">
        <h2>Data Sources</h2>

        <div class="sources-grid">
          <DataSourceCard
            name="Heart Rate & HRV"
            status={{
              description: hasHeartRate
                ? 'Heart rate data detected in the last 7 days.'
                : 'No heart rate data in the last 7 days.',
              hasData: hasHeartRate,
            }}
            setupSteps={[
              'Install the Aurboda Android app on your phone.',
              'Grant Health Connect permissions in the app.',
              'Connect a Bluetooth heart rate monitor (e.g., Polar H10) for real-time tracking.',
              'Alternatively, connect Oura for resting heart rate and HRV data.',
            ]}
            links={[
              {
                text: 'Download Android APK',
                url: 'https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk',
              },
            ]}
          />

          <DataSourceCard
            name="Sleep Tracking"
            status={{
              description: hasSleep
                ? 'Sleep data detected in the last 7 days.'
                : 'No sleep data in the last 7 days.',
              hasData: hasSleep,
              isConfigured: isOuraConnected,
            }}
            setupSteps={[
              'Connect your Oura Ring via Settings > Data Sources.',
              'Or use the Android app with Health Connect if you track sleep with another app.',
              'Sleep data includes duration, sleep stages, and sleep scores (Oura).',
            ]}
            links={[{ text: 'Go to Settings', url: '/settings' }]}
          />

          <DataSourceCard
            name="Exercise & Activities"
            status={{
              description: hasExercise
                ? 'Exercise data detected in the last 7 days.'
                : 'No exercise data in the last 7 days.',
              hasData: hasExercise,
            }}
            setupSteps={[
              'Use the Aurboda Android app to sync workouts from Health Connect.',
              'Connect a Bluetooth heart rate monitor for real-time HR zone tracking during workouts.',
              'Workouts recorded in Strava, Garmin, or other apps can sync via Health Connect.',
            ]}
            links={[
              {
                text: 'Download Android APK',
                url: 'https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk',
              },
            ]}
          />

          <DataSourceCard
            name="Oura Ring"
            status={{
              description: isOuraConnected
                ? 'Oura Ring is connected.'
                : 'Oura Ring not connected. Connect for sleep scores, readiness, and HRV.',
              hasData: isOuraConnected,
            }}
            setupSteps={[
              'Go to Settings > Data Sources.',
              'Click "Connect Oura" to authorize access.',
              'Data syncs automatically after connection.',
            ]}
            links={[
              { text: 'Go to Settings', url: '/settings' },
              { text: 'Learn about Oura', url: 'https://ouraring.com/' },
            ]}
          />

          <DataSourceCard
            name="Location Tracking (OwnTracks)"
            status={{
              description: hasLocations
                ? 'Location data detected in the last 7 days.'
                : 'No location data in the last 7 days.',
              hasData: hasLocations,
            }}
            setupSteps={[
              'Install OwnTracks on your phone (iOS or Android).',
              'Configure it in HTTP mode pointing to your Aurboda server.',
              'Set up authentication with your Aurboda credentials.',
              'See the OwnTracks setup guide for detailed instructions.',
            ]}
            links={[
              {
                text: 'OwnTracks Setup Guide',
                url: 'https://github.com/fiddur/aurboda/blob/develop/docs/owntracks.md',
              },
              { text: 'OwnTracks Website', url: 'https://owntracks.org/' },
            ]}
          />
        </div>
      </section>

      <section class="data-sources">
        <h2>Screen Time</h2>
        <p class="section-description">
          Track which apps and websites you use. Data from both sources is combined into the Screen Time
          column in the Day view.
        </p>

        <div class="sources-grid">
          <DataSourceCard
            name="RescueTime"
            status={{
              description:
                isRescueTimeConfigured && hasProductivity
                  ? 'Screen time data detected in the last 7 days.'
                  : isRescueTimeConfigured
                    ? 'RescueTime configured but no recent data synced.'
                    : 'RescueTime not configured.',
              hasData: isRescueTimeConfigured && hasProductivity,
              isConfigured: isRescueTimeConfigured,
            }}
            setupSteps={[
              'Sign up for RescueTime and install their app on your devices.',
              'Get your API key from RescueTime API settings.',
              'Enter the API key in Settings > Data Sources.',
            ]}
            links={[
              { text: 'Go to Settings', url: '/settings' },
              { text: 'RescueTime API Settings', url: 'https://www.rescuetime.com/anapi/manage' },
            ]}
          />

          <DataSourceCard
            name="ActivityWatch (Desktop)"
            status={{
              description: hasAwDesktop
                ? 'Desktop screen time data syncing.'
                : hasActivityWatch
                  ? 'ActivityWatch syncing, but no desktop data in the last 7 days.'
                  : 'ActivityWatch desktop not set up.',
              hasData: hasAwDesktop,
            }}
            setupSteps={[
              'Install ActivityWatch on your computer.',
              'Generate an API token in Settings.',
              'Set up the push agent script to sync data to Aurboda.',
            ]}
            links={[
              { text: 'Go to Settings', url: '/settings' },
              {
                text: 'Setup Guide',
                url: 'https://github.com/fiddur/aurboda/blob/develop/docs/activitywatch.md',
              },
              { text: 'ActivityWatch Website', url: 'https://activitywatch.net/' },
            ]}
          />

          <DataSourceCard
            name="ActivityWatch (Mobile)"
            status={{
              description: hasAwMobile
                ? 'Mobile screen time data syncing.'
                : 'ActivityWatch mobile not set up.',
              hasData: hasAwMobile,
            }}
            setupSteps={[
              'Install ActivityWatch for Android from GitHub.',
              'Install the Aurboda Android app.',
              'Enable "ActivityWatch Sync" in Aurboda\'s Sync tab.',
            ]}
            links={[
              {
                text: 'ActivityWatch for Android',
                url: 'https://github.com/ActivityWatch/aw-android/releases',
              },
              {
                text: 'Download Aurboda APK',
                url: 'https://github.com/fiddur/aurboda/releases/download/latest/aurboda.apk',
              },
            ]}
          />
        </div>
      </section>

      <section class="quick-tips">
        <h2>Tips</h2>
        <ul>
          <li>
            <strong>Real-time heart rate:</strong> Connect a Bluetooth heart rate monitor (like Polar H10) via
            the Android app's Live screen for accurate HR zone tracking during workouts.
          </li>
          <li>
            <strong>Step counting:</strong> Pair a running pod (like Zwift RunPod) for real-time cadence and
            step counting, or sync steps from Health Connect.
          </li>
          <li>
            <strong>AI analysis:</strong> Once you have data, you can use Claude or other MCP-compatible AI
            assistants to analyze your health trends.
          </li>
          <li>
            <strong>Goals:</strong> Set up weekly goals in Settings to track your progress toward health
            targets.
          </li>
        </ul>
      </section>
    </div>
  )
}
