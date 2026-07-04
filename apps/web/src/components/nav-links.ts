// Primary nav (top of the sidebar), the Sharing group, then the secondary nav.
// The three sharing surfaces (feed, shared dashboards, challenges) are grouped
// under one collapsible "Sharing" section (see Sidebar/Header) instead of being
// three flat siblings, so "Share" stops being an ambiguous top-level label.

export const NAV_LINKS_PRIMARY = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/goals', label: 'Goals', icon: '🎯' },
  { href: '/timeline', label: 'Timeline', icon: '📅' },
  { href: '/data', label: 'Data', icon: '📊' },
  { href: '/meals', label: 'Meals', icon: '🍽' },
  { href: '/reports', label: 'Reports', icon: '📝' },
  { href: '/add', label: '+ Add', icon: '➕' },
  { href: '/chart', label: 'Chart', icon: '📈' },
]

/** The three sharing surfaces, grouped under the "Sharing" section. */
export const SHARING_LINKS = [
  { href: '/feed', label: 'Feed', icon: '📣' },
  { href: '/shared-dashboards', label: 'Dashboards', icon: '🔆' },
  { href: '/challenges', label: 'Challenges', icon: '🏆' },
]

/** Routes that make the "Sharing" section count as active. */
export const SHARING_PATHS = SHARING_LINKS.map((l) => l.href)

/** Whether the current URL is within the Sharing section (a surface or a sub-route of one). */
export const isSharingActive = (url: string): boolean =>
  SHARING_PATHS.some((p) => url === p || url.startsWith(`${p}/`))

export const NAV_LINKS_SECONDARY = [
  { href: '/correlations', label: 'Analyze', icon: '🔬' },
  { href: '/places', label: 'Places', icon: '📍' },
  { href: '/activity-types', label: 'Types', icon: '🏷' },
  { href: '/deduction-rules', label: 'Rules', icon: '🔗' },
]

export const DATA_SOURCE_LINKS = [
  { label: 'Overview', path: '/data-sources', icon: '📡' },
  { label: 'Aurboda (Web / API)', path: '/data-sources/aurboda' },
  { label: 'Aurboda Android', path: '/data-sources/android-app' },
  { label: 'Oura Ring', path: '/data-sources/oura' },
  { label: 'Garmin Connect', path: '/data-sources/garmin' },
  { label: 'Strava', path: '/data-sources/strava' },
  { label: 'ActivityWatch (Desktop)', path: '/data-sources/activitywatch-desktop' },
  { label: 'ActivityWatch (Android)', path: '/data-sources/activitywatch-android' },
  { label: 'RescueTime', path: '/data-sources/rescue-time' },
  { label: 'Last.fm', path: '/data-sources/lastfm' },
  { label: 'OwnTracks', path: '/data-sources/owntracks' },
  { label: 'Calendars', path: '/data-sources/calendars' },
]
