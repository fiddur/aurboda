import express from 'express'
import { createHash, generateKeyPairSync, randomUUID, sign } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import supertest from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from 'vitest'

import type { AccountSignupInput, AccountSignupResult } from '../services/account-signup.ts'

import {
  ALTER_OIDC_FLOWS_COLUMNS,
  createOidcApi,
  CREATE_OIDC_CODES_TABLE,
  CREATE_OIDC_FLOWS_TABLE,
  CREATE_OIDC_LINKS_TABLE,
  CREATE_OIDC_PROVIDERS_TABLE,
} from '../services/central-oidc.ts'
import {
  ALTER_USER_ACCOUNTS_LOGIN_COLUMNS,
  ALTER_USER_ACCOUNTS_PLAN_COLUMNS,
  ALTER_USER_ACCOUNTS_PROFILE_COLUMNS,
  createUserAccountsApi,
  CREATE_USER_ACCOUNTS_TABLE,
} from '../services/central-user-accounts.ts'
import { createLoginMethodCounter } from '../services/login-methods.ts'
import { createDiscoveryCache, createOidcClient } from '../services/oidc-client.ts'
import { createOidcService } from '../services/oidc.ts'
import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { createOidcRouter } from './oidc-router.ts'

const CONTAINER_TIMEOUT = 120_000
const WEB = 'https://web.aurboda.test'
const REDIRECT = 'https://aurboda.test/api/auth/oidc/callback'
const CLIENT_ID = 'aurboda-client'
const CLIENT_SECRET = 'aurboda-secret'

const base64url = (value: Buffer | string) => Buffer.from(value).toString('base64url')

/** A tiny OpenID provider: discovery, JWKS, and a token endpoint that signs an RS256 ID token. */
const startFakeIssuer = async () => {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const jwk = { ...publicKey.export({ format: 'jwk' }), alg: 'RS256', kid: 'k1', use: 'sig' }
  const grants = new Map<string, { nonce: string; challenge: string; sub: string; email: string }>()
  let nextIdentity = { email: 'ada.lovelace@example.com', sub: 'user-1' }
  let issuer = ''

  const idToken = (claims: Record<string, unknown>) => {
    const header = base64url(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' }))
    const payload = base64url(JSON.stringify(claims))
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), privateKey)
    return `${header}.${payload}.${base64url(signature)}`
  }

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', issuer)
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(body))
    }
    if (url.pathname === '/.well-known/openid-configuration') {
      return json(200, {
        authorization_endpoint: `${issuer}/authorize`,
        id_token_signing_alg_values_supported: ['RS256'],
        issuer,
        jwks_uri: `${issuer}/jwks`,
        response_types_supported: ['code'],
        subject_types_supported: ['public'],
        token_endpoint: `${issuer}/token`,
      })
    }
    if (url.pathname === '/jwks') return json(200, { keys: [jwk] })
    if (url.pathname === '/token' && req.method === 'POST') {
      let body = ''
      req.on('data', (chunk) => (body += chunk))
      req.on('end', () => {
        const form = new URLSearchParams(body)
        const grant = grants.get(form.get('code') ?? '')
        const verifier = form.get('code_verifier') ?? ''
        const challenge = createHash('sha256').update(verifier).digest('base64url')
        if (
          !grant ||
          grant.challenge !== challenge ||
          form.get('client_id') !== CLIENT_ID ||
          form.get('client_secret') !== CLIENT_SECRET ||
          form.get('redirect_uri') !== REDIRECT
        ) {
          return json(400, { error: 'invalid_grant' })
        }
        grants.delete(form.get('code')!)
        const now = Math.floor(Date.now() / 1000)
        json(200, {
          access_token: 'at',
          id_token: idToken({
            aud: CLIENT_ID,
            email: grant.email,
            email_verified: true,
            exp: now + 300,
            iat: now,
            iss: issuer,
            name: 'Ada Lovelace',
            nonce: grant.nonce,
            sub: grant.sub,
          }),
          token_type: 'Bearer',
        })
      })
      return
    }
    json(404, {})
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('no port')
  issuer = `http://127.0.0.1:${address.port}`

  /** What the user's browser does at the provider: approve, and get sent back with a code. */
  const authorize = (authorizationUrl: string): URLSearchParams => {
    const url = new URL(authorizationUrl)
    expect(url.origin).toBe(issuer)
    expect(url.searchParams.get('code_challenge_method')).toBe('S256')
    expect(url.searchParams.get('redirect_uri')).toBe(REDIRECT)
    const code = randomUUID()
    grants.set(code, {
      challenge: url.searchParams.get('code_challenge')!,
      nonce: url.searchParams.get('nonce')!,
      ...nextIdentity,
    })
    return new URLSearchParams({ code, iss: issuer, state: url.searchParams.get('state')! })
  }

  return {
    authorize,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    get issuer() {
      return issuer
    },
    setIdentity: (identity: { email: string; sub: string }) => {
      nextIdentity = identity
    },
  }
}

