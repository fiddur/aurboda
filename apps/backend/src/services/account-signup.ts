import type { SignupProfile } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'
import type { InvitationAuth } from './invitation.ts'

import { recordNewAccount } from './account-plan.ts'
import { saveSignupProfile, type SignupProfileDeps } from './signup-profile.ts'

export const RESERVED_USERNAMES = [
  'postgres',
  'admin',
  'root',
  'administrator',
  'superuser',
  'system',
  'public',
  'guest',
  'test',
  'aurboda',
  'tags',
]

/**
 * Username format: a valid lowercase PostgreSQL role name. This also selects
 * which per-user database a request connects to, so any caller that resolves a
 * username to a database (e.g. public sharing routes) MUST validate against
 * this same rule — reuse `isValidUsername` rather than re-declaring the regex.
 */
export const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,30}$/

/** True when `user` is a well-formed, non-reserved username. */
export const isValidUsername = (user: string): boolean =>
  USERNAME_REGEX.test(user) && !RESERVED_USERNAMES.includes(user)

export const USERNAME_RULE_MESSAGE =
  'Username must be 3-31 characters, start with a letter, and contain only lowercase letters, numbers, and underscores'

export interface AccountSignupDeps {
  centralDb: Pick<
    CentralDb,
    | 'addAdmin'
    | 'ensureUserAccount'
    | 'getAdminCount'
    | 'getServerSetting'
    | 'getSignupMode'
    | 'isUsernameDeleted'
  >
  invitationAuth: Pick<InvitationAuth, 'validateInvitationToken'>
  /** Whether a Postgres role of that name exists. */
  roleExists: (username: string) => Promise<boolean>
  makeNewUserDb: (username: string, password: string) => Promise<void>
  createToken: (username: string) => string
  signupProfile: SignupProfileDeps
  notifyAdmins: (username: string) => void
  log?: Pick<Console, 'error' | 'info'>
}

export interface AccountSignupInput extends SignupProfile {
  username: string
  password: string
  invitation?: string
}

export type AccountSignupResult =
  | { ok: true; username: string; is_admin: boolean; token: string }
  | { ok: false; status: 400 | 403 | 409; error: string }

const refuse = (status: 400 | 403 | 409, error: string): AccountSignupResult => ({ error, ok: false, status })

/** Whether the server's signup mode lets this visitor create an account; null when it does. */
export const signupGateRefusal = async (
  deps: { centralDb: Pick<CentralDb, 'getSignupMode'>; invitationAuth: AccountSignupDeps['invitationAuth'] },
  invitation: string | undefined | null,
): Promise<string | null> => {
  const mode = await deps.centralDb.getSignupMode()
  if (mode === 'closed') return 'Signup is currently closed'
  if (mode === 'invite_only') {
    if (!invitation) return 'An invitation is required to sign up'
    const validation = deps.invitationAuth.validateInvitationToken(invitation)
    if (!validation.valid) return validation.expired ? 'Invitation has expired' : 'Invalid invitation'
  }
  return null
}

export const isUsernameTaken = async (
  deps: { centralDb: Pick<CentralDb, 'isUsernameDeleted'>; roleExists: AccountSignupDeps['roleExists'] },
  username: string,
): Promise<boolean> => (await deps.roleExists(username)) || (await deps.centralDb.isUsernameDeleted(username))

/**
 * Creates an account the way a password signup does: the signup mode and invitation, the username
 * rule, the role and its database, the account row, the profile, the first user as admin and the
 * admins' notice. Any failure but a role that appeared meanwhile throws.
 */
export const createAccount = async (
  deps: AccountSignupDeps,
  input: AccountSignupInput,
): Promise<AccountSignupResult> => {
  const log = deps.log ?? console
  const gate = await signupGateRefusal(deps, input.invitation)
  if (gate) return refuse(403, gate)

  const { username } = input
  if (!USERNAME_REGEX.test(username)) return refuse(400, USERNAME_RULE_MESSAGE)
  if (RESERVED_USERNAMES.includes(username)) return refuse(400, 'This username is reserved')
  if (await isUsernameTaken(deps, username)) return refuse(409, 'Username already exists')

  try {
    await deps.makeNewUserDb(username, input.password)
  } catch (err) {
    if ((err as { code?: string }).code === '42710') return refuse(409, 'Username already exists')
    throw err
  }
  await recordNewAccount(deps.centralDb, username).catch((e) =>
    log.error(`⚠️ Failed to record account row for ${username}:`, e),
  )
  await saveSignupProfile(deps.signupProfile, username, {
    display_name: input.display_name,
    email: input.email,
  })
  const token = deps.createToken(username)

  let isAdmin = false
  if ((await deps.centralDb.getAdminCount()) === 0) {
    await deps.centralDb.addAdmin(username)
    isAdmin = true
    log.info(`First user ${username} automatically made admin`)
  }
  deps.notifyAdmins(username)

  return { is_admin: isAdmin, ok: true, token, username }
}
