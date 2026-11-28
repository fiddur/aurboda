import {
  APP_ONLY_LINKS,
  HELP_LINK,
  MENU_ALWAYS_SHOWN,
  NAV_SECTIONS,
  NAV_TOP_LINKS,
  type NavLink,
  type NavSectionId,
  type NavSection,
} from '@aurboda/api-spec'

export {
  APP_ONLY_LINKS,
  HELP_LINK,
  MENU_ALWAYS_SHOWN,
  NAV_SECTIONS,
  NAV_TOP_LINKS,
  NOTIFICATIONS_LINK,
  type NavLink,
  type NavSection,
  type NavSectionId,
  SETTINGS_LINK,
} from '@aurboda/api-spec'

export const MENU_PAGE_LINKS: NavLink[] = [
  ...NAV_TOP_LINKS,
  ...NAV_SECTIONS.flatMap((s) => s.links.filter((l) => !l.adminOnly)),
]

export const menuPath = (url: string): string => url.split(/[?#]/)[0].replace(/(.)\/+$/, '$1') || '/'

export const isLinkActive = (href: string, url: string): boolean => {
  const path = menuPath(url).replace(/^\/shared-dashboards(?=\/|$)/, '/dashboards')
  return path === href || (href !== '/' && path.startsWith(`${href}/`))
}

export const sectionForUrl = (url: string): NavSectionId | undefined =>
  NAV_SECTIONS.find((s) => s.links.some((l) => isLinkActive(l.href, url)))?.id

export const visibleSections = (hidden: readonly string[], isAdmin: boolean): NavSection[] =>
  NAV_SECTIONS.map((s) => ({
    ...s,
    links: visibleLinks(s.links, hidden).filter((l) => isAdmin || !l.adminOnly),
  })).filter((s) => s.links.length > 0)

const SECTION_IDS = NAV_SECTIONS.map((s) => s.id)

const isSectionId = (value: unknown): value is NavSectionId =>
  typeof value === 'string' && (SECTION_IDS as string[]).includes(value)

export const parseOpenSections = (raw: string | null): NavSectionId[] => {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    return Array.isArray(parsed) ? [...new Set(parsed.filter(isSectionId))] : []
  } catch {
    return []
  }
}

export const withSectionOpen = (open: readonly NavSectionId[], id: NavSectionId): NavSectionId[] =>
  open.includes(id) ? [...open] : [...open, id]

export const toggleSection = (open: readonly NavSectionId[], id: NavSectionId): NavSectionId[] =>
  open.includes(id) ? open.filter((s) => s !== id) : [...open, id]

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
  {
    label: 'Weather',
    path: '/data-sources/weather',
    description: 'The weather where you were, from Open-Meteo.',
  },
  { label: 'Calendars', path: '/data-sources/calendars', description: 'Events from your calendars.' },
]

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

const toSwitches = (links: readonly NavLink[]): MenuSwitch[] =>
  links
    .filter((link) => !isAlwaysShown(link.href))
    .map((link) => ({ description: link.description ?? '', label: link.label, path: link.href }))

/** The pages the Settings → Menu section offers a switch for, grouped as the menus show them. */
export const menuSwitches = (): MenuSwitchGroup[] => [
  { id: 'main', label: 'Main', switches: toSwitches(NAV_TOP_LINKS) },
  ...NAV_SECTIONS.map((s) => ({ id: s.id, label: s.label, switches: toSwitches(s.links) })),
  { id: 'app', label: 'Only in the Android app', switches: toSwitches(APP_ONLY_LINKS) },
]

/** `hidden` with `path` added or removed, keeping every other entry (unknown paths included). */
export const toggleHiddenPage = (hidden: readonly string[], path: string, show: boolean): string[] =>
  show ? hidden.filter((p) => p !== path) : hidden.includes(path) ? [...hidden] : [...hidden, path]

const OTHER_PAGE_TITLES = [
  { href: '/shared-dashboards', label: 'Dashboards' },
  { href: '/settings', label: 'Settings' },
  { href: '/notifications', label: 'Notifications' },
  { href: '/strength/live', label: 'Strength session' },
  { href: '/strength/log', label: 'Strength session' },
  { href: '/strength/session', label: 'Strength session' },
  { href: '/strength/plan', label: 'Strength plan' },
  HELP_LINK,
  { href: '/login', label: 'Login' },
  { href: '/signup', label: 'Sign up' },
]

const PAGE_TITLES: { href: string; title: string }[] = [
  ...NAV_TOP_LINKS,
  ...NAV_SECTIONS.flatMap((s) => s.links),
  ...DATA_SOURCE_LINKS.filter((l) => l.path !== '/data-sources').map((l) => ({
    href: l.path,
    label: l.label,
  })),
  ...APP_ONLY_LINKS,
  ...OTHER_PAGE_TITLES,
].map((l) => ({ href: l.href, title: l.label }))

/** The current page's name for the narrow top bar: the nav label of the route or its parent section. */
export const pageTitleForPath = (url: string): string => {
  const path = menuPath(url)
  const exact = PAGE_TITLES.find((p) => p.href === path)
  if (exact) return exact.title
  const section = PAGE_TITLES.filter((p) => p.href !== '/' && path.startsWith(`${p.href}/`)).sort(
    (a, b) => b.href.length - a.href.length,
  )[0]
  return section?.title ?? 'Aurboda'
}
