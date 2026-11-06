import type {
  AccountPlan,
  AccountPlanResponse,
  AccountState,
  AdminUserPlan,
  UpdateUserPlanBody,
} from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'
import type { UserAccount, UserPlanFields } from './central-user-accounts.ts'

const DAY_MS = 86_400_000
export const DEFAULT_TRIAL_DAYS = 90
export const DEFAULT_GRACE_DAYS = 14
export const EXPIRING_SOON_DAYS = 14

export interface BillingSettings {
  enabled: boolean
  trial_days: number
  grace_days: number
  price_text: string
  payment_url: string
}

export const BILLING_DISABLED: BillingSettings = {
  enabled: false,
  grace_days: DEFAULT_GRACE_DAYS,
  payment_url: '',
  price_text: '',
  trial_days: DEFAULT_TRIAL_DAYS,
}

export type PlanAccount = Pick<UserAccount, 'plan' | 'trial_ends_at' | 'paid_until'>

export interface AccountStatus {
  state: AccountState
  plan: AccountPlan | null
  ends_at: Date | null
  read_only_at: Date | null
  expiring_soon: boolean
}

const later = (a: Date | null, b: Date | null): Date | null => (!a ? b : !b ? a : a > b ? a : b)

const addDays = (date: Date, days: number): Date => new Date(date.getTime() + days * DAY_MS)

/**
 * Where an account stands. Billing off, an admin, or an exempt or plan-less account is always
 * active; otherwise the account runs until the later of its trial end and paid-until date, then
 * has `grace_days` of grace, then is read-only. A trial or paid plan without an end date never ends.
 */
export const accountStatus = ({
  billing,
  account,
  isAdmin,
  now,
}: {
  billing: Pick<BillingSettings, 'enabled' | 'grace_days'>
  account: PlanAccount | null
  isAdmin: boolean
  now: Date
}): AccountStatus => {
  const plan = account?.plan ?? null
  const ends_at =
    account && (plan === 'trial' || plan === 'paid') ? later(account.trial_ends_at, account.paid_until) : null
  const unrestricted = { ends_at, expiring_soon: false, plan, read_only_at: null, state: 'active' as const }
  if (!billing.enabled || isAdmin || plan === null || plan === 'exempt') return unrestricted

  const running = plan === 'trial' ? ('trial' as const) : ('active' as const)
  if (!ends_at) return { ...unrestricted, state: running }

  const read_only_at = addDays(ends_at, billing.grace_days)
  const base = { ends_at, plan, read_only_at }
  if (now < ends_at) {
    return {
      ...base,
      expiring_soon: ends_at.getTime() - now.getTime() < EXPIRING_SOON_DAYS * DAY_MS,
      state: running,
    }
  }
  return { ...base, expiring_soon: false, state: now < read_only_at ? 'grace' : 'read_only' }
}

export const readBillingSettings = async (
  centralDb: Pick<CentralDb, 'getServerSetting'>,
): Promise<BillingSettings> => {
  const [enabled, trialDays, graceDays, priceText, paymentUrl] = await Promise.all([
    centralDb.getServerSetting('billing_enabled'),
    centralDb.getServerSetting('trial_days'),
    centralDb.getServerSetting('grace_days'),
    centralDb.getServerSetting('price_text'),
    centralDb.getServerSetting('payment_url'),
  ])
  return {
    enabled: enabled === true,
    grace_days: graceDays ?? DEFAULT_GRACE_DAYS,
    payment_url: paymentUrl ?? '',
    price_text: priceText ?? '',
    trial_days: trialDays ?? DEFAULT_TRIAL_DAYS,
  }
}

/** The plan a new account starts on: a trial while billing is enabled, none otherwise. */
export const newAccountPlan = (
  billing: Pick<BillingSettings, 'enabled' | 'trial_days'>,
  now: Date,
): { plan: AccountPlan | null; trialEndsAt: Date | null } =>
  billing.enabled
    ? { plan: 'trial', trialEndsAt: addDays(now, billing.trial_days) }
    : { plan: null, trialEndsAt: null }

/** Records a just-signed-up account, on a trial when billing is enabled. */
export const recordNewAccount = async (
  centralDb: Pick<CentralDb, 'ensureUserAccount' | 'getServerSetting'>,
  username: string,
  now: Date = new Date(),
): Promise<void> => {
  const { plan, trialEndsAt } = newAccountPlan(await readBillingSettings(centralDb), now)
  await centralDb.ensureUserAccount(username, { createdAt: now, plan, preExisting: false, trialEndsAt })
}

