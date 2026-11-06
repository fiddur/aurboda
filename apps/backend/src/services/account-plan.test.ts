import { describe, expect, test, vi } from 'vitest'

import type { ServerSettings } from './central-db.ts'
import type { UserAccount } from './central-user-accounts.ts'

import {
  type AccountPlansDeps,
  accountStatus,
  BILLING_DISABLED,
  createAccountPlans,
  newAccountPlan,
  planUpdateFields,
  readBillingSettings,
  recordNewAccount,
} from './account-plan.ts'

const NOW = new Date('2026-11-06T12:00:00Z')
const day = (offset: number) => new Date(NOW.getTime() + offset * 86_400_000)
const billing = { enabled: true, grace_days: 14 }

const account = (overrides: Partial<UserAccount> = {}): UserAccount => ({
  created_at: day(-100),
  inserted_at: day(-100),
  paid_until: null,
  plan: 'trial',
  plan_note: null,
  pre_existing: false,
  trial_ends_at: day(30),
  username: 'alice',
  ...overrides,
})

describe('accountStatus', () => {
  test.each([
    ['billing off', { billing: { enabled: false, grace_days: 14 } }],
    ['an admin', { isAdmin: true }],
    ['an exempt account', { account: account({ plan: 'exempt', trial_ends_at: day(-100) }) }],
    ['an account without a plan', { account: account({ plan: null, trial_ends_at: day(-100) }) }],
    ['an account without a row', { account: null }],
  ])('%s is active and never read-only, even long expired', (_name, overrides) => {
    const status = accountStatus({
      account: account({ trial_ends_at: day(-100) }),
      billing,
      isAdmin: false,
      now: NOW,
      ...overrides,
    })
    expect(status).toMatchObject({ expiring_soon: false, read_only_at: null, state: 'active' })
  })

  test.each([
    ['trial running', account({ trial_ends_at: day(30) }), 'trial', false],
    ['trial ending within 14 days', account({ trial_ends_at: day(13) }), 'trial', true],
    ['trial ending in exactly 14 days', account({ trial_ends_at: day(14) }), 'trial', false],
    ['paid running', account({ paid_until: day(60), plan: 'paid', trial_ends_at: null }), 'active', false],
    ['paid ending soon', account({ paid_until: day(1), plan: 'paid', trial_ends_at: null }), 'active', true],
    ['trial just ended', account({ trial_ends_at: day(0) }), 'grace', false],
    ['in grace', account({ trial_ends_at: day(-13) }), 'grace', false],
    ['grace just ended', account({ trial_ends_at: day(-14) }), 'read_only', false],
    ['long expired', account({ trial_ends_at: day(-300) }), 'read_only', false],
    ['paid lapsed', account({ paid_until: day(-20), plan: 'paid', trial_ends_at: null }), 'read_only', false],
  ] as const)('%s → %s', (_name, acc, state, expiringSoon) => {
    const status = accountStatus({ account: acc, billing, isAdmin: false, now: NOW })
    expect(status.state).toBe(state)
    expect(status.expiring_soon).toBe(expiringSoon)
  })

  test('ends at the later of the trial end and paid-until, read-only after the grace period', () => {
    const status = accountStatus({
      account: account({ paid_until: day(40), trial_ends_at: day(10) }),
      billing,
      isAdmin: false,
      now: NOW,
    })
    expect(status).toEqual({
      ends_at: day(40),
      expiring_soon: false,
      plan: 'trial',
      read_only_at: day(54),
      state: 'trial',
    })
  })

  test('a paid-until date keeps an expired trial running', () => {
    const status = accountStatus({
      account: account({ paid_until: day(5), trial_ends_at: day(-100) }),
      billing,
      isAdmin: false,
      now: NOW,
    })
    expect(status.state).toBe('trial')
  })

  test('a trial or paid plan without dates never ends', () => {
    const trial = accountStatus({
      account: account({ trial_ends_at: null }),
      billing,
      isAdmin: false,
      now: NOW,
    })
    const paid = accountStatus({
      account: account({ plan: 'paid', trial_ends_at: null }),
      billing,
      isAdmin: false,
      now: NOW,
    })
    expect(trial).toMatchObject({ ends_at: null, read_only_at: null, state: 'trial' })
    expect(paid).toMatchObject({ ends_at: null, read_only_at: null, state: 'active' })
  })

  test('grace of zero days goes read-only as soon as the period ends', () => {
    const status = accountStatus({
      account: account({ trial_ends_at: day(0) }),
      billing: { enabled: true, grace_days: 0 },
      isAdmin: false,
      now: NOW,
    })
    expect(status.state).toBe('read_only')
  })
})

