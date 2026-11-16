import { describe, expect, test } from 'vitest'

import { canResendVerification, emailStatus, linkToken, newPasswordProblem } from './accountRecovery'

describe('linkToken', () => {
  test('reads the trimmed token, or null without one', () => {
    expect(linkToken({ token: ' abc ' })).toBe('abc')
    expect(linkToken({ token: '' })).toBeNull()
    expect(linkToken({})).toBeNull()
  })
})

describe('newPasswordProblem', () => {
  test('needs a password typed the same twice', () => {
    expect(newPasswordProblem('', '')).toBe('Enter a new password')
    expect(newPasswordProblem('secret', 'secrет')).toBe('The passwords do not match')
    expect(newPasswordProblem('secret', 'secret')).toBeNull()
  })
})

describe('emailStatus and canResendVerification', () => {
  test('no address has no status and no resend', () => {
    const state = { email: null, email_enabled: true, verified: false }
    expect(emailStatus(state)).toBeNull()
    expect(canResendVerification(state)).toBe(false)
  })

  test('a verified address offers no resend', () => {
    const state = { email: 'me@example.com', email_enabled: true, verified: true }
    expect(emailStatus(state)).toBe('verified')
    expect(canResendVerification(state)).toBe(false)
  })

  test('an unverified address offers a resend only when the server sends mail', () => {
    const state = { email: 'me@example.com', email_enabled: true, verified: false }
    expect(emailStatus(state)).toBe('unverified')
    expect(canResendVerification(state)).toBe(true)
    expect(canResendVerification({ ...state, email_enabled: false })).toBe(false)
  })
})
