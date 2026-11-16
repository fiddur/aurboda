import { describe, expect, test, vi } from 'vitest'

import type { AccountSignupInput, AccountSignupResult } from './account-signup.ts'
import type { OidcCodeRecord, OidcFlowRecord, OidcLinkRecord, OidcProviderRecord } from './central-oidc.ts'
import type { OidcIdentity } from './oidc-client.ts'

import {
  createOidcService,
  emailDomainAllowed,
  hashOidcSecret,
  OIDC_LINK_EXPIRED_ERROR,
  type OidcServiceDeps,
  usernameFromEmail,
} from './oidc.ts'

const WEB = 'https://aurboda.test'
const REDIRECT = 'https://aurboda.test/api/auth/oidc/callback'
const T0 = new Date('2026-11-16T10:00:00Z')

const provider = (overrides: Partial<OidcProviderRecord> = {}): OidcProviderRecord => ({
  allow_signup: false,
  allowed_email_domains: [],
  client_id: 'client',
  client_secret: 'secret',
  created_at: T0,
  display_name: 'Google',
  enabled: true,
  id: 'google',
  issuer: 'https://accounts.google.com',
  preset: 'google',
  updated_at: T0,
  ...overrides,
})

const identity = (overrides: Partial<OidcIdentity> = {}): OidcIdentity => ({
  email: 'ada.lovelace@example.com',
  email_verified: true,
  iss: 'https://accounts.google.com',
  name: 'Ada Lovelace',
  sub: 'sub-1',
  ...overrides,
})

const createMemoryStore = (providers: OidcProviderRecord[]) => {
  const flows = new Map<string, OidcFlowRecord>()
  const codes = new Map<string, OidcCodeRecord>()
  const links: OidcLinkRecord[] = []
  let signupMode: 'open' | 'invite_only' | 'closed' = 'open'
  const emails = new Map<string, { email: string; verified: boolean }>()
  const passwordLogin = new Map<string, boolean>()
  let nextId = 1

  const store = {
    deleteOidcLink: vi.fn(async (username: string, id: string) => {
      const index = links.findIndex((l) => l.id === id && l.username === username)
      if (index < 0) return false
      links.splice(index, 1)
      return true
    }),
    getOidcLinkBySubject: vi.fn(
      async (issuer: string, subject: string) =>
        links.find((l) => l.issuer === issuer && l.subject === subject) ?? null,
    ),
    getOidcProvider: vi.fn(async (id: string) => providers.find((p) => p.id === id) ?? null),
    getSignupMode: vi.fn(async () => signupMode),
    insertOidcLink: vi.fn(
      async (input: {
        provider_id: string
        issuer: string
        subject: string
        username: string
        email: string | null
      }) => {
        if (links.some((l) => l.issuer === input.issuer && l.subject === input.subject)) return null
        const link: OidcLinkRecord = {
          ...input,
          created_at: T0,
          id: `00000000-0000-4000-8000-00000000000${nextId++}`,
          last_login_at: null,
          provider_display_name: providers.find((p) => p.id === input.provider_id)?.display_name ?? '',
        }
        links.push(link)
        return link
      },
    ),
    isAdmin: vi.fn(async () => false),
    listOidcLinksForUser: vi.fn(async (username: string) => links.filter((l) => l.username === username)),
    listOidcProviders: vi.fn(async () => providers),
    markEmailVerified: vi.fn(async (username: string, email: string) => {
      emails.set(username, { email, verified: true })
      return true
    }),
    peekOidcCode: vi.fn(async (hash: string) => codes.get(hash) ?? null),
    pruneOidcFlows: vi.fn(async () => {}),
    recordOidcLogin: vi.fn(async (id: string, _email: string | null, at: Date) => {
      const link = links.find((l) => l.id === id)
      if (link) link.last_login_at = at
    }),
    saveOidcCode: vi.fn(async (code: OidcCodeRecord) => {
      codes.set(code.code_hash, code)
    }),
    saveOidcFlow: vi.fn(async (flow: OidcFlowRecord) => {
      flows.set(flow.state_hash, flow)
    }),
    setPasswordLogin: vi.fn(async (username: string, enabled: boolean) => {
      passwordLogin.set(username, enabled)
      return true
    }),
    setUserEmail: vi.fn(async (username: string, email: string | null) => {
      if (email) emails.set(username, { email, verified: false })
      return {} as never
    }),
    takeOidcCode: vi.fn(async (hash: string) => {
      const code = codes.get(hash) ?? null
      codes.delete(hash)
      return code
    }),
    takeOidcFlow: vi.fn(async (hash: string) => {
      const flow = flows.get(hash) ?? null
      flows.delete(hash)
      return flow
    }),
  }
  return {
    codes,
    emails,
    flows,
    links,
    passwordLogin,
    setSignupMode: (mode: typeof signupMode) => {
      signupMode = mode
    },
    store,
  }
}

