/**
 * Pages a logged-out visitor can land on from outside: the welcome page, login and signup, and
 * the public sharing pages (`/u/...`: a profile, post, article, shared dashboard or challenge,
 * `/challenges/join`, the instance blog at `/blog` and the public tag pages at `/tags/<tag>`). They get the guest bar instead of the app navigation.
 */
const isGuestPage = (path: string): boolean =>
  path === '/' ||
  path === '/login' ||
  path === '/signup' ||
  path.startsWith('/u/') ||
  path === '/challenges/join' ||
  path === '/blog' ||
  path.startsWith('/tags/')

/** Whether to render the guest bar: a logged-out visitor on the welcome page, login, signup or a public page. */
export function shouldShowGuestBar(path: string, isLoggedIn: boolean): boolean {
  return !isLoggedIn && isGuestPage(path)
}

/**
 * Whether to render the app navigation (header + sidebar). A logged-in user always has it, so
 * they can navigate away from a public page; a visitor has it everywhere but the guest-bar pages.
 * (The footer renders on every page but the logged-out welcome page — see shouldShowSiteFooter.)
 */
export function shouldShowNav(path: string, isLoggedIn: boolean): boolean {
  return isLoggedIn || !isGuestPage(path)
}

/** The site footer. The logged-out welcome page scrolls as one block, so it renders the footer at the end of its own content. */
export function shouldShowSiteFooter(path: string, isLoggedIn: boolean): boolean {
  return isLoggedIn || path !== '/'
}

const PUBLIC_PAGES = ['/login', '/signup', '/privacy', '/terms', '/help']

/** The plan banner is for the signed-in app, not public share pages or the login and legal pages. */
export function shouldShowPlanBanner(path: string, isLoggedIn: boolean): boolean {
  return (
    isLoggedIn &&
    !path.startsWith('/u/') &&
    !path.startsWith('/tags/') &&
    path !== '/blog' &&
    !PUBLIC_PAGES.includes(path)
  )
}
