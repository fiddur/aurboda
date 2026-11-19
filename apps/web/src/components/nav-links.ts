// Primary nav (top of the sidebar), the Sharing group, then the secondary nav.
// The three sharing surfaces (feed, dashboards, challenges) are grouped
// under one collapsible "Sharing" section (see Sidebar/Header) instead of being
// three flat siblings, so "Share" stops being an ambiguous top-level label.

export const NAV_LINKS_PRIMARY = [
  { href: '/', label: 'Home', icon: '🏠' },
  {
    href: '/goals',
    label: 'Goals',
    icon: '🎯',
    description: 'Targets for sleep, steps and more, and how you are doing.',
  },
  {
    href: '/timeline',
    label: 'Timeline',
    icon: '📅',
    description: 'Your day, week or month on one scrolling line.',
  },
  {
    href: '/data',
    label: 'Data',
    icon: '📊',
    description: 'Every metric and activity you have, to browse and edit.',
  },
  {
    href: '/meals',
    label: 'Meals',
    icon: '🍽',
    description: 'Log what you eat and see calories and nutrients.',
  },
  {
    href: '/reports',
    label: 'Reports',
    icon: '📝',
    description: 'Lab results and other values you enter by hand.',
  },
  { href: '/add', label: '+ Add', icon: '➕', description: 'Add an activity, a metric or a note.' },
  { href: '/chart', label: 'Chart', icon: '📈', description: 'Draw any of your data over time.' },
]

export const SHARING_LINKS = [
  { href: '/feed', label: 'Feed', icon: '📣', description: 'Posts from you and the people you follow.' },
  {
    href: '/dashboards',
    label: 'Dashboards',
    icon: '🔆',
    description: 'Public pages that show chosen parts of your data.',
  },
  {
    href: '/challenges',
    label: 'Challenges',
    icon: '🏆',
    description: 'Compete with friends, here or on other servers.',
  },
]

export const SHARING_PATHS = SHARING_LINKS.map((l) => l.href)

export const isSharingActive = (url: string): boolean =>
  SHARING_PATHS.some((p) => url === p || url.startsWith(`${p}/`))

export const NAV_LINKS_SECONDARY = [
  {
    href: '/correlations',
    label: 'Analyze',
    icon: '🔬',
    description: 'Find out what goes together, like exercise and sleep.',
  },
  {
    href: '/training-load',
    label: 'Training load',
    icon: '💪',
    description: 'Fitness, fatigue and form from your workouts.',
  },
  {
    href: '/places',
    label: 'Places',
    icon: '📍',
    description: 'A map of where you have been, and your named places.',
  },
  {
    href: '/routes',
    label: 'Routes',
    icon: '🗺',
    description: 'The ways you run, walk or ride again and again.',
  },
  { href: '/segments', label: 'Segments', icon: '⏱', description: 'Stretches of road with your best times.' },
  {
    href: '/activity-types',
    label: 'Types',
    icon: '🏷',
    description: 'The kinds of activity you log, with their icons and fields.',
  },
  {
    href: '/deduction-rules',
    label: 'Rules',
    icon: '🔗',
    description: 'Create activities from your data automatically.',
  },
]

export const DATA_SOURCE_LINKS = [
  {
    label: 'Overview',
    path: '/data-sources',
    icon: '📡',
    description: 'Every source at a glance, and how to connect one.',
  },
  {
    label: 'Aurboda (Web / API)',
    path: '/data-sources/aurboda',
    description: 'Send data from scripts and AI assistants.',
  },
  {
    label: 'Aurboda Android',
    path: '/data-sources/android-app',
    description: 'Health Connect data from your phone.',
  },
  {
    label: 'Oura Ring',
    path: '/data-sources/oura',
    description: 'Sleep, readiness and heart rate from Oura.',
  },
  {
    label: 'Garmin',
    path: '/data-sources/garmin',
    description: 'Workouts, sleep and health data from Garmin.',
  },
  { label: 'Strava', path: '/data-sources/strava', description: 'Workouts from Strava.' },
  { label: 'Gravl', path: '/data-sources/gravl', description: 'Strength workouts from Gravl.' },
  {
    label: 'ActivityWatch (Desktop)',
    path: '/data-sources/activitywatch-desktop',
    description: 'Time spent in apps on your computer.',
  },
  {
    label: 'ActivityWatch (Android)',
    path: '/data-sources/activitywatch-android',
    description: 'Time spent in apps on your phone.',
  },
  { label: 'RescueTime', path: '/data-sources/rescue-time', description: 'Screen time from RescueTime.' },
  { label: 'Last.fm', path: '/data-sources/lastfm', description: 'The music you listen to.' },
  {
    label: 'OwnTracks',
    path: '/data-sources/owntracks',
    description: 'Your location from the OwnTracks app.',
  },
  {
    label: 'Home Assistant',
    path: '/data-sources/home-assistant',
    description: 'Your location from Home Assistant.',
  },
  { label: 'Calendars', path: '/data-sources/calendars', description: 'Events from your calendars.' },
]

