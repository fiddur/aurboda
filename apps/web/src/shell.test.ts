import { describe, expect, test } from 'vitest'

import { shouldShowGuestBar, shouldShowNav, shouldShowPlanBanner, shouldShowSiteFooter } from './shell'

const GUEST_PAGES = [
  '/',
  '/login',
  '/signup',
  '/u/fiddur',
  '/u/fiddur/a3GVcs14D',
  '/u/fiddur/posts/abc',
  '/challenges/join',
  '/blog',
  '/tags/aurboda',
]

describe('shouldShowNav', () => {
  test('shows nav on app and legal routes regardless of auth', () => {
    for (const path of ['/dashboard', '/privacy', '/terms', '/help', '/challenges']) {
      expect(shouldShowNav(path, false)).toBe(true)
      expect(shouldShowNav(path, true)).toBe(true)
    }
  })

  test('hides nav on the welcome and public pages for anonymous visitors', () => {
    for (const path of GUEST_PAGES) expect(shouldShowNav(path, false)).toBe(false)
  })

  test('keeps nav on the welcome and public pages for logged-in users', () => {
    for (const path of GUEST_PAGES) expect(shouldShowNav(path, true)).toBe(true)
  })
})

describe('shouldShowGuestBar', () => {
  test('shows on the welcome and public pages for anonymous visitors', () => {
    for (const path of GUEST_PAGES) expect(shouldShowGuestBar(path, false)).toBe(true)
  })

  test('never shows for a logged-in user', () => {
    for (const path of GUEST_PAGES) expect(shouldShowGuestBar(path, true)).toBe(false)
  })

  test('does not show on app and legal pages', () => {
    for (const path of ['/privacy', '/terms', '/challenges', '/timeline', '/settings']) {
      expect(shouldShowGuestBar(path, false)).toBe(false)
    }
  })

  test('is shown exactly where the nav is not', () => {
    for (const path of [...GUEST_PAGES, '/privacy', '/timeline']) {
      for (const loggedIn of [false, true]) {
        expect(shouldShowGuestBar(path, loggedIn)).toBe(!shouldShowNav(path, loggedIn))
      }
    }
  })
})

describe('shouldShowSiteFooter', () => {
  test('leaves the logged-out welcome page to render it in its own content', () => {
    expect(shouldShowSiteFooter('/', false)).toBe(false)
    expect(shouldShowSiteFooter('/', true)).toBe(true)
  })

  test('shows on login, signup and the public pages', () => {
    for (const path of ['/login', '/signup', '/u/fiddur', '/blog', '/privacy']) {
      expect(shouldShowSiteFooter(path, false)).toBe(true)
    }
  })
})

describe('shouldShowPlanBanner', () => {
  test('shows on app routes for a signed-in user only', () => {
    expect(shouldShowPlanBanner('/', true)).toBe(true)
    expect(shouldShowPlanBanner('/settings', true)).toBe(true)
    expect(shouldShowPlanBanner('/', false)).toBe(false)
  })

  test('hides on public share pages and the login and legal pages', () => {
    for (const path of [
      '/u/fiddur',
      '/u/fiddur/a3GVcs14D',
      '/blog',
      '/tags/aurboda',
      '/login',
      '/signup',
      '/privacy',
      '/terms',
      '/help',
    ]) {
      expect(shouldShowPlanBanner(path, true)).toBe(false)
    }
  })
})
