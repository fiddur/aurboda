import type { SignupMode } from '../state/auth'

import { type ServerBilling, signupBillingLine } from '../utils/plan'

/** What a logged-out visitor can be told about signing up; `unknown` while /status is loading or after it failed. */
export type GuestSignup =
  | { mode: 'open'; billingLine: string | null; trialDays: number }
  | { mode: 'invite_only' }
  | { mode: 'closed' }
  | { mode: 'unknown' }

export const guestSignup = (
  mode: SignupMode | undefined,
  billing: ServerBilling | undefined,
): GuestSignup => {
  if (mode === undefined) return { mode: 'unknown' }
  if (mode !== 'open') return { mode }
  return {
    billingLine: signupBillingLine(billing),
    mode,
    trialDays: billing?.billing_enabled ? (billing.trial_days ?? 0) : 0,
  }
}

/** The guest bar's sign-up button: the welcome page says it plainly, public pages mention the trial. */
export const guestBarSignupLabel = (trialDays: number, page: 'welcome' | 'public'): string => {
  if (page === 'welcome') return 'Create account'
  return trialDays > 0 ? `Sign up, free for ${trialDays} day${trialDays === 1 ? '' : 's'}` : 'Sign up'
}

/** The line under the welcome hero's call to action; null when billing is off. Signup never asks for a card. */
export const heroBillingLine = (billingLine: string | null): string | null =>
  billingLine ? `${billingLine} No card needed to start.` : null