const settingsDb = (values: Partial<ServerSettings>) => ({
  getServerSetting: async <K extends keyof ServerSettings>(key: K) =>
    (values[key] ?? null) as ServerSettings[K] | null,
})

describe('readBillingSettings', () => {
  test('defaults: billing off, 90 trial days, 14 grace days', async () => {
    expect(await readBillingSettings(settingsDb({}))).toEqual(BILLING_DISABLED)
    expect(BILLING_DISABLED).toMatchObject({ enabled: false, grace_days: 14, trial_days: 90 })
  })

  test('reads stored values', async () => {
    const db = settingsDb({
      billing_enabled: true,
      grace_days: 7,
      payment_url: 'https://patreon.example/aurboda',
      price_text: '3 € / month',
      trial_days: 30,
    })
    expect(await readBillingSettings(db)).toEqual({
      enabled: true,
      grace_days: 7,
      payment_url: 'https://patreon.example/aurboda',
      price_text: '3 € / month',
      trial_days: 30,
    })
  })
})

describe('new accounts', () => {
  test('start on a trial only while billing is enabled', () => {
    expect(newAccountPlan({ enabled: true, trial_days: 90 }, NOW)).toEqual({
      plan: 'trial',
      trialEndsAt: day(90),
    })
    expect(newAccountPlan({ enabled: false, trial_days: 90 }, NOW)).toEqual({ plan: null, trialEndsAt: null })
  })

  test('recordNewAccount writes the row with the trial', async () => {
    const ensureUserAccount = vi.fn(async () => true)
    await recordNewAccount(
      { ensureUserAccount, ...settingsDb({ billing_enabled: true, trial_days: 10 }) },
      'bob',
      NOW,
    )
    expect(ensureUserAccount).toHaveBeenCalledWith('bob', {
      createdAt: NOW,
      plan: 'trial',
      preExisting: false,
      trialEndsAt: day(10),
    })
  })

  test('recordNewAccount writes no plan while billing is off', async () => {
    const ensureUserAccount = vi.fn(async () => true)
    await recordNewAccount({ ensureUserAccount, ...settingsDb({}) }, 'bob', NOW)
    expect(ensureUserAccount).toHaveBeenCalledWith('bob', {
      createdAt: NOW,
      plan: null,
      preExisting: false,
      trialEndsAt: null,
    })
  })
})

describe('planUpdateFields', () => {
  test('passes absent fields as undefined and null as null', () => {
    expect(planUpdateFields(account(), { plan_note: null, trial_ends_at: null }, NOW)).toEqual({
      paid_until: undefined,
      plan: undefined,
      plan_note: null,
      trial_ends_at: null,
    })
  })

  test('a future paid-until on a trial account switches it to paid', () => {
    const fields = planUpdateFields(account(), { paid_until: day(30).toISOString() }, NOW)
    expect(fields).toMatchObject({ paid_until: day(30), plan: 'paid' })
  })

  test('a past paid-until, an explicit plan or a non-trial account keeps the plan', () => {
    expect(planUpdateFields(account(), { paid_until: day(-1).toISOString() }, NOW).plan).toBeUndefined()
    expect(planUpdateFields(account(), { paid_until: day(30).toISOString(), plan: 'trial' }, NOW).plan).toBe(
      'trial',
    )
    expect(
      planUpdateFields(account({ plan: 'exempt' }), { paid_until: day(30).toISOString() }, NOW).plan,
    ).toBeUndefined()
  })
})

