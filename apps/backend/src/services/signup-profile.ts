import { blankToNull, type SignupProfile, signupProfileSchema } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'

import { upsertUserSettings } from '../db/index.ts'

export interface SignupProfileDeps {
  setDisplayName: (username: string, displayName: string) => Promise<unknown>
  setEmail: (username: string, email: string) => Promise<unknown>
  logError?: (message: string, error: unknown) => void
}

export const defaultSignupProfileDeps = (centralDb: Pick<CentralDb, 'setUserEmail'>): SignupProfileDeps => ({
  setDisplayName: (username, displayName) => upsertUserSettings(username, { display_name: displayName }),
  setEmail: async (username, email) => {
    if (!(await centralDb.setUserEmail(username, email))) {
      throw new Error('the account has no user_accounts row')
    }
  },
})

/** Parses a signup's optional profile fields; resolves to the error message when one is invalid. */
export const parseSignupProfile = (
  body: unknown,
): { ok: true; profile: SignupProfile } | { ok: false; error: string } => {
  const source = typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {}
  const parsed = signupProfileSchema.safeParse({ display_name: source.display_name, email: source.email })
  if (!parsed.success) {
    return { error: parsed.error.issues.map((issue) => issue.message).join('; '), ok: false }
  }
  return { ok: true, profile: parsed.data }
}

/**
 * Stores the optional display name and email a just-created account signed up with. A failure is
 * logged and never fails the signup: both can be set later in Settings.
 */
export const saveSignupProfile = async (
  deps: SignupProfileDeps,
  username: string,
  profile: SignupProfile,
): Promise<void> => {
  const logError = deps.logError ?? ((message, error) => console.error(message, error))
  const displayName = blankToNull(profile.display_name ?? null)
  const email = blankToNull(profile.email ?? null)
  await Promise.all([
    displayName &&
      deps
        .setDisplayName(username, displayName)
        .catch((error) => logError(`⚠️ Failed to save the signup display name for ${username}:`, error)),
    email &&
      deps
        .setEmail(username, email)
        .catch((error) => logError(`⚠️ Failed to save the signup email for ${username}:`, error)),
  ])
}
