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

interface SourceInfo {
  name: string
  path: string
  dataTypes: string
  isConnected: boolean
  statusText: string
}

function SourceCard({ source }: { source: SourceInfo }) {
  return (
    <a href={source.path} class={`source-card ${source.isConnected ? 'connected' : 'not-connected'}`}>
      <div class="source-card-header">
        <span class={`status-dot ${source.isConnected ? 'connected' : 'not-connected'}`} />
        <h3>{source.name}</h3>
      </div>
      <p class="data-types">{source.dataTypes}</p>
      <p class={`source-status-text ${source.isConnected ? 'connected' : 'not-connected'}`}>
        {source.statusText}
      </p>
    </a>
  )
}

// eslint-disable-next-line complexity -- multiple data source checks
export function DataSources() {
  const isLoggedIn = auth.value.token

  const end = endOfDay(new Date())
  const start7days = startOfDay(subDays(new Date(), 7))

  const settingsQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: fetchUserSettings,
    queryKey: ['userSettings'],
    staleTime: 5 * 60 * 1000,
  })

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

  const productivityQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchProductivity(start7days, end),
    queryKey: ['productivity7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

  const locationsQuery = useQuery({
    enabled: !!isLoggedIn,
    queryFn: () => fetchPlaces(start7days, end),
    queryKey: ['locations7days', formatISO(start7days, { representation: 'date' })],
    staleTime: 5 * 60 * 1000,
  })

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
  const isGarminConnected = settingsQuery.data?.garmin_connected ?? false
  const isRescueTimeConfigured = !!settingsQuery.data?.rescue_time_key
  const hasLastfm = !!settingsQuery.data?.lastfm_username
  const hasCalendars = (settingsQuery.data?.calendars ?? []).length > 0
  const awProductivity = (productivityQuery.data ?? []).filter((r) => r.source === 'activitywatch')
  const hasAwDesktop = awProductivity.some((r) => !r.is_mobile)
  const hasAwMobile = awProductivity.some((r) => r.is_mobile)

  // Aurboda native: has data if user has manually added anything (HR, exercise, or sleep from Android)
  const hasAndroidData = hasHeartRate || hasSleep || hasExercise

  if (!isLoggedIn) {
    return (
      <div class="data-sources-page">
        <h1>Data Sources</h1>
        <p>Please log in to see your data sources and setup guides.</p>
        <a href="/login" class="external-link" style={{ display: 'inline-block', marginTop: '1rem' }}>
          Log in
        </a>
      </div>
    )
  }

  const sources: SourceInfo[] = [
    {
      dataTypes: 'Tags, custom metrics, manual data entry, goals',
      isConnected: true,
      name: 'Aurboda (Web / API / MCP)',
      path: '/data-sources/aurboda',
      statusText: 'Always available',
    },
    {
      dataTypes: 'Heart rate, HRV, sleep, exercise, steps, weight, and more via Health Connect',
      isConnected: hasAndroidData,
      name: 'Aurboda Android',
      path: '/data-sources/android-app',
      statusText: hasAndroidData ? 'Data detected in the last 7 days' : 'No data from Android app yet',
    },
    {
      dataTypes: 'Sleep scores, readiness, resilience, HRV, cardiovascular age, tags',
      isConnected: isOuraConnected,
      name: 'Oura Ring',
      path: '/data-sources/oura',
      statusText: isOuraConnected ? 'Connected' : 'Not connected',
    },
    {
      dataTypes: 'Sleep, stress, body battery, HR, HRV, activities, SpO2, training readiness',
      isConnected: isGarminConnected,
      name: 'Garmin Connect',
      path: '/data-sources/garmin',
      statusText: isGarminConnected ? 'Connected' : 'Not connected',
    },
    {
      dataTypes: 'App and window usage on desktop',
      isConnected: hasAwDesktop,
      name: 'ActivityWatch (Desktop)',
      path: '/data-sources/activitywatch-desktop',
      statusText: hasAwDesktop ? 'Desktop data syncing' : 'Not set up',
    },
    {
      dataTypes: 'App usage on Android',
      isConnected: hasAwMobile,
      name: 'ActivityWatch (Android)',
      path: '/data-sources/activitywatch-android',
      statusText: hasAwMobile ? 'Mobile data syncing' : 'Not set up',
    },
    {
      dataTypes: 'App and website usage, productivity scores',
      isConnected: isRescueTimeConfigured && hasProductivity,
      name: 'RescueTime',
      path: '/data-sources/rescue-time',
      statusText:
        isRescueTimeConfigured && hasProductivity
          ? 'Data syncing'
          : isRescueTimeConfigured
            ? 'Configured, no recent data'
            : 'Not configured',
    },
    {
      dataTypes: 'Music scrobbles, auto-generated tags from listening',
      isConnected: hasLastfm,
      name: 'Last.fm',
      path: '/data-sources/lastfm',
      statusText: hasLastfm ? 'Connected' : 'Not configured',
    },
    {
      dataTypes: 'GPS location, visited places',
      isConnected: hasLocations,
      name: 'OwnTracks',
      path: '/data-sources/owntracks',
      statusText: hasLocations ? 'Location data detected' : 'Not set up',
    },
    {
      dataTypes: 'Calendar events imported as tags',
      isConnected: hasCalendars,
      name: 'Calendars (ICS)',
      path: '/data-sources/calendars',
      statusText: hasCalendars
        ? `${settingsQuery.data?.calendars?.length} calendar(s) configured`
        : 'No calendars added',
    },
  ]

  return (
    <div class="data-sources-page">
      <div class="page-header">
        <h1>Data Sources</h1>
        <p class="page-subtitle">
          Aurboda aggregates health, productivity, and location data from multiple sources. Connect your data
          sources below to start tracking. Each source has its own setup and configuration.
        </p>
      </div>

      {isLoading && <div class="loading">Checking your data sources...</div>}

      <div class="sources-grid">
        {sources.map((source) => (
          <SourceCard key={source.path} source={source} />
        ))}
      </div>

      <section class="getting-started-tips">
        <h2>Tips</h2>
        <ul>
          <li>
            <strong>Getting started:</strong> Install the Aurboda Android app for heart rate, sleep, and
            exercise data via Health Connect. Then add more sources as needed.
          </li>
          <li>
            <strong>Screen time:</strong> Use ActivityWatch (desktop or mobile) or RescueTime to track app and
            website usage. Both feed into the Screen Time view.
          </li>
          <li>
            <strong>AI analysis:</strong> Once you have data, you can use Claude or other MCP-compatible AI
            assistants to analyze your health trends.
          </li>
          <li>
            <strong>Goals:</strong> Set up weekly goals in the Aurboda (Web/API) data source page to track
            your progress toward health targets.
          </li>
        </ul>
      </section>
    </div>
  )
}