/**
 * Records a row for each account that has none, at startup. Accounts from before billing was
 * enabled got their rows at an earlier start and were marked exempt when it was enabled, so while
 * billing is enabled a missing row means the signup's own row failed: that account starts its
 * trial now.
 */
export const backfillAccounts = async (
  centralDb: Pick<CentralDb, 'backfillUserAccounts' | 'getServerSetting'>,
  usernames: string[],
  now: Date = new Date(),
): Promise<number> =>
  centralDb.backfillUserAccounts(usernames, newAccountPlan(await readBillingSettings(centralDb), now))

const parseDate = (value: string | null | undefined): Date | null | undefined =>
  value === undefined ? undefined : value === null ? null : new Date(value)

/**
 * The fields an admin's plan edit writes. A future `paid_until` on a trial account, without an
 * explicit plan, switches it to the paid plan.
 */
export const planUpdateFields = (
  current: PlanAccount | null,
  body: UpdateUserPlanBody,
  now: Date,
): UserPlanFields => {
  const fields: UserPlanFields = {
    paid_until: parseDate(body.paid_until),
    plan: body.plan,
    plan_note: body.plan_note,
    trial_ends_at: parseDate(body.trial_ends_at),
  }
  const paidUntil = fields.paid_until
  if (body.plan === undefined && current?.plan === 'trial' && paidUntil && paidUntil > now) {
    fields.plan = 'paid'
  }
  return fields
}

const iso = (date: Date | null): string | null => (date ? date.toISOString() : null)

export const serializeStatus = (status: AccountStatus) => ({
  ends_at: iso(status.ends_at),
  plan: status.plan,
  read_only_at: iso(status.read_only_at),
  state: status.state,
})

export const adminUserPlan = (account: UserAccount | null, status: AccountStatus): AdminUserPlan => ({
  ...serializeStatus(status),
  paid_until: iso(account?.paid_until ?? null),
  plan_note: account?.plan_note ?? null,
  trial_ends_at: iso(account?.trial_ends_at ?? null),
})

export type MyPlan = Omit<AccountPlanResponse, 'success' | 'error'>

export interface AccountPlansDeps {
  centralDb: Pick<
    CentralDb,
    'getServerSetting' | 'getUserAccount' | 'isAdmin' | 'markUnplannedAccountsExempt' | 'updateUserPlan'
  >
  userExists: (username: string) => Promise<boolean>
  /** Drops cached statuses: one user's, or every user's and the billing settings. */
  invalidate: (username?: string) => void
  now?: () => Date
}

export interface AccountPlans {
  getMyPlan: (username: string) => Promise<MyPlan>
  /** Resolves to null when the user does not exist. */
  setUserPlan: (username: string, body: UpdateUserPlanBody) => Promise<AdminUserPlan | null>
  /** Call after the billing settings were written, with whether billing was enabled before. */
  billingSettingsChanged: (wasEnabled: boolean) => Promise<void>
}

export const createAccountPlans = ({
  centralDb,
  userExists,
  invalidate,
  now = () => new Date(),
}: AccountPlansDeps): AccountPlans => ({
  billingSettingsChanged: async (wasEnabled) => {
    const billing = await readBillingSettings(centralDb)
    if (billing.enabled && !wasEnabled) {
      const marked = await centralDb.markUnplannedAccountsExempt()
      if (marked > 0) console.info(`💳 Billing enabled: ${marked} existing account(s) marked exempt`)
    }
    invalidate()
  },

  getMyPlan: async (username) => {
    const [billing, account, isAdmin] = await Promise.all([
      readBillingSettings(centralDb),
      centralDb.getUserAccount(username),
      centralDb.isAdmin(username),
    ])
    // Admins are never restricted, whatever plan row they carry, so they see themselves as exempt.
    const status: AccountStatus = isAdmin
      ? { ends_at: null, expiring_soon: false, plan: 'exempt', read_only_at: null, state: 'active' }
      : accountStatus({ account, billing, isAdmin, now: now() })
    return {
      ...serializeStatus(status),
      billing_enabled: billing.enabled,
      expiring_soon: status.expiring_soon,
      payment_url: billing.payment_url || null,
      price_text: billing.price_text || null,
    }
  },

  setUserPlan: async (username, body) => {
    if (!(await userExists(username))) return null
    const current = now()
    const existing = await centralDb.getUserAccount(username)
    const account = await centralDb.updateUserPlan(username, planUpdateFields(existing, body, current))
    invalidate(username)
    const [billing, isAdmin] = await Promise.all([
      readBillingSettings(centralDb),
      centralDb.isAdmin(username),
    ])
    return adminUserPlan(account, accountStatus({ account, billing, isAdmin, now: current }))
  },
})
