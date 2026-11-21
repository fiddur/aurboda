import { describe, expect, test, vi } from 'vitest'

import type {
  AccountEmailTokenIssue,
  AccountEmailTokenPurpose,
  ConsumedAccountEmailToken,
} from './central-account-email-tokens.ts'
import type { UserAccount } from './central-user-accounts.ts'
import type { MailMessage } from './email-templates.ts'
import type { SendResult } from './email.ts'

import { createAccountRecovery, hashEmailLinkToken } from './account-recovery.ts'
import { createTokenBucketLimiter } from './rate-limit.ts'

const T0 = new Date('2026-11-15T12:00:00Z').getTime()

const account = (username: string, email: string | null, verified: boolean): UserAccount => ({
  created_at: null,
  email,
  email_verified_at: verified ? new Date(T0 - 86_400_000) : null,
  inserted_at: new Date(T0 - 86_400_000),
  paid_until: null,
  plan: null,
  plan_note: null,
  pre_existing: false,
  trial_ends_at: null,
  username,
})

interface StoredToken extends AccountEmailTokenIssue {
  used: boolean
}

/** An in-memory stand-in for the central tables, with the same rules as the SQL. */
const setup = ({
  accounts = [] as UserAccount[],
  configured = true,
  mailCapacity = 3,
  sendResult = { ok: true } as SendResult,
} = {}) => {
  let clock = T0
  const now = () => new Date(clock)
  const rows = new Map(accounts.map((a) => [a.username, { ...a }]))
  const tokens: StoredToken[] = []
  let counter = 0
  const sent: { to: string; message: MailMessage; kind: string }[] = []

  const centralDb = {
    consumeAccountEmailToken: vi.fn(
      async (
        hash: string,
        purpose: AccountEmailTokenPurpose,
        use?: (consumed: ConsumedAccountEmailToken) => Promise<void>,
      ) => {
        const token = tokens.find(
          (t) => t.token_hash === hash && t.purpose === purpose && !t.used && t.expires_at.getTime() > clock,
        )
        if (!token) return null
        const consumed = { email: token.email, username: token.username }
        await use?.(consumed)
        token.used = true
        return consumed
      },
    ),
    getUserAccount: vi.fn(async (username: string) => rows.get(username) ?? null),
    isAdmin: vi.fn(async (username: string) => username === 'root'),
    issueAccountEmailToken: vi.fn(async (issue: AccountEmailTokenIssue) => {
      for (let i = tokens.length - 1; i >= 0; i--) {
        const t = tokens[i]
        if (t.username === issue.username && t.purpose === issue.purpose && !t.used) tokens.splice(i, 1)
      }
      tokens.push({ ...issue, used: false })
    }),
    listAccountsByVerifiedEmail: vi.fn(async (email: string, limit: number) =>
      [...rows.values()]
        .filter((a) => a.email?.toLowerCase() === email.toLowerCase() && a.email_verified_at)
        .slice(0, limit),
    ),
    markEmailVerified: vi.fn(async (username: string, email: string) => {
      const row = rows.get(username)
      if (!row || row.email !== email) return false
      row.email_verified_at = now()
      return true
    }),
  }
  const setPassword = vi.fn(async (_username: string, _password: string) => {})
  const clearFailedLogins = vi.fn()
  const audit = vi.fn(async () => {})
  const pruneAuditLog = vi.fn(async (_username: string) => {})
  const recovery = createAccountRecovery({
    audit,
    centralDb,
    clearFailedLogins,
    createSessionToken: (username) => `session-for-${username}`,
    isValidUsername: (username) => /^[a-z][a-z0-9_]{2,30}$/.test(username),
    log: { error: vi.fn() },
    mailer: {
      isConfigured: async () => configured,
      send: vi.fn(async (to: string, message: MailMessage, kind: string) => {
        sent.push({ kind, message, to })
        return sendResult
      }),
    },
    newToken: () => `token-${++counter}`,
    now,
    pruneAuditLog,
    recoveryLimiter: createTokenBucketLimiter({ capacity: mailCapacity, refill_per_second: 0 }, () => clock),
    setPassword,
    verificationLimiter: createTokenBucketLimiter(
      { capacity: mailCapacity, refill_per_second: 0 },
      () => clock,
    ),
    webHost: 'https://aurboda.example',
  })
  return {
    advance: (ms: number) => {
      clock += ms
    },
    audit,
    centralDb,
    clearFailedLogins,
    pruneAuditLog,
    recovery,
    rows,
    sent,
    setPassword,
    tokens,
  }
}

