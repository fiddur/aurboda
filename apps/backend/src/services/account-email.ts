import { blankToNull } from '@aurboda/api-spec'

import type { VerificationSendResult } from './account-recovery.ts'
import type { CentralDb } from './central-db.ts'

export type AccountEmailDb = Pick<CentralDb, 'getUserAccount' | 'setUserEmail'>

export interface AccountEmailDeps {
  centralDb: AccountEmailDb
  emailEnabled: () => Promise<boolean>
  sendVerification: (username: string) => Promise<VerificationSendResult>
  log?: Pick<Console, 'error'>
}

export interface AccountEmailState {
  email: string | null
  verified: boolean
  email_enabled: boolean
}

export const ACCOUNT_NOT_SET_UP_ERROR =
  "Your account isn't fully set up yet, so the email can't be saved; try again later"

/** The user's private email address and its state. Used by both REST API and MCP tools. */
export const getAccountEmail = async (
  deps: AccountEmailDeps,
  username: string,
): Promise<AccountEmailState> => {
  const [account, emailEnabled] = await Promise.all([
    deps.centralDb.getUserAccount(username),
    deps.emailEnabled(),
  ])
  return {
    email: account?.email ?? null,
    email_enabled: emailEnabled,
    verified: !!account?.email && !!account.email_verified_at,
  }
}

/**
 * Sets the user's private email address (already validated and trimmed); an empty string or null
 * clears it. A new address gets a verification link in the background, when the server sends
 * email. Resolves to the state as stored, or an error when the account has no `user_accounts` row
 * yet (the startup backfill gives it one). Used by both REST API and MCP tools.
 */
export const setAccountEmail = async (
  deps: AccountEmailDeps,
  username: string,
  email: string | null,
): Promise<({ ok: true } & AccountEmailState) | { ok: false; error: string }> => {
  const account = await deps.centralDb.setUserEmail(username, blankToNull(email))
  if (!account) return { error: ACCOUNT_NOT_SET_UP_ERROR, ok: false }
  const verified = !!account.email && !!account.email_verified_at
  if (account.email && !verified) startVerification(deps, username)
  return { email: account.email, email_enabled: await deps.emailEnabled(), ok: true, verified }
}

/** Sends a verification link without waiting for it; a failure is logged without the address. */
export const startVerification = (
  deps: Pick<AccountEmailDeps, 'log' | 'sendVerification'>,
  username: string,
) => {
  void deps.sendVerification(username).catch(() => {
    ;(deps.log ?? console).error(`⚠️ Sending the email verification link for ${username} failed`)
  })
}
