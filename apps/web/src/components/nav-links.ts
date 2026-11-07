// Primary nav (top of the sidebar), the Sharing group, then the secondary nav.
// The three sharing surfaces (feed, dashboards, challenges) are grouped
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

export const SHARING_LINKS = [
  { href: '/feed', label: 'Feed', icon: '📣' },
  { href: '/dashboards', label: 'Dashboards', icon: '🔆' },
  { href: '/challenges', label: 'Challenges', icon: '🏆' },
]

export const SHARING_PATHS = SHARING_LINKS.map((l) => l.href)

export const isSharingActive = (url: string): boolean =>
  SHARING_PATHS.some((p) => url === p || url.startsWith(`${p}/`))

export const NAV_LINKS_SECONDARY = [
  { href: '/correlations', label: 'Analyze', icon: '🔬' },
  { href: '/places', label: 'Places', icon: '📍' },
  { href: '/routes', label: 'Routes', icon: '🗺' },
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

const OTHER_PAGE_TITLES = [
  { href: '/shared-dashboards', label: 'Dashboards' },
  { href: '/data-sources', label: 'Data Sources' },
  { href: '/settings', label: 'Settings' },
  { href: '/admin', label: 'Admin' },
  { href: '/login', label: 'Login' },
  { href: '/signup', label: 'Sign up' },
]

const PAGE_TITLES: { href: string; title: string }[] = [
  ...NAV_LINKS_PRIMARY,
  ...SHARING_LINKS,
  ...NAV_LINKS_SECONDARY,
  ...DATA_SOURCE_LINKS.filter((l) => l.path !== '/data-sources').map((l) => ({
    href: l.path,
    label: l.label,
  })),
  ...OTHER_PAGE_TITLES,
].map((l) => ({ href: l.href, title: l.label.replace(/^\+\s*/, '') }))

/** The current page's name for the narrow top bar: the nav label of the route or its parent section. */
export const pageTitleForPath = (url: string): string => {
  const path = url.split(/[?#]/)[0].replace(/(.)\/+$/, '$1') || '/'
  const exact = PAGE_TITLES.find((p) => p.href === path)
  if (exact) return exact.title
  const section = PAGE_TITLES.filter((p) => p.href !== '/' && path.startsWith(`${p.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]
  return section?.title ?? 'Aurboda'
}