describe('sendVerification', () => {
  test('mails a 24-hour link to the unverified address, storing only the token hash', async () => {
    const { recovery, sent, tokens } = setup({ accounts: [account('alice', 'alice@example.com', false)] })
    expect(await recovery.sendVerification('alice')).toBe('sent')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'verification', to: 'alice@example.com' })
    expect(sent[0].message.text).toContain('https://aurboda.example/verify-email?token=token-1')
    expect(tokens[0]).toMatchObject({
      email: 'alice@example.com',
      purpose: 'verify',
      token_hash: hashEmailLinkToken('token-1'),
      username: 'alice',
    })
    expect(tokens[0].token_hash).not.toContain('token-1')
    expect(tokens[0].expires_at.getTime() - T0).toBe(24 * 3600 * 1000)
  })

  test.each([
    ['no_email', account('alice', null, false), true],
    ['already_verified', account('alice', 'alice@example.com', true), true],
    ['not_configured', account('alice', 'alice@example.com', false), false],
  ] as const)('is %s without sending', async (result, row, configured) => {
    const { recovery, sent } = setup({ accounts: [row], configured })
    expect(await recovery.sendVerification('alice')).toBe(result)
    expect(sent).toEqual([])
  })

  test('sends at most the limiter allows per account', async () => {
    const { recovery, sent } = setup({
      accounts: [account('alice', 'alice@example.com', false)],
      mailCapacity: 3,
    })
    for (let i = 0; i < 3; i++) expect(await recovery.sendVerification('alice')).toBe('sent')
    expect(await recovery.sendVerification('alice')).toBe('rate_limited')
    expect(sent).toHaveLength(3)
  })

  test('reports a failed send', async () => {
    const { recovery } = setup({
      accounts: [account('alice', 'alice@example.com', false)],
      sendResult: { error: 'nope', ok: false, reason: 'failed' },
    })
    expect(await recovery.sendVerification('alice')).toBe('failed')
  })
})

describe('verifyEmail', () => {
  test('verifies the address once', async () => {
    const { recovery, rows } = setup({ accounts: [account('alice', 'alice@example.com', false)] })
    await recovery.sendVerification('alice')
    expect(await recovery.verifyEmail('token-1')).toBe(true)
    expect(rows.get('alice')?.email_verified_at).not.toBeNull()
    expect(await recovery.verifyEmail('token-1')).toBe(false)
  })

  test('only while the account still has the address the link went to', async () => {
    const { recovery, rows } = setup({ accounts: [account('alice', 'alice@example.com', false)] })
    await recovery.sendVerification('alice')
    rows.get('alice')!.email = 'new@example.com'
    expect(await recovery.verifyEmail('token-1')).toBe(false)
    expect(rows.get('alice')?.email_verified_at).toBeNull()
  })

  test('refuses an expired, unknown, superseded or recovery token', async () => {
    const { advance, recovery } = setup({ accounts: [account('alice', 'alice@example.com', false)] })
    await recovery.sendVerification('alice')
    await recovery.sendVerification('alice')
    expect(await recovery.verifyEmail('token-1')).toBe(false)
    expect(await recovery.verifyEmail('nope')).toBe(false)
    advance(24 * 3600 * 1000 + 1)
    expect(await recovery.verifyEmail('token-2')).toBe(false)
  })
})

describe('requestRecovery', () => {
  const accounts = [
    account('alice', 'alice@example.com', true),
    account('alice2', 'Alice@Example.com', true),
    account('bob', 'bob@example.com', false),
  ]

  test('a username gets a 30-minute link at its verified address', async () => {
    const { recovery, sent, tokens } = setup({ accounts })
    await recovery.requestRecovery(' Alice ')
    expect(sent).toHaveLength(1)
    expect(sent[0]).toMatchObject({ kind: 'recovery', to: 'alice@example.com' })
    expect(sent[0].message.text).toContain('https://aurboda.example/recover?token=token-1')
    expect(sent[0].message.text).toContain('"alice"')
    expect(tokens[0]).toMatchObject({ purpose: 'reset', username: 'alice' })
    expect(tokens[0].expires_at.getTime() - T0).toBe(30 * 60 * 1000)
  })

  test('an email address gets a link for each account that verified it', async () => {
    const { recovery, sent } = setup({ accounts })
    await recovery.requestRecovery('ALICE@example.com')
    expect(sent.map((s) => s.to)).toEqual(['alice@example.com', 'Alice@Example.com'])
    expect(sent[1].message.text).toContain('"alice2"')
  })

  test.each(['bob', 'bob@example.com', 'nobody', 'nobody@example.com', 'Robert; DROP'])(
    'sends nothing for %s (unverified or missing)',
    async (identifier) => {
      const { recovery, sent } = setup({ accounts })
      await recovery.requestRecovery(identifier)
      expect(sent).toEqual([])
    },
  )

  test('sends nothing when email is not configured', async () => {
    const { recovery, sent } = setup({ accounts, configured: false })
    await recovery.requestRecovery('alice')
    expect(sent).toEqual([])
  })

  test('drops mails beyond the per-account cap silently', async () => {
    const { recovery, sent } = setup({ accounts, mailCapacity: 3 })
    for (let i = 0; i < 5; i++) await recovery.requestRecovery('alice')
    expect(sent).toHaveLength(3)
  })

  test('swallows a failure', async () => {
    const { centralDb, recovery } = setup({ accounts })
    centralDb.getUserAccount.mockRejectedValueOnce(new Error('db down'))
    await expect(recovery.requestRecovery('alice')).resolves.toBeUndefined()
  })
})

