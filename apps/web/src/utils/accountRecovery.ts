import type { AccountEmailResponse } from '@aurboda/api-spec'

/** The token of an emailed link (`?token=…`), or null when the page was opened without one. */
export const linkToken = (query: Record<string, string | undefined>): string | null => {
  const token = query.token?.trim()
  return token ? token : null
}

/** Why a new password cannot be saved yet, or null when it can. */
export const newPasswordProblem = (password: string, confirm: string): string | null => {
  if (!password) return 'Enter a new password'
  if (password !== confirm) return 'The passwords do not match'
  return null
}

export type EmailState = Pick<AccountEmailResponse, 'email' | 'verified' | 'email_enabled'>

/** What the Settings email field says about its address. */
export const emailStatus = (state: EmailState | undefined): 'verified' | 'unverified' | null => {
  if (!state?.email) return null
  return state.verified ? 'verified' : 'unverified'
}

/** Whether to offer sending the verification link again: an unverified address on a server that sends mail. */
export const canResendVerification = (state: EmailState | undefined): boolean =>
  emailStatus(state) === 'unverified' && state?.email_enabled === true

/** The path the "Sign in and add a new passkey" choice goes to. */
export const PASSKEY_RECOVERY_PATH = '/settings?recovered=passkey#passkeys'