const setup = ({
  providers = [provider()],
  identityFor = () => identity(),
  loginMethods = 2,
  validInvitations = ['good-invite'],
}: {
  providers?: OidcProviderRecord[]
  identityFor?: () => OidcIdentity
  loginMethods?: number
  validInvitations?: string[]
} = {}) => {
  const memory = createMemoryStore(providers)
  let clock = T0.getTime()
  let counter = 0
  const exchange = vi.fn(async (_url: URL, _checks: { state: string; nonce: string; codeVerifier: string }) =>
    identityFor(),
  )
  const authorizationUrl = vi.fn(
    async ({ state }: { state: string }) => `https://accounts.google.com/auth?state=${state}`,
  )
  const createAccount = vi.fn(
    async (input: AccountSignupInput): Promise<AccountSignupResult> =>
      input.username === 'taken'
        ? { error: 'Username already exists', ok: false, status: 409 }
        : { is_admin: false, ok: true, token: `token-${input.username}`, username: input.username },
  )
  const startEmailVerification = vi.fn()
  const deps: OidcServiceDeps = {
    createAccount,
    createSessionToken: (username) => `session-${username}`,
    discover: vi.fn(async () => ({ authorizationUrl, exchange })),
    invitationAuth: {
      validateInvitationToken: (token: string) =>
        validInvitations.includes(token) ? { valid: true } : { expired: false, valid: false },
    } as never,
    log: { error: vi.fn(), warn: vi.fn() },
    loginMethods: vi.fn(async () => loginMethods),
    now: () => new Date(clock),
    randomToken: () => `random-${++counter}`,
    redirectUri: REDIRECT,
    startEmailVerification,
    store: memory.store as never,
    usernameTaken: async (username) => username === 'taken',
    webHost: WEB,
  }
  const service = createOidcService(deps)

  let lastVerifier = ''
  const startAndCallback = async (
    target: Parameters<typeof service.start>[1] = { intent: 'login' },
    extra: Record<string, string> = {},
  ) => {
    const started = await service.start('google', target)
    if (!started.ok) throw new Error('start failed')
    lastVerifier = started.verifier
    const state = new URL(started.authorization_url).searchParams.get('state')!
    return service.callback(new URLSearchParams({ code: 'provider-code', state, ...extra }))
  }

  return {
    advance: (ms: number) => {
      clock += ms
    },
    authorizationUrl,
    createAccount,
    deps,
    exchange,
    memory,
    service,
    startAndCallback,
    startEmailVerification,
    verifier: () => lastVerifier,
  }
}

const fragmentCode = (location: string) => decodeURIComponent(new URL(location).hash.replace('#code=', ''))

describe('usernameFromEmail', () => {
  test.each([
    ['ada.lovelace@example.com', 'ada_lovelace'],
    ['Ada+Tag@example.com', 'ada_tag'],
    ['42ada@example.com', 'ada'],
    ['ab@example.com', ''],
    ['admin@example.com', ''],
    [null, ''],
    [`${'x'.repeat(40)}@example.com`, 'x'.repeat(31)],
  ])('%s → %s', (email, expected) => {
    expect(usernameFromEmail(email)).toBe(expected)
  })
})

describe('emailDomainAllowed', () => {
  test('any identity when the provider lists no domain', () => {
    expect(emailDomainAllowed({ allowed_email_domains: [] }, identity({ email_verified: false }))).toBe(true)
  })

  test('needs a verified email in a listed domain', () => {
    const p = { allowed_email_domains: ['example.com'] }
    expect(emailDomainAllowed(p, identity())).toBe(true)
    expect(emailDomainAllowed(p, identity({ email: 'ada@EXAMPLE.com' }))).toBe(true)
    expect(emailDomainAllowed(p, identity({ email_verified: false }))).toBe(false)
    expect(emailDomainAllowed(p, identity({ email: 'ada@evil.com' }))).toBe(false)
    expect(emailDomainAllowed(p, identity({ email: undefined }))).toBe(false)
    expect(emailDomainAllowed(p, identity({ email: 'ada@sub.example.com' }))).toBe(false)
  })
})