const plansSetup = (values: Partial<ServerSettings> = {}, stored: UserAccount | null = account()) => {
  const settings = { ...values }
  const centralDb = {
    getServerSetting: async <K extends keyof ServerSettings>(key: K) =>
      (settings[key] ?? null) as ServerSettings[K] | null,
    getUserAccount: vi.fn(async () => stored),
    isAdmin: vi.fn(async () => false),
    markUnplannedAccountsExempt: vi.fn(async () => 2),
    updateUserPlan: vi.fn(async (username: string, fields: Partial<UserAccount>) => ({
      ...(stored ?? account({ username })),
      ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)),
    })),
  }
  const invalidate = vi.fn()
  const deps: AccountPlansDeps = {
    centralDb,
    invalidate,
    now: () => NOW,
    userExists: async (username) => username === 'alice',
  }
  return { centralDb, invalidate, plans: createAccountPlans(deps), settings }
}

describe('createAccountPlans', () => {
  test('enabling billing marks every plan-less account exempt and drops the cache', async () => {
    const { centralDb, invalidate, plans } = plansSetup({ billing_enabled: true })
    await plans.billingSettingsChanged(false)
    expect(centralDb.markUnplannedAccountsExempt).toHaveBeenCalledTimes(1)
    expect(invalidate).toHaveBeenCalledWith()
  })

  test('changing settings while billing stays enabled, or disabling it, marks nothing', async () => {
    const enabled = plansSetup({ billing_enabled: true })
    await enabled.plans.billingSettingsChanged(true)
    expect(enabled.centralDb.markUnplannedAccountsExempt).not.toHaveBeenCalled()
    expect(enabled.invalidate).toHaveBeenCalledWith()

    const disabled = plansSetup({ billing_enabled: false })
    await disabled.plans.billingSettingsChanged(true)
    expect(disabled.centralDb.markUnplannedAccountsExempt).not.toHaveBeenCalled()
  })

  test("getMyPlan reports the user's state with the price and payment link", async () => {
    const { plans } = plansSetup({
      billing_enabled: true,
      payment_url: 'https://patreon.example/aurboda',
      price_text: '3 € / month',
    })
    expect(await plans.getMyPlan('alice')).toEqual({
      billing_enabled: true,
      ends_at: day(30).toISOString(),
      expiring_soon: false,
      payment_url: 'https://patreon.example/aurboda',
      plan: 'trial',
      price_text: '3 € / month',
      read_only_at: day(44).toISOString(),
      state: 'trial',
    })
  })

  test('getMyPlan with billing off is active, without price or link', async () => {
    const { plans } = plansSetup()
    expect(await plans.getMyPlan('alice')).toMatchObject({
      billing_enabled: false,
      payment_url: null,
      price_text: null,
      state: 'active',
    })
  })

  test('setUserPlan writes the fields, drops the cached status and returns the new state', async () => {
    const { centralDb, invalidate, plans } = plansSetup(
      { billing_enabled: true },
      account({ trial_ends_at: day(-100) }),
    )
    const status = await plans.setUserPlan('alice', {
      paid_until: day(60).toISOString(),
      plan_note: 'Patreon',
    })

    expect(centralDb.updateUserPlan).toHaveBeenCalledWith('alice', {
      paid_until: day(60),
      plan: 'paid',
      plan_note: 'Patreon',
      trial_ends_at: undefined,
    })
    expect(invalidate).toHaveBeenCalledWith('alice')
    expect(status).toMatchObject({
      paid_until: day(60).toISOString(),
      plan: 'paid',
      plan_note: 'Patreon',
      state: 'active',
    })
  })

  test('setUserPlan answers null for an unknown user and writes nothing', async () => {
    const { centralDb, plans } = plansSetup()
    expect(await plans.setUserPlan('mallory', { plan: 'exempt' })).toBeNull()
    expect(centralDb.updateUserPlan).not.toHaveBeenCalled()
  })
})
