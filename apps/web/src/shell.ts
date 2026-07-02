/**
 * Whether to render the app navigation (header + sidebar) for a route.
 *
 * Public sharing pages (`/u/...` — a profile, shared dashboard, or challenge)
 * hide the nav for anonymous visitors so they get a clean, standalone page. A
 * logged-in user keeps their nav on those pages so they can navigate away
 * without resorting to the browser back button. (The footer renders on every
 * page regardless — see AppShell.)
 */
export function shouldShowNav(path: string, isLoggedIn: boolean): boolean {
  const isPublicSharePage = path.startsWith('/u/')
  return !isPublicSharePage || isLoggedIn
}
