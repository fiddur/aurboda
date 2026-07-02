/**
 * Whether to render the app chrome (header / sidebar / footer) for a route.
 *
 * Public sharing pages (`/u/...` — a profile, shared dashboard, or challenge)
 * render chrome-less so anonymous visitors get a clean, standalone page. A
 * logged-in user, however, keeps their app nav on those pages so they can
 * navigate away without resorting to the browser back button.
 */
export function shouldShowChrome(path: string, isLoggedIn: boolean): boolean {
  const isPublicSharePage = path.startsWith('/u/')
  return !isPublicSharePage || isLoggedIn
}
