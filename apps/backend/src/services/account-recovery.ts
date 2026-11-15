import { createHash, randomBytes } from 'node:crypto'

import type { AccountEmailTokenPurpose } from './central-account-email-tokens.ts'
import type { CentralDb } from './central-db.ts'
import type { UserAccount } from './central-user-accounts.ts'
import type { Mailer } from './email.ts'
import type { TokenBucketLimiter } from './rate-limit.ts'

import {
  type RecoveryNoticeKind,
  recoveryEmail,
  recoveryLink,
  recoveryNoticeEmail,
  verificationEmail,
  verifyEmailLink,
} from './email-templates.ts'

export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60 * 1000
export const RECOVERY_TOKEN_TTL_MS = 30 * 60 * 1000
/** An email address that several accounts verified gets a link for each, up to this many. */
export const MAX_RECOVERY_ACCOUNTS_PER_EMAIL = 5

export const newEmailLinkToken = (): string => randomBytes(32).toString('base64url')

export const hashEmailLinkToken = (token: string): string => createHash('sha256').update(token).digest('hex')

export type VerificationSendResult =
  | 'sent'
  | 'already_verified'
  | 'no_email'
  | 'not_configured'
  | 'rate_limited'
  | 'failed'

export type RecoveryCompletion =
  | { ok: true; username: string; token: string; is_admin: boolean }
  | { ok: false }

export interface AccountRecovery {
  /** Sends a verification link to the account's current address, unless it is verified already. */
  sendVerification: (username: string) => Promise<VerificationSendResult>
  /** Resolves to whether the token verified the address it was sent to. */
  verifyEmail: (token: string) => Promise<boolean>
  /** Sends a recovery link to every verified account the identifier names. Never throws. */
  requestRecovery: (identifier: string) => Promise<void>
  completeRecovery: (token: string, newPassword?: string) => Promise<RecoveryCompletion>
}

export interface AccountRecoveryDeps {
  centralDb: Pick<
    CentralDb,
    | 'consumeAccountEmailToken'
    | 'getUserAccount'
    | 'isAdmin'
    | 'issueAccountEmailToken'
    | 'listAccountsByVerifiedEmail'
    | 'markEmailVerified'
  >
  mailer: Pick<Mailer, 'isConfigured' | 'send'>
  webHost: string
  isValidUsername: (username: string) => boolean
  /** Sets the account's (Postgres role's) password. */
  setPassword: (username: string, password: string) => Promise<void>
  createSessionToken: (username: string) => string
  clearFailedLogins: (username: string) => void
  verificationLimiter: TokenBucketLimiter
  recoveryLimiter: TokenBucketLimiter
  /** Writes an entry to the user's own audit log. */
  audit: (username: string, message: string) => Promise<void>
  now?: () => Date
  newToken?: () => string
  log?: Pick<Console, 'error'>
}

const isVerified = (account: UserAccount | null): account is UserAccount & { email: string } =>
  !!account?.email && !!account.email_verified_at

export const createAccountRecovery = ({
  centralDb,
  mailer,
  webHost,
  isValidUsername,
  setPassword,
  createSessionToken,
  clearFailedLogins,
  verificationLimiter,
  recoveryLimiter,
  audit,
  now = () => new Date(),
  newToken = newEmailLinkToken,
  log = console,
}: AccountRecoveryDeps): AccountRecovery => {
  const issue = async (
    username: string,
    purpose: AccountEmailTokenPurpose,
    email: string,
    ttlMs: number,
  ): Promise<string> => {
    const token = newToken()
    await centralDb.issueAccountEmailToken({
      email,
      expires_at: new Date(now().getTime() + ttlMs),
      purpose,
      token_hash: hashEmailLinkToken(token),
      username,
    })
    return token
  }

  const sendRecoveryLink = async (account: UserAccount & { email: string }) => {
    if (!recoveryLimiter.take(account.username).allowed) return
    const token = await issue(account.username, 'reset', account.email, RECOVERY_TOKEN_TTL_MS)
    const link = recoveryLink(webHost, token)
    await mailer.send(account.email, recoveryEmail({ link, username: account.username }), 'recovery')
  }

  const findRecoverableAccounts = async (
    identifier: string,
  ): Promise<(UserAccount & { email: string })[]> => {
    const trimmed = identifier.trim()
    if (trimmed.includes('@')) {
      const accounts = await centralDb.listAccountsByVerifiedEmail(trimmed, MAX_RECOVERY_ACCOUNTS_PER_EMAIL)
      return accounts.filter(isVerified)
    }
    const username = trimmed.toLowerCase()
    if (!isValidUsername(username)) return []
    const account = await centralDb.getUserAccount(username)
    return isVerified(account) ? [account] : []
  }

  const sendNotice = (email: string, username: string, kind: RecoveryNoticeKind) => {
    void mailer
      .send(email, recoveryNoticeEmail({ kind, username }), 'recovery_notice')
      .catch(() => log.error('⚠️ Recovery notice mail failed'))
  }

  return {
    completeRecovery: async (token, newPassword) => {
      const consumed = await centralDb.consumeAccountEmailToken(hashEmailLinkToken(token), 'reset')
      if (!consumed || !isValidUsername(consumed.username)) return { ok: false }
      const account = await centralDb.getUserAccount(consumed.username)
      if (!isVerified(account) || account.email !== consumed.email) return { ok: false }
      const { username } = account
      if (newPassword !== undefined) {
        await setPassword(username, newPassword)
        clearFailedLogins(username)
      }
      const kind: RecoveryNoticeKind = newPassword !== undefined ? 'password_reset' : 'recovery_sign_in'
      await audit(username, kind === 'password_reset' ? 'Password reset by email' : 'Recovery sign-in')
      sendNotice(account.email, username, kind)
      return {
        is_admin: await centralDb.isAdmin(username),
        ok: true,
        token: createSessionToken(username),
        username,
      }
    },

    requestRecovery: async (identifier) => {
      try {
        if (!(await mailer.isConfigured())) return
        for (const account of await findRecoverableAccounts(identifier)) await sendRecoveryLink(account)
      } catch {
        log.error('⚠️ An account recovery request failed')
      }
    },

    sendVerification: async (username) => {
      const account = await centralDb.getUserAccount(username)
      if (!account?.email) return 'no_email'
      if (account.email_verified_at) return 'already_verified'
      if (!(await mailer.isConfigured())) return 'not_configured'
      if (!verificationLimiter.take(username).allowed) return 'rate_limited'
      const token = await issue(username, 'verify', account.email, VERIFY_TOKEN_TTL_MS)
      const result = await mailer.send(
        account.email,
        verificationEmail({ link: verifyEmailLink(webHost, token), username }),
        'verification',
      )
      return result.ok ? 'sent' : result.reason === 'failed' ? 'failed' : 'not_configured'
    },

    verifyEmail: async (token) => {
      const consumed = await centralDb.consumeAccountEmailToken(hashEmailLinkToken(token), 'verify')
      if (!consumed) return false
      return centralDb.markEmailVerified(consumed.username, consumed.email)
    },
  }
}