export const HELP_LINK = { href: '/help', label: 'Help & support', icon: '❓' }

/** Pages that only the Android app's More tab lists; on the web they are reached from other pages. */
export const APP_ONLY_LINKS = [
  {
    href: '/reminders',
    label: 'Reminders',
    description: 'Your recurring reminders, under Inbox in the app.',
  },
  { href: '/audit-log', label: 'Audit log', description: 'Recent syncs, imports and errors.' },
]

/** Menu paths that are never hidden, whatever `hidden_pages` says; everything under `/admin` too. */
export const MENU_ALWAYS_SHOWN = ['/', '/settings', '/help', '/notifications', '/admin'] as const

const isAlwaysShown = (path: string): boolean =>
  (MENU_ALWAYS_SHOWN as readonly string[]).includes(path) || path.startsWith('/admin/')

type MenuLink = { href: string } | { path: string }

const linkPath = (link: MenuLink): string => ('href' in link ? link.href : link.path)

export const isPageHidden = (path: string, hidden: readonly string[]): boolean =>
  !isAlwaysShown(path) && hidden.includes(path)

export const visibleLinks = <T extends MenuLink>(links: readonly T[], hidden: readonly string[]): T[] =>
  links.filter((link) => !isPageHidden(linkPath(link), hidden))

export interface MenuSwitch {
  path: string
  label: string
  description: string
}

export interface MenuSwitchGroup {
  id: string
  label: string
  switches: MenuSwitch[]
}

const toSwitches = (links: readonly ({ label: string; description?: string } & MenuLink)[]): MenuSwitch[] =>
  links
    .filter((link) => !isAlwaysShown(linkPath(link)))
    .map((link) => ({
      description: link.description ?? '',
      label: link.label.replace(/^\+\s*/, ''),
      path: linkPath(link),
    }))

/** The pages the Settings → Menu section offers a switch for, grouped as the menus show them. */
export const menuSwitches = (): MenuSwitchGroup[] => [
  { id: 'main', label: 'Main', switches: toSwitches(NAV_LINKS_PRIMARY) },
  { id: 'sharing', label: 'Sharing', switches: toSwitches(SHARING_LINKS) },
  { id: 'more', label: 'More', switches: toSwitches(NAV_LINKS_SECONDARY) },
  { id: 'data-sources', label: 'Data sources', switches: toSwitches(DATA_SOURCE_LINKS) },
  { id: 'app', label: 'Only in the Android app', switches: toSwitches(APP_ONLY_LINKS) },
]

/** `hidden` with `path` added or removed, keeping every other entry (unknown paths included). */
export const toggleHiddenPage = (hidden: readonly string[], path: string, show: boolean): string[] =>
  show ? hidden.filter((p) => p !== path) : hidden.includes(path) ? [...hidden] : [...hidden, path]

const OTHER_PAGE_TITLES = [
  { href: '/shared-dashboards', label: 'Dashboards' },
  { href: '/data-sources', label: 'Data Sources' },
  { href: '/settings', label: 'Settings' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/strength', label: 'Strength session' },
  { href: '/strength/plan', label: 'Strength plan' },
  HELP_LINK,
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
  ...APP_ONLY_LINKS,
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