describe('OIDC flow service', () => {
  test('lists only enabled providers, without their configuration', async () => {
    const { service } = setup({ providers: [provider(), provider({ enabled: false, id: 'other' })] })
    expect(await service.listPublicProviders()).toEqual([
      { allow_signup: false, display_name: 'Google', id: 'google', preset: 'google' },
    ])
  })

  test('start keeps the state, nonce and PKCE verifier server-side, and hands out a verifier kept only as a hash', async () => {
    const { service, memory, authorizationUrl } = setup()
    const result = await service.start('google', { intent: 'login', invitation: 'inv' })
    expect(result).toEqual({
      authorization_url: 'https://accounts.google.com/auth?state=random-1',
      ok: true,
      verifier: 'random-4',
    })
    expect(authorizationUrl).toHaveBeenCalledWith({
      codeVerifier: 'random-3',
      nonce: 'random-2',
      redirectUri: REDIRECT,
      state: 'random-1',
    })
    expect([...memory.flows.values()]).toEqual([
      {
        code_verifier: 'random-3',
        created_at: T0,
        intent: 'login',
        invitation: 'inv',
        nonce: 'random-2',
        provider_id: 'google',
        state_hash: hashOidcSecret('random-1'),
        username: null,
        verifier_hash: hashOidcSecret('random-4'),
      },
    ])
    expect(JSON.stringify([...memory.flows.values()])).not.toContain('"random-4"')
  })

  test('start refuses an unknown or disabled provider', async () => {
    const { service } = setup({ providers: [provider({ enabled: false })] })
    expect(await service.start('google', { intent: 'login' })).toMatchObject({ ok: false, status: 404 })
    expect(await service.start('nope', { intent: 'login' })).toMatchObject({ ok: false, status: 404 })
  })

  test('start answers 502 when discovery fails', async () => {
    const { service, deps } = setup()
    vi.mocked(deps.discover).mockRejectedValueOnce(new Error('down'))
    expect(await service.start('google', { intent: 'login' })).toMatchObject({ ok: false, status: 502 })
  })

  test('the callback hands the provider its redirect URI with every query parameter and the stored checks', async () => {
    const { startAndCallback, exchange } = setup()
    await startAndCallback({ intent: 'login' }, { iss: 'https://accounts.google.com' })
    const [url, checks] = exchange.mock.lastCall!
    expect(url.origin + url.pathname).toBe(REDIRECT)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      code: 'provider-code',
      iss: 'https://accounts.google.com',
      state: 'random-1',
    })
    expect(checks).toEqual({ codeVerifier: 'random-3', nonce: 'random-2', state: 'random-1' })
  })

  describe('login', () => {
    test('a linked identity gets a login code that trades once for a session', async () => {
      const { service, memory, startAndCallback, verifier } = setup()
      await memory.store.insertOidcLink({
        email: null,
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 'sub-1',
        username: 'ada',
      })
      const location = await startAndCallback()
      expect(location).toMatch(new RegExp(`^${WEB}/login/oidc#code=`))
      expect(memory.links[0].last_login_at).toEqual(T0)

      const code = fragmentCode(location)
      expect(await service.exchange(code, verifier())).toEqual({
        is_admin: false,
        ok: true,
        token: 'session-ada',
        username: 'ada',
      })
      expect(await service.exchange(code, verifier())).toEqual({ ok: false })
    })

    test('a login code with a wrong verifier fails and is used up', async () => {
      const { service, memory, startAndCallback, verifier } = setup()
      await memory.store.insertOidcLink({
        email: null,
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 'sub-1',
        username: 'ada',
      })
      const code = fragmentCode(await startAndCallback())
      expect(await service.exchange(code, 'not-the-verifier')).toEqual({ ok: false })
      expect(await service.exchange(code, verifier())).toEqual({ ok: false })
    })

    test('a login code is good for 60 seconds', async () => {
      const { service, memory, startAndCallback, advance, verifier } = setup()
      await memory.store.insertOidcLink({
        email: null,
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 'sub-1',
        username: 'ada',
      })
      const code = fragmentCode(await startAndCallback())
      advance(61_000)
      expect(await service.exchange(code, verifier())).toEqual({ ok: false })
    })

    test('a signup code cannot be traded for a session', async () => {
      const { service, startAndCallback, verifier } = setup({ providers: [provider({ allow_signup: true })] })
      const code = fragmentCode(await startAndCallback())
      expect(await service.exchange(code, verifier())).toEqual({ ok: false })
    })

    test('an unlinked identity is not_linked when the provider allows no signup', async () => {
      const { startAndCallback } = setup()
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=not_linked`)
    })

    test('an unlinked identity whose email matches an account is still not_linked', async () => {
      const { startAndCallback, memory } = setup()
      memory.emails.set('ada', { email: 'ada.lovelace@example.com', verified: true })
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=not_linked`)
    })

    test('the provider refusing is failed', async () => {
      const { startAndCallback, exchange } = setup()
      expect(await startAndCallback({ intent: 'login' }, { error: 'access_denied' })).toBe(
        `${WEB}/login?oidc_error=failed`,
      )
      expect(exchange).not.toHaveBeenCalled()
    })

    test('an ID token that does not validate is failed', async () => {
      const { startAndCallback, exchange } = setup()
      exchange.mockRejectedValueOnce(new Error('nonce mismatch'))
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=failed`)
    })

    test('an email outside the allowed domains is domain_not_allowed', async () => {
      const { startAndCallback } = setup({
        identityFor: () => identity({ email: 'ada@evil.com' }),
        providers: [provider({ allowed_email_domains: ['example.com'] })],
      })
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=domain_not_allowed`)
    })
  })

  describe('state', () => {
    test('an unknown or missing state is expired', async () => {
      const { service } = setup()
      expect(await service.callback(new URLSearchParams({ code: 'c', state: 'forged' }))).toBe(
        `${WEB}/login?oidc_error=expired`,
      )
      expect(await service.callback(new URLSearchParams({ code: 'c' }))).toBe(
        `${WEB}/login?oidc_error=expired`,
      )
    })

    test('a state is used once', async () => {
      const { service } = setup()
      const started = await service.start('google', { intent: 'login' })
      const state = new URL((started as { authorization_url: string }).authorization_url).searchParams.get(
        'state',
      )!
      await service.callback(new URLSearchParams({ code: 'c', state }))
      expect(await service.callback(new URLSearchParams({ code: 'c', state }))).toBe(
        `${WEB}/login?oidc_error=expired`,
      )
    })

    test('a state older than 10 minutes is expired', async () => {
      const { service, advance, exchange } = setup()
      const started = await service.start('google', { intent: 'login' })
      const state = new URL((started as { authorization_url: string }).authorization_url).searchParams.get(
        'state',
      )!
      advance(10 * 60 * 1000 + 1)
      expect(await service.callback(new URLSearchParams({ code: 'c', state }))).toBe(
        `${WEB}/login?oidc_error=expired`,
      )
      expect(exchange).not.toHaveBeenCalled()
    })
  })

  describe('signup', () => {
    const signupSetup = (mode: 'open' | 'invite_only' | 'closed' = 'open', overrides = {}) => {
      const s = setup({ providers: [provider({ allow_signup: true, ...overrides })] })
      s.memory.setSignupMode(mode)
      return s
    }

    test('an unlinked identity on an open server gets a signup code, and its details', async () => {
      const { service, startAndCallback } = signupSetup()
      const location = await startAndCallback()
      expect(location).toMatch(new RegExp(`^${WEB}/signup/oidc#code=`))
      const code = fragmentCode(location)
      expect(await service.signupInfo(code)).toEqual({
        info: {
          display_name: 'Ada Lovelace',
          email: 'ada.lovelace@example.com',
          provider_display_name: 'Google',
          suggested_username: 'ada_lovelace',
        },
        ok: true,
      })
      expect(await service.signupInfo(code)).toMatchObject({ ok: true })
    })

    test('suggests no username when it is taken', async () => {
      const { service, startAndCallback } = setup({
        identityFor: () => identity({ email: 'taken@example.com' }),
        providers: [provider({ allow_signup: true })],
      })
      const code = fragmentCode(await startAndCallback())
      expect(await service.signupInfo(code)).toMatchObject({ info: { suggested_username: '' }, ok: true })
    })

    test('signup creates the account through createAccount, links the identity and keeps the verified email', async () => {
      const { service, startAndCallback, createAccount, memory, startEmailVerification, verifier } =
        signupSetup()
      const code = fragmentCode(await startAndCallback())

      expect(
        await service.signup({ code, display_name: 'Ada', username: 'ada', verifier: verifier() }),
      ).toEqual({
        is_admin: false,
        ok: true,
        token: 'token-ada',
        username: 'ada',
      })
      expect(createAccount).toHaveBeenCalledWith({
        display_name: 'Ada',
        invitation: undefined,
        password: expect.any(String),
        username: 'ada',
      })
      expect(memory.passwordLogin.get('ada')).toBe(false)
      expect(memory.links).toMatchObject([
        { issuer: 'https://accounts.google.com', subject: 'sub-1', username: 'ada' },
      ])
      expect(memory.emails.get('ada')).toEqual({ email: 'ada.lovelace@example.com', verified: true })
      expect(startEmailVerification).not.toHaveBeenCalled()
      expect(await service.signup({ code, username: 'ada2', verifier: verifier() })).toMatchObject({
        ok: false,
        status: 400,
      })
    })

    test('a wrong verifier is refused like an expired code, and the code is used up', async () => {
      const { service, startAndCallback, createAccount, verifier } = signupSetup()
      const code = fragmentCode(await startAndCallback())
      const wrong = await service.signup({ code, username: 'ada', verifier: 'not-the-verifier' })
      expect(wrong).toEqual({
        error: 'This sign-up link has expired; start again from the sign-up page',
        ok: false,
        status: 400,
      })
      expect(await service.signup({ code, username: 'ada', verifier: verifier() })).toEqual(wrong)
      expect(createAccount).not.toHaveBeenCalled()
    })

    test('an unverified email is saved and sent a verification link', async () => {
      const { service, memory, startEmailVerification } = setup({
        identityFor: () => identity({ email_verified: false }),
        providers: [provider({ allow_signup: true })],
      })
      const started = await service.start('google', { intent: 'login' })
      if (!started.ok) throw new Error('start failed')
      const state = new URL(started.authorization_url).searchParams.get('state')!
      const code = fragmentCode(await service.callback(new URLSearchParams({ code: 'c', state })))
      await service.signup({ code, username: 'ada', verifier: started.verifier })
      expect(memory.emails.get('ada')).toEqual({ email: 'ada.lovelace@example.com', verified: false })
      expect(startEmailVerification).toHaveBeenCalledWith('ada')
    })

    test('a refused username keeps the code for another try', async () => {
      const { service, startAndCallback, verifier } = signupSetup()
      const code = fragmentCode(await startAndCallback())
      expect(await service.signup({ code, username: 'taken', verifier: verifier() })).toEqual({
        error: 'Username already exists',
        ok: false,
        status: 409,
      })
      expect(await service.signup({ code, username: 'ada', verifier: verifier() })).toMatchObject({
        ok: true,
      })
    })

    test('a signup code is good for 5 minutes', async () => {
      const { service, startAndCallback, advance, verifier } = signupSetup()
      const code = fragmentCode(await startAndCallback())
      advance(5 * 60 * 1000 + 1)
      expect(await service.signupInfo(code)).toEqual({ ok: false })
      expect(await service.signup({ code, username: 'ada', verifier: verifier() })).toMatchObject({
        ok: false,
        status: 400,
      })
    })

    test('a closed server is signup_closed', async () => {
      const { startAndCallback } = signupSetup('closed')
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=signup_closed`)
    })

    test('an invite-only server needs a valid invitation carried from start, and passes it on', async () => {
      const { startAndCallback, service, createAccount, verifier } = signupSetup('invite_only')
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=signup_closed`)
      expect(await startAndCallback({ intent: 'login', invitation: 'bad' })).toBe(
        `${WEB}/login?oidc_error=signup_closed`,
      )
      const code = fragmentCode(await startAndCallback({ intent: 'login', invitation: 'good-invite' }))
      await service.signup({ code, username: 'ada', verifier: verifier() })
      expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({ invitation: 'good-invite' }))
    })

    test('the domain rule applies to signup', async () => {
      const { startAndCallback } = setup({
        identityFor: () => identity({ email_verified: false }),
        providers: [provider({ allow_signup: true, allowed_email_domains: ['example.com'] })],
      })
      expect(await startAndCallback()).toBe(`${WEB}/login?oidc_error=domain_not_allowed`)
    })
  })

  describe('link', () => {
    const linkCode = async (s: ReturnType<typeof setup>, username = 'ada') => {
      const location = await s.startAndCallback({ intent: 'link', username })
      expect(location).toMatch(new RegExp(`^${WEB}/settings/oidc-link#code=`))
      return fragmentCode(location)
    }

    test('the callback links nothing: it issues a link code for the settings page', async () => {
      const s = setup()
      await linkCode(s)
      expect(s.memory.links).toEqual([])
      expect([...s.memory.codes.values()]).toMatchObject([
        { kind: 'link', subject: 'sub-1', username: 'ada', verifier_hash: hashOidcSecret(s.verifier()) },
      ])
    })

    test('the user who started it completes it with the verifier', async () => {
      const s = setup()
      const code = await linkCode(s)
      expect(await s.service.completeLink('ada', code, s.verifier())).toEqual({ ok: true })
      expect(s.memory.links).toMatchObject([{ provider_id: 'google', subject: 'sub-1', username: 'ada' }])
      expect(await s.service.completeLink('ada', code, s.verifier())).toMatchObject({
        ok: false,
        status: 400,
      })
    })

    test("another account's session cannot complete it, and the code is used up", async () => {
      const s = setup()
      const code = await linkCode(s, 'mallory')
      expect(await s.service.completeLink('ada', code, s.verifier())).toEqual({
        error: OIDC_LINK_EXPIRED_ERROR,
        ok: false,
        status: 400,
      })
      expect(s.memory.links).toEqual([])
      expect(await s.service.completeLink('mallory', code, s.verifier())).toMatchObject({ ok: false })
    })

    test('a wrong verifier is refused', async () => {
      const s = setup()
      const code = await linkCode(s)
      expect(await s.service.completeLink('ada', code, 'not-the-verifier')).toMatchObject({
        ok: false,
        status: 400,
      })
      expect(s.memory.links).toEqual([])
    })

    test('a link code is good for 5 minutes', async () => {
      const s = setup()
      const code = await linkCode(s)
      s.advance(5 * 60 * 1000 + 1)
      expect(await s.service.completeLink('ada', code, s.verifier())).toMatchObject({
        ok: false,
        status: 400,
      })
    })

    test('a login or signup code does not complete a link', async () => {
      const s = setup({ providers: [provider({ allow_signup: true })] })
      const code = fragmentCode(await s.startAndCallback())
      expect(await s.service.completeLink('ada', code, s.verifier())).toMatchObject({
        ok: false,
        status: 400,
      })
    })

    test('an identity linked to another user is 409, and to this user already is a success', async () => {
      const s = setup()
      await s.memory.store.insertOidcLink({
        email: null,
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 'sub-1',
        username: 'bob',
      })
      expect(await s.service.completeLink('ada', await linkCode(s), s.verifier())).toEqual({
        error: 'This sign-in is linked to another account already',
        ok: false,
        status: 409,
      })
      expect(await s.service.completeLink('bob', await linkCode(s, 'bob'), s.verifier())).toEqual({
        ok: true,
      })
      expect(s.memory.links).toHaveLength(1)
    })

    test('the domain rule applies to linking', async () => {
      const { startAndCallback } = setup({
        identityFor: () => identity({ email: 'ada@evil.com' }),
        providers: [provider({ allowed_email_domains: ['example.com'] })],
      })
      expect(await startAndCallback({ intent: 'link', username: 'ada' })).toBe(
        `${WEB}/settings?oidc_error=domain_not_allowed#sign-in-providers`,
      )
    })
  })

  describe('links', () => {
    const linked = async (loginMethods: number) => {
      const s = setup({ loginMethods })
      const link = await s.memory.store.insertOidcLink({
        email: 'ada@example.com',
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 'sub-1',
        username: 'ada',
      })
      return { ...s, link: link! }
    }

    test('lists the links with the login method count', async () => {
      const { service, link } = await linked(2)
      expect(await service.listLinks('ada')).toEqual({
        links: [
          {
            created_at: T0.toISOString(),
            email: 'ada@example.com',
            id: link.id,
            last_login_at: null,
            provider_display_name: 'Google',
            provider_id: 'google',
          },
        ],
        login_methods: 2,
      })
    })

    test('unlinks when another login method is left', async () => {
      const { service, link, memory } = await linked(2)
      expect(await service.unlink('ada', link.id)).toEqual({ ok: true })
      expect(memory.links).toEqual([])
    })

    test('refuses to unlink the last login method', async () => {
      const { service, link, memory } = await linked(1)
      expect(await service.unlink('ada', link.id)).toMatchObject({ ok: false, status: 409 })
      expect(memory.links).toHaveLength(1)
    })

    test("cannot unlink someone else's link", async () => {
      const { service, link } = await linked(2)
      expect(await service.unlink('bob', link.id)).toMatchObject({ ok: false, status: 404 })
    })
  })
})