describe('OIDC sign-in end to end, against a fake issuer', () => {
  let fakeIssuer: Awaited<ReturnType<typeof startFakeIssuer>>
  const createAccount = vi.fn(
    async (input: AccountSignupInput): Promise<AccountSignupResult> => ({
      is_admin: false,
      ok: true,
      token: `session-${input.username}`,
      username: input.username,
    }),
  )

  const buildApp = () => {
    const getClient = async () => getTestDbClient()
    const oidcStore = createOidcApi(getClient, async (fn) => fn(getTestDbClient()))
    const accounts = createUserAccountsApi(getClient)
    const store = {
      ...oidcStore,
      ...accounts,
      getSignupMode: async () => 'open' as const,
      isAdmin: async () => false,
    }
    const service = createOidcService({
      createAccount: async (input) => {
        const result = await createAccount(input)
        if (result.ok) {
          await accounts.ensureUserAccount(input.username, { createdAt: new Date(), preExisting: false })
        }
        return result
      },
      createSessionToken: (username) => `session-${username}`,
      discover: createDiscoveryCache(createOidcClient({ allowHttp: true })),
      invitationAuth: { validateInvitationToken: () => ({ valid: true }) } as never,
      log: { error: vi.fn(), warn: vi.fn() },
      loginMethods: createLoginMethodCounter({
        countOidcLinks: oidcStore.countOidcLinks,
        countPasskeys: async () => 0,
        getPasswordLogin: accounts.getPasswordLogin,
      }),
      redirectUri: REDIRECT,
      store,
      usernameTaken: async () => false,
      webHost: WEB,
    })
    const app = express()
    app.use(express.json())
    app.use(
      createOidcRouter((req, _res, next) => {
        req.user = req.headers.authorization?.replace('Bearer session-', '')
        next()
      }, service),
    )
    return app
  }

  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    for (const stmt of [
      CREATE_OIDC_PROVIDERS_TABLE,
      CREATE_OIDC_LINKS_TABLE,
      CREATE_OIDC_FLOWS_TABLE,
      ...ALTER_OIDC_FLOWS_COLUMNS,
      CREATE_OIDC_CODES_TABLE,
      CREATE_USER_ACCOUNTS_TABLE,
      ...ALTER_USER_ACCOUNTS_PLAN_COLUMNS,
      ...ALTER_USER_ACCOUNTS_PROFILE_COLUMNS,
      ...ALTER_USER_ACCOUNTS_LOGIN_COLUMNS,
    ]) {
      await client.query(stmt)
    }
    fakeIssuer = await startFakeIssuer()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await fakeIssuer?.close()
    await stopTestDb()
  })

  beforeEach(async () => {
    const client = getTestDbClient()
    await client.query('TRUNCATE TABLE oidc_codes, oidc_flows, oidc_links, oidc_providers, user_accounts')
    await createOidcApi(
      async () => client,
      async (fn) => fn(client),
    ).insertOidcProvider({
      allow_signup: true,
      allowed_email_domains: ['example.com'],
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET,
      display_name: 'Fake',
      enabled: true,
      id: 'fake',
      issuer: fakeIssuer.issuer,
      preset: null,
    })
  })

  const OTHER_VERIFIER = 'x'.repeat(43)

  const signIn = async (app: express.Express, start: string, token?: string) => {
    const request = supertest(app).post(start).send({})
    const started = await (token ? request.set('Authorization', `Bearer ${token}`) : request)
    expect(started.status).toBe(200)
    const verifier = started.body.verifier as string
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const callback = await supertest(app).get(
      `/auth/oidc/callback?${fakeIssuer.authorize(started.body.authorization_url)}`,
    )
    expect(callback.status).toBe(302)
    const location = callback.headers.location as string
    const hash = new URL(location).hash
    const code = hash.startsWith('#code=') ? decodeURIComponent(hash.slice('#code='.length)) : ''
    return { code, location, verifier }
  }

  test(
    'start → callback → signup, then start → callback → exchange, each with the verifier of its start',
    async () => {
      const app = buildApp()
      expect((await supertest(app).get('/auth/oidc/providers')).body).toEqual({
        providers: [{ allow_signup: true, display_name: 'Fake', id: 'fake', preset: null }],
      })

      const toSignup = await signIn(app, '/auth/oidc/fake/start')
      expect(toSignup.location).toMatch(new RegExp(`^${WEB}/signup/oidc#code=`))

      const info = await supertest(app).get('/auth/oidc/signup-info').query({ code: toSignup.code })
      expect(info.body).toEqual({
        display_name: 'Ada Lovelace',
        email: 'ada.lovelace@example.com',
        provider_display_name: 'Fake',
        success: true,
        suggested_username: 'ada_lovelace',
      })

      const signup = await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: toSignup.code, username: 'ada', verifier: toSignup.verifier })
      expect(signup.body).toEqual({ is_admin: false, success: true, token: 'session-ada', username: 'ada' })
      expect(createAccount).toHaveBeenCalledWith(expect.objectContaining({ username: 'ada' }))

      const links = await supertest(app).get('/account/oidc/links').set('Authorization', 'Bearer session-ada')
      expect(links.body).toMatchObject({
        links: [{ email: 'ada.lovelace@example.com', provider_display_name: 'Fake', provider_id: 'fake' }],
        login_methods: 1,
        success: true,
      })
      const unlink = await supertest(app)
        .delete(`/account/oidc/links/${links.body.links[0].id}`)
        .set('Authorization', 'Bearer session-ada')
      expect(unlink.status).toBe(409)

      const toLogin = await signIn(app, '/auth/oidc/fake/start')
      expect(toLogin.location).toMatch(new RegExp(`^${WEB}/login/oidc#code=`))
      const exchange = { code: toLogin.code, verifier: toLogin.verifier }
      const exchanged = await supertest(app).post('/auth/oidc/exchange').send(exchange)
      expect(exchanged.body).toEqual({
        is_admin: false,
        success: true,
        token: 'session-ada',
        username: 'ada',
      })
      expect((await supertest(app).post('/auth/oidc/exchange').send(exchange)).status).toBe(400)
    },
    CONTAINER_TIMEOUT,
  )

  test(
    'a callback URL replayed into a browser without the verifier neither signs up nor signs in',
    async () => {
      const app = buildApp()
      const toSignup = await signIn(app, '/auth/oidc/fake/start')
      const noVerifier = await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: toSignup.code, username: 'victim' })
      expect(noVerifier.status).toBe(400)
      const otherVerifier = await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: toSignup.code, username: 'victim', verifier: OTHER_VERIFIER })
      expect(otherVerifier.status).toBe(400)
      expect(createAccount).not.toHaveBeenCalledWith(expect.objectContaining({ username: 'victim' }))
      const spent = await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: toSignup.code, username: 'victim', verifier: toSignup.verifier })
      expect(spent.status).toBe(400)

      const fresh = await signIn(app, '/auth/oidc/fake/start')
      await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: fresh.code, username: 'attacker', verifier: fresh.verifier })
        .expect(200)
      const toLogin = await signIn(app, '/auth/oidc/fake/start')
      expect(toLogin.location).toMatch(new RegExp(`^${WEB}/login/oidc#code=`))
      const replayed = await supertest(app)
        .post('/auth/oidc/exchange')
        .send({ code: toLogin.code, verifier: OTHER_VERIFIER })
      expect(replayed.status).toBe(400)
      expect(replayed.body.token).toBeUndefined()
    },
    CONTAINER_TIMEOUT,
  )

  test(
    'a link is completed by the signed-in account that started it, and the callback refuses a forged state',
    async () => {
      const app = buildApp()
      fakeIssuer.setIdentity({ email: 'bob@example.com', sub: 'user-2' })
      const toLink = await signIn(app, '/account/oidc/fake/link/start', 'session-bob')
      expect(toLink.location).toMatch(new RegExp(`^${WEB}/settings/oidc-link#code=`))
      const listLinks = async () =>
        (await supertest(app).get('/account/oidc/links').set('Authorization', 'Bearer session-bob')).body
          .links
      expect(await listLinks()).toHaveLength(0)

      const completed = await supertest(app)
        .post('/account/oidc/link/complete')
        .set('Authorization', 'Bearer session-bob')
        .send({ code: toLink.code, verifier: toLink.verifier })
      expect(completed.body).toEqual({ success: true })
      expect(await listLinks()).toHaveLength(1)

      const forged = await supertest(app).get('/auth/oidc/callback?code=x&state=forged')
      expect(forged.status).toBe(302)
      expect(forged.headers.location).toBe(`${WEB}/login?oidc_error=expired`)
    },
    CONTAINER_TIMEOUT,
  )

  test(
    'the app: a linked identity comes back to the custom scheme with a code the verifier trades for a session',
    async () => {
      const app = buildApp()
      fakeIssuer.setIdentity({ email: 'ada.lovelace@example.com', sub: 'user-1' })
      const toSignup = await signIn(app, '/auth/oidc/fake/start')
      await supertest(app)
        .post('/auth/oidc/signup')
        .send({ code: toSignup.code, username: 'ada', verifier: toSignup.verifier })
        .expect(200)

      const appSignIn = async () => {
        const started = await supertest(app).post('/auth/oidc/fake/start').send({ client: 'app' })
        expect(started.status).toBe(200)
        const callback = await supertest(app).get(
          `/auth/oidc/callback?${fakeIssuer.authorize(started.body.authorization_url)}`,
        )
        expect(callback.status).toBe(302)
        const location = callback.headers.location as string
        return { location, params: new URL(location).searchParams, verifier: started.body.verifier as string }
      }

      const signedIn = await appSignIn()
      expect(signedIn.location).toMatch(/^net\.aurboda\.oidc:\/\/callback\?code=/)
      const exchanged = await supertest(app)
        .post('/auth/oidc/exchange')
        .send({ code: signedIn.params.get('code'), verifier: signedIn.verifier })
      expect(exchanged.body).toEqual({
        is_admin: false,
        success: true,
        token: 'session-ada',
        username: 'ada',
      })

      const intercepted = await appSignIn()
      const withoutVerifier = await supertest(app)
        .post('/auth/oidc/exchange')
        .send({ code: intercepted.params.get('code'), verifier: OTHER_VERIFIER })
      expect(withoutVerifier.status).toBe(400)

      fakeIssuer.setIdentity({ email: 'new@example.com', sub: 'user-9' })
      const unlinked = await appSignIn()
      expect(unlinked.location).toBe('net.aurboda.oidc://callback?error=not_linked')
      const codes = await getTestDbClient().query('SELECT COUNT(*)::integer AS count FROM oidc_codes')
      expect(codes.rows[0].count).toBe(0)

      fakeIssuer.setIdentity({ email: 'eve@example.org', sub: 'user-10' })
      expect((await appSignIn()).location).toBe('net.aurboda.oidc://callback?error=domain_not_allowed')
    },
    CONTAINER_TIMEOUT,
  )

  test(
    "another account cannot complete someone else's link flow",
    async () => {
      const app = buildApp()
      fakeIssuer.setIdentity({ email: 'victim@example.com', sub: 'user-3' })
      const toLink = await signIn(app, '/account/oidc/fake/link/start', 'session-mallory')
      const stolen = await supertest(app)
        .post('/account/oidc/link/complete')
        .set('Authorization', 'Bearer session-victim')
        .send({ code: toLink.code, verifier: toLink.verifier })
      expect(stolen.status).toBe(400)
      for (const user of ['victim', 'mallory']) {
        const links = await supertest(app)
          .get('/account/oidc/links')
          .set('Authorization', `Bearer session-${user}`)
        expect(links.body.links).toEqual([])
      }
    },
    CONTAINER_TIMEOUT,
  )
})
