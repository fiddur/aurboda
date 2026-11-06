import { describe, expect, test } from 'vitest'

import { type MyPlan, planBanner, planSummary, signupBillingLine } from './plan'

const day = (iso: string | null) => (iso ? iso.slice(0, 10) : '')

const plan = (overrides: Partial<MyPlan> = {}): MyPlan => ({
  billing_enabled: true,
  ends_at: '2027-02-04T00:00:00.000Z',
  expiring_soon: false,
  payment_url: 'https://pay.example',
  plan: 'trial',
  price_text: '3 € / month',
  read_only_at: '2027-02-18T00:00:00.000Z',
  state: 'trial',
  ...overrides,
})

describe('planBanner', () => {
  test('nothing while billing is off, or for a running plan not ending soon', () => {
    expect(planBanner(undefined)).toBeNull()
    expect(planBanner(plan({ billing_enabled: false, state: 'read_only' }))).toBeNull()
    expect(planBanner(plan())).toBeNull()
    expect(planBanner(plan({ plan: 'exempt', state: 'active' }))).toBeNull()
  })

  test('a dismissable notice when the plan ends soon', () => {
    expect(planBanner(plan({ expiring_soon: true }), day)).toEqual({
      dismissable: true,
      text: 'Your free trial ends on 2027-02-04.',
      tone: 'info',
    })
    expect(planBanner(plan({ expiring_soon: true, plan: 'paid', state: 'active' }), day)?.text).toBe(
      'Your plan ends on 2027-02-04.',
    )
  })

  test('a lasting warning in grace and for read-only', () => {
    expect(planBanner(plan({ state: 'grace' }), day)).toEqual({
      dismissable: false,
      text: 'Your trial has ended. The account becomes read-only on 2027-02-18 unless renewed.',
      tone: 'warn',
    })
    expect(planBanner(plan({ state: 'read_only' }), day)).toMatchObject({ dismissable: false, tone: 'bad' })
  })
})

describe('planSummary', () => {
  test.each([
    [plan({ plan: 'exempt', state: 'active' }), 'Your account is exempt from billing.'],
    [plan({ ends_at: null, plan: null, state: 'active' }), 'Your account is exempt from billing.'],
    [plan(), 'Free trial until 2027-02-04.'],
    [plan({ plan: 'paid', state: 'active' }), 'Paid until 2027-02-04.'],
    [plan({ ends_at: null, plan: 'paid', state: 'active' }), 'Paid.'],
    [plan({ state: 'grace' }), 'Your trial has ended; the account becomes read-only on 2027-02-18.'],
    [plan({ plan: 'paid', state: 'read_only' }), 'Your plan has ended and the account is read-only.'],
  ])('%#', (input, text) => {
    expect(planSummary(input, day)).toBe(text)
  })
})

describe('signupBillingLine', () => {
  test('nothing while billing is off', () => {
    expect(signupBillingLine(undefined)).toBeNull()
    expect(signupBillingLine({ billing_enabled: false, trial_days: 90 })).toBeNull()
  })

  test('the trial length and price', () => {
    expect(signupBillingLine({ billing_enabled: true, price_text: '3 € / month', trial_days: 90 })).toBe(
      'Free for 90 days, then 3 € / month.',
    )
    expect(signupBillingLine({ billing_enabled: true, price_text: null, trial_days: 1 })).toBe(
      'Free for 1 day.',
    )
    expect(signupBillingLine({ billing_enabled: true, price_text: '3 €', trial_days: 0 })).toBe(
      'Paid from the start: 3 €.',
    )
  })
})
