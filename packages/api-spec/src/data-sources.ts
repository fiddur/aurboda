/**
 * Data source catalog.
 *
 * Single source of truth for the list of data sources Aurboda ingests. Rendered
 * by the web landing page and used to generate the data-source tables in
 * `README.md` and `docs/data-sources.md` (via `pnpm generate:docs`), so the
 * three surfaces cannot drift apart.
 *
 * When adding or changing a data source, edit this list and run
 * `pnpm --filter @aurboda/api-spec generate:docs`.
 */

export interface DataSourceInfo {
  /** Display name, e.g. "Oura Ring". */
  name: string
  /** External homepage, linked from the source name on the web landing page. */
  homepage?: string
  /** Docs page slug under `docs/`, e.g. "oura.md". Linked from the name in README/docs. */
  doc?: string
  /** Short "what it provides" summary. */
  provides: string
  /** Short "how it syncs" summary. */
  how: string
  /** What the server admin must configure (docs table only). Defaults to "None". */
  adminSetup?: string
  /** What each user must do to connect (docs table only). */
  userSetup?: string
}

export const dataSources: DataSourceInfo[] = [
  {
    name: 'Android Health Connect',
    doc: 'health-connect.md',
    provides:
      'Heart rate, HRV, sleep, exercise (80+ types), steps, weight, SpO2, VO2 max, calories, and more',
    how: 'Push from Android app',
    adminSetup: 'None',
    userSetup: 'Install Android app',
  },
  {
    name: 'BLE Sensors',
    provides: 'Real-time heart rate, HRV (Polar H10, etc.) and steps (Zwift RunPod, etc.)',
    how: 'Live via Android app',
    adminSetup: 'None',
    userSetup: 'Pair sensor in Android app',
  },
  {
    name: 'Oura Ring',
    homepage: 'https://ouraring.com/',
    doc: 'oura.md',
    provides:
      'Sleep stages/scores, readiness, resilience, cardiovascular age, HRV, heart rate, meditation, tags',
    how: 'Pull (API) + Push (webhooks)',
    adminSetup: 'OAuth credentials (env vars)',
    userSetup: 'OAuth connect',
  },
  {
    name: 'Garmin Connect',
    homepage: 'https://connect.garmin.com/',
    doc: 'garmin.md',
    provides:
      'Daily summary, HR, HRV, sleep, stress, body battery, activities, SpO2, respiration, training readiness',
    how: 'Pull (session-based)',
    adminSetup: 'None',
    userSetup: 'Garmin credentials',
  },
  {
    name: 'Strava',
    homepage: 'https://www.strava.com/',
    doc: 'strava.md',
    provides: 'Activities with per-second heart rate, GPS routes, cadence, and power',
    how: 'Pull (API) + Push (webhooks)',
    adminSetup: 'OAuth credentials (admin)',
    userSetup: 'OAuth connect',
  },
  {
    name: 'OwnTracks',
    homepage: 'https://owntracks.org/',
    doc: 'owntracks.md',
    provides: 'GPS locations, geofences, place visits',
    how: 'Push (HTTP mode)',
    adminSetup: 'None',
    userSetup: 'OwnTracks app config',
  },
  {
    name: 'RescueTime',
    homepage: 'https://www.rescuetime.com/',
    doc: 'rescuetime.md',
    provides: 'App/website usage, productivity scores, categories',
    how: 'Pull (API)',
    adminSetup: 'None',
    userSetup: 'API key',
  },
  {
    name: 'ActivityWatch',
    homepage: 'https://activitywatch.net/',
    doc: 'activitywatch.md',
    provides: 'App/window usage per device (desktop and Android)',
    how: 'Push (agent script)',
    adminSetup: 'None',
    userSetup: 'Install AW + push agent or enable in Aurboda Android app',
  },
  {
    name: 'Last.fm',
    homepage: 'https://www.last.fm/',
    doc: 'lastfm.md',
    provides: 'Music scrobbles with auto-generated tags from configurable rules',
    how: 'Pull (API)',
    adminSetup: 'API key (admin setting)',
    userSetup: 'Last.fm username',
  },
  {
    name: 'Calendars (ICS)',
    doc: 'calendars.md',
    provides: 'Calendar events imported as tags (Google Calendar, Outlook, iCloud, Nextcloud, etc.)',
    how: 'Pull (ICS fetch)',
    adminSetup: 'None',
    userSetup: 'ICS URL(s)',
  },
  {
    name: 'Cronometer',
    homepage: 'https://cronometer.com/',
    provides: 'Meals with full per-item macros and ~50 micronutrients',
    how: 'CSV import',
    adminSetup: 'None',
    userSetup: 'Export CSV from Cronometer',
  },
  {
    name: 'Livsmedelsverket',
    doc: 'livsmedelsverket.md',
    provides: 'Canonical food library: 2,500+ Swedish foods with macros + micros (per 100 g)',
    how: 'One-shot bulk import (UI button)',
    adminSetup: 'None',
    userSetup: 'Click "Import from Livsmedelsverket" on /food-items',
  },
  {
    name: 'Manual Entry',
    provides: 'Any metric, tag, activity, meal, or note',
    how: 'Web UI, REST API, or MCP',
    adminSetup: 'None',
    userSetup: '—',
  },
]
