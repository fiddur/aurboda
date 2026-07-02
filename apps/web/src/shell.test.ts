import { describe, expect, test } from 'vitest'

import { shouldShowChrome } from './shell'

describe('shouldShowChrome', () => {
  test('shows chrome on normal app routes regardless of auth', () => {
    expect(shouldShowChrome('/', false)).toBe(true)
    expect(shouldShowChrome('/dashboard', false)).toBe(true)
    expect(shouldShowChrome('/challenges', true)).toBe(true)
  })

  test('hides chrome on public share pages for anonymous visitors', () => {
    expect(shouldShowChrome('/u/fiddur', false)).toBe(false)
    expect(shouldShowChrome('/u/fiddur/a3GVcs14D', false)).toBe(false)
  })

  test('keeps chrome on public share pages for logged-in users', () => {
    expect(shouldShowChrome('/u/fiddur', true)).toBe(true)
    expect(shouldShowChrome('/u/fiddur/a3GVcs14D', true)).toBe(true)
  })
})
