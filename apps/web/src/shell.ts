/** Public pages a visitor reaches without an account: the `/u/...` share pages and the instance blog. */
const isPublicSharePage = (path: string): boolean => path.startsWith('/u/') || path === '/blog'

/**
 * Whether to render the app navigation (header + sidebar) for a route.
 *
 * Public sharing pages (`/u/...` — a profile, shared dashboard, or challenge —
 * and the instance blog at `/blog`) hide the nav for anonymous visitors so they
 * get a clean, standalone page. A logged-in user keeps their nav on those pages
 * so they can navigate away
 * without resorting to the browser back button. (The footer renders on every
 * page regardless — see AppShell.)
 */
export function shouldShowNav(path: string, isLoggedIn: boolean): boolean {
  return !isPublicSharePage(path) || isLoggedIn
}

const PUBLIC_PAGES = ['/login', '/signup', '/privacy', '/terms']

/** The plan banner is for the signed-in app, not public share pages or the login and legal pages. */
export function shouldShowPlanBanner(path: string, isLoggedIn: boolean): boolean {
  return isLoggedIn && !isPublicSharePage(path) && !PUBLIC_PAGES.includes(path)
}
