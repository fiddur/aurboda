import { describe, expect, test } from 'vitest'

import { shouldShowGuestBar, shouldShowNav, shouldShowPlanBanner, shouldShowSiteFooter } from './shell'

const GUEST_PAGES = ['/', '/u/fiddur', '/u/fiddur/a3GVcs14D', '/u/fiddur/posts/abc', '/challenges/join']

describe('shouldShowNav', () => {
  test('shows nav on app, login and legal routes regardless of auth', () => {
    for (const path of ['/dashboard', '/login', '/privacy', '/challenges']) {
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

  test('does not show on app, login and legal pages', () => {
    for (const path of ['/login', '/signup', '/privacy', '/terms', '/challenges', '/timeline']) {
      expect(shouldShowGuestBar(path, false)).toBe(false)
    }
  })

  test('is shown exactly where the nav is not', () => {
    for (const path of [...GUEST_PAGES, '/login', '/timeline']) {
      for (const loggedIn of [false, true]) {
        expect(shouldShowGuestBar(path, loggedIn)).toBe(!shouldShowNav(path, loggedIn))
      }
    }
  })
})

describe('shouldShowSiteFooter', () => {
  test('hides on the logged-out welcome page only', () => {
    expect(shouldShowSiteFooter('/', false)).toBe(false)
    expect(shouldShowSiteFooter('/', true)).toBe(true)
    expect(shouldShowSiteFooter('/u/fiddur', false)).toBe(true)
    expect(shouldShowSiteFooter('/login', false)).toBe(true)
  })
})

describe('shouldShowPlanBanner', () => {
  test('shows on app routes for a signed-in user only', () => {
    expect(shouldShowPlanBanner('/', true)).toBe(true)
    expect(shouldShowPlanBanner('/settings', true)).toBe(true)
    expect(shouldShowPlanBanner('/', false)).toBe(false)
  })

  test('hides on public share pages and the login and legal pages', () => {
    for (const path of ['/u/fiddur', '/u/fiddur/a3GVcs14D', '/login', '/signup', '/privacy', '/terms']) {
      expect(shouldShowPlanBanner(path, true)).toBe(false)
    }
  })
})
