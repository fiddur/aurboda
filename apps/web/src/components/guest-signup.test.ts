import { describe, expect, test } from 'vitest'

import { guestBarSignupLabel, guestSignup, heroBillingLine } from './guest-signup'

const billing = { billing_enabled: true, price_text: '99 kr/year', trial_days: 90 }

describe('guestSignup', () => {
  test('open with billing carries the billing line and trial', () => {
    expect(guestSignup('open', billing)).toEqual({
      billingLine: 'Free for 90 days, then 99 kr/year.',
      mode: 'open',
      trialDays: 90,
    })
  })

  test('open without billing has no billing line and no trial', () => {
    expect(guestSignup('open', { billing_enabled: false, trial_days: 90 })).toEqual({
      billingLine: null,
      mode: 'open',
      trialDays: 0,
    })
    expect(guestSignup('open', {})).toEqual({ billingLine: null, mode: 'open', trialDays: 0 })
  })

  test('invite-only and closed say only the mode', () => {
    expect(guestSignup('invite_only', billing)).toEqual({ mode: 'invite_only' })
    expect(guestSignup('closed', billing)).toEqual({ mode: 'closed' })
  })

  test('an unloaded or failed status is unknown, not closed', () => {
    expect(guestSignup(undefined, billing)).toEqual({ mode: 'unknown' })
    expect(guestSignup(undefined, undefined)).toEqual({ mode: 'unknown' })
  })
})

describe('guestBarSignupLabel', () => {
  test('the welcome page says Create account whatever the billing', () => {
    expect(guestBarSignupLabel(90, 'welcome')).toBe('Create account')
    expect(guestBarSignupLabel(0, 'welcome')).toBe('Create account')
  })

  test('public pages mention the trial when there is one', () => {
    expect(guestBarSignupLabel(90, 'public')).toBe('Sign up, free for 90 days')
    expect(guestBarSignupLabel(1, 'public')).toBe('Sign up, free for 1 day')
    expect(guestBarSignupLabel(0, 'public')).toBe('Sign up')
  })
})

describe('heroBillingLine', () => {
  test('adds that no card is needed when billing is on', () => {
    expect(heroBillingLine('Free for 90 days, then 99 kr/year.')).toBe(
      'Free for 90 days, then 99 kr/year. No card needed to start.',
    )
  })

  test('says nothing when billing is off', () => {
    expect(heroBillingLine(null)).toBeNull()
  })
})