describe('completeRecovery', () => {
  const requested = async () => {
    const ctx = setup({ accounts: [account('alice', 'alice@example.com', true)] })
    await ctx.recovery.requestRecovery('alice')
    ctx.sent.length = 0
    return ctx
  }

  test('with a password: sets it, clears failed logins, signs in, audits and notifies', async () => {
    const { audit, clearFailedLogins, pruneAuditLog, recovery, sent, setPassword } = await requested()
    expect(await recovery.completeRecovery('token-1', 'new secret')).toEqual({
      is_admin: false,
      ok: true,
      token: 'session-for-alice',
      username: 'alice',
    })
    expect(setPassword).toHaveBeenCalledWith('alice', 'new secret')
    expect(clearFailedLogins).toHaveBeenCalledWith('alice')
    expect(audit).toHaveBeenCalledWith('alice', 'Password reset by email')
    expect(pruneAuditLog).toHaveBeenCalledWith('alice')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0]).toMatchObject({ kind: 'recovery_notice', to: 'alice@example.com' })
    expect(sent[0].message.subject).toBe('Your Aurboda password was reset')
  })

  test('without a password: signs in and changes nothing about the password', async () => {
    const { audit, pruneAuditLog, recovery, sent, setPassword } = await requested()
    expect(await recovery.completeRecovery('token-1')).toMatchObject({ ok: true, token: 'session-for-alice' })
    expect(setPassword).not.toHaveBeenCalled()
    expect(audit).toHaveBeenCalledWith('alice', 'Recovery sign-in')
    expect(pruneAuditLog).toHaveBeenCalledWith('alice')
    await vi.waitFor(() => expect(sent).toHaveLength(1))
    expect(sent[0].message.subject).toBe('Your Aurboda account was signed in to with a recovery link')
  })

  test('a failed audit log prune does not fail the sign-in', async () => {
    const { pruneAuditLog, recovery } = await requested()
    pruneAuditLog.mockRejectedValueOnce(new Error('db down'))
    expect((await recovery.completeRecovery('token-1')).ok).toBe(true)
  })

  test('a refused link prunes nothing', async () => {
    const { pruneAuditLog, recovery } = await requested()
    expect((await recovery.completeRecovery('not-a-token')).ok).toBe(false)
    expect(pruneAuditLog).not.toHaveBeenCalled()
  })

  test('a password that fails to save leaves the link usable', async () => {
    const { recovery, setPassword } = await requested()
    setPassword.mockRejectedValueOnce(new Error('role locked'))
    await expect(recovery.completeRecovery('token-1', 'pw')).rejects.toThrow('role locked')
    expect((await recovery.completeRecovery('token-1', 'pw')).ok).toBe(true)
    expect((await recovery.completeRecovery('token-1', 'pw')).ok).toBe(false)
  })

  test('the link works once', async () => {
    const { recovery } = await requested()
    expect((await recovery.completeRecovery('token-1')).ok).toBe(true)
    expect((await recovery.completeRecovery('token-1')).ok).toBe(false)
  })

  test('expires after 30 minutes', async () => {
    const { advance, recovery } = await requested()
    advance(30 * 60 * 1000 + 1)
    expect((await recovery.completeRecovery('token-1', 'pw')).ok).toBe(false)
  })

  test('is refused once the account email changed or lost its verification', async () => {
    const changed = await requested()
    changed.rows.get('alice')!.email = 'new@example.com'
    expect((await changed.recovery.completeRecovery('token-1', 'pw')).ok).toBe(false)
    expect(changed.setPassword).not.toHaveBeenCalled()

    const unverified = await requested()
    unverified.rows.get('alice')!.email_verified_at = null
    expect((await unverified.recovery.completeRecovery('token-1')).ok).toBe(false)
  })

  test('a verification token cannot be used to recover', async () => {
    const ctx = setup({ accounts: [account('alice', 'alice@example.com', false)] })
    await ctx.recovery.sendVerification('alice')
    ctx.rows.get('alice')!.email_verified_at = new Date(T0)
    expect((await ctx.recovery.completeRecovery('token-1', 'pw')).ok).toBe(false)
  })
})
