import { blankToNull } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'

export type AccountEmailDb = Pick<CentralDb, 'getUserAccount' | 'setUserEmail'>

export const ACCOUNT_NOT_SET_UP_ERROR =
  "Your account isn't fully set up yet, so the email can't be saved; try again later"

/** The user's private email address, or null. Used by both REST API and MCP tools. */
export const getAccountEmail = async (centralDb: AccountEmailDb, username: string): Promise<string | null> =>
  (await centralDb.getUserAccount(username))?.email ?? null

/**
 * Sets the user's private email address (already validated and trimmed); an empty string or null
 * clears it. Resolves to the address as stored, or an error when the account has no
 * `user_accounts` row yet (the startup backfill gives it one). Used by both REST API and MCP tools.
 */
export const setAccountEmail = async (
  centralDb: AccountEmailDb,
  username: string,
  email: string | null,
): Promise<{ ok: true; email: string | null } | { ok: false; error: string }> => {
  const account = await centralDb.setUserEmail(username, blankToNull(email))
  return account ? { email: account.email, ok: true } : { error: ACCOUNT_NOT_SET_UP_ERROR, ok: false }
}
