import { describe, expect, test } from 'vitest'

import { shouldShowNav, shouldShowPlanBanner } from './shell'

describe('shouldShowNav', () => {
  test('shows nav on normal app routes regardless of auth', () => {
    expect(shouldShowNav('/', false)).toBe(true)
    expect(shouldShowNav('/dashboard', false)).toBe(true)
    expect(shouldShowNav('/challenges', true)).toBe(true)
  })

  test('hides nav on public share pages for anonymous visitors', () => {
    expect(shouldShowNav('/u/fiddur', false)).toBe(false)
    expect(shouldShowNav('/u/fiddur/a3GVcs14D', false)).toBe(false)
  })

  test('keeps nav on public share pages for logged-in users', () => {
    expect(shouldShowNav('/u/fiddur', true)).toBe(true)
    expect(shouldShowNav('/u/fiddur/a3GVcs14D', true)).toBe(true)
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
