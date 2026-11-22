// The web menu and the Android More tab are both built from this file: `pnpm generate` writes it
// as Kotlin (`generate-menu-kotlin.ts`), so a change here reaches both.

export interface NavLink {
  href: string
  label: string
  icon?: string
  description?: string
  adminOnly?: boolean
}

export type NavSectionId = 'log' | 'training' | 'explore' | 'sharing' | 'setup'

export interface NavSection {
  id: NavSectionId
  label: string
  icon: string
  links: NavLink[]
}

export const NAV_TOP_LINKS: NavLink[] = [
  { href: '/', label: 'Home', icon: '🏠' },
  { href: '/add', label: 'Add', icon: '➕', description: 'Add an activity, a metric or a note.' },
]

export const NAV_SECTIONS: NavSection[] = [
  {
    id: 'log',
    label: 'Log',
    icon: '✏️',
    links: [
      {
        href: '/journal',
        label: 'Journal',
        description: 'Dated entries in your own words, with pictures and voice notes.',
      },
      { href: '/meals', label: 'Meals', description: 'Log what you eat and see calories and nutrients.' },
      {
        href: '/check-ins',
        label: 'Check-ins',
        description: 'Short forms you fill in, like a morning check-in, logged as metrics.',
      },
      { href: '/reports', label: 'Reports', description: 'Lab results and other values you enter by hand.' },
      {
        href: '/people',
        label: 'People',
        description: 'The people in your life, their birthdays and the dates that matter. Private.',
      },
    ],
  },
  {
    id: 'training',
    label: 'Training',
    icon: '🏋️',
    links: [
      {
        href: '/strength',
        label: 'Strength',
        description: 'Start or log a session, and follow your strength score, exercises and muscle recovery.',
      },
      {
        href: '/training-load',
        label: 'Training load',
        description: 'Fitness, fatigue and form from your workouts.',
      },
      { href: '/routes', label: 'Routes', description: 'The ways you run, walk or ride again and again.' },
      { href: '/segments', label: 'Segments', description: 'Stretches of road with your best times.' },
    ],
  },
  {
    id: 'explore',
    label: 'Explore',
    icon: '🧭',
    links: [
      { href: '/timeline', label: 'Timeline', description: 'Your day, week or month on one scrolling line.' },
      {
        href: '/data',
        label: 'Data',
        description: 'Every metric and activity you have, to browse and edit.',
      },
      { href: '/chart', label: 'Chart', description: 'Draw any of your data over time.' },
      {
        href: '/correlations',
        label: 'Analyze',
        description: 'Find out what goes together, like exercise and sleep.',
      },
      {
        href: '/goals',
        label: 'Goals',
        description: 'Targets for sleep, steps and more, and how you are doing.',
      },
      {
        href: '/places',
        label: 'Places',
        description: 'A map of where you have been, and your named places.',
      },
    ],
  },
  {
    id: 'sharing',
    label: 'Sharing',
    icon: '🌐',
    links: [
      { href: '/feed', label: 'Feed', description: 'Posts from you and the people you follow.' },
      {
        href: '/dashboards',
        label: 'Dashboards',
        description: 'Public pages that show chosen parts of your data.',
      },
      {
        href: '/challenges',
        label: 'Challenges',
        description: 'Compete with friends, here or on other servers.',
      },
    ],
  },
  {
    id: 'setup',
    label: 'Setup',
    icon: '🛠️',
    links: [
      {
        href: '/data-sources',
        label: 'Data sources',
        description: 'Every source at a glance, and how to connect one.',
      },
      {
        href: '/activity-types',
        label: 'Activity types',
        description: 'The kinds of activity you log, with their icons and fields.',
      },
      {
        href: '/deduction-rules',
        label: 'Rules',
        description: 'Create activities from your data automatically.',
      },
      { href: '/admin', label: 'Admin', description: 'Server settings and users.', adminOnly: true },
    ],
  },
]

export const HELP_LINK: NavLink = { href: '/help', label: 'Help & support', icon: '❓' }

export const SETTINGS_LINK: NavLink = { href: '/settings', label: 'Settings', icon: '⚙' }

export const NOTIFICATIONS_LINK: NavLink = { href: '/notifications', label: 'Notifications', icon: '🔔' }

/** Pages that only the Android app's More tab lists; on the web they are reached from other pages. */
export const APP_ONLY_LINKS: NavLink[] = [
  {
    href: '/reminders',
    label: 'Reminders',
    icon: '⏰',
    description: 'Your recurring reminders, under Inbox in the app.',
  },
  { href: '/audit-log', label: 'Audit log', icon: '📋', description: 'Recent syncs, imports and errors.' },
]

/** Menu paths that are never hidden, whatever `hidden_pages` says; everything under `/admin` too. */
export const MENU_ALWAYS_SHOWN = ['/', '/settings', '/help', '/notifications', '/admin'] as const

const isAlwaysShownPath = (path: string): boolean =>
  (MENU_ALWAYS_SHOWN as readonly string[]).includes(path) || path.startsWith('/admin/')

/**
 * The paths `hidden_pages` can hold: every menu link the web menu or the app's More tab can leave
 * out. A path no longer in a menu has no switch to clear it, so it is dropped when settings are saved.
 */
export const HIDEABLE_MENU_PATHS: readonly string[] = [
  ...NAV_TOP_LINKS,
  ...NAV_SECTIONS.flatMap((section) => section.links),
  ...APP_ONLY_LINKS,
]
  .map((link) => link.href)
  .filter((path) => !isAlwaysShownPath(path))

/** `paths` without the ones that are not hideable menu paths, and without repeats. */
export const keepHideableMenuPaths = (paths: readonly string[]): string[] => {
  const hideable = new Set(HIDEABLE_MENU_PATHS)
  return [...new Set(paths)].filter((path) => hideable.has(path))
}
