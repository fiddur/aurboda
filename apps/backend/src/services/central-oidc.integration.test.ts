import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  ALTER_OIDC_FLOWS_COLUMNS,
  createOidcApi,
  CREATE_OIDC_CODES_TABLE,
  CREATE_OIDC_FLOWS_TABLE,
  CREATE_OIDC_INDEXES,
  CREATE_OIDC_LINKS_TABLE,
  CREATE_OIDC_PROVIDERS_TABLE,
  type OidcProviderInput,
} from './central-oidc.ts'
import {
  ALTER_USER_ACCOUNTS_LOGIN_COLUMNS,
  ALTER_USER_ACCOUNTS_PLAN_COLUMNS,
  ALTER_USER_ACCOUNTS_PROFILE_COLUMNS,
  createUserAccountsApi,
  CREATE_USER_ACCOUNTS_TABLE,
} from './central-user-accounts.ts'

const CONTAINER_TIMEOUT = 120_000

const providerInput = (overrides: Partial<OidcProviderInput> = {}): OidcProviderInput => ({
  allow_signup: true,
  allowed_email_domains: ['example.com'],
  client_id: 'client',
  client_secret: 'secret',
  display_name: 'Google',
  enabled: true,
  id: 'google',
  issuer: 'https://accounts.google.com',
  preset: 'google',
  ...overrides,
})

describe('central OIDC store', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    for (const stmt of [
      CREATE_OIDC_PROVIDERS_TABLE,
      CREATE_OIDC_LINKS_TABLE,
      CREATE_OIDC_FLOWS_TABLE,
      ...ALTER_OIDC_FLOWS_COLUMNS,
      CREATE_OIDC_CODES_TABLE,
      ...CREATE_OIDC_INDEXES,
      CREATE_USER_ACCOUNTS_TABLE,
      ...ALTER_USER_ACCOUNTS_PLAN_COLUMNS,
      ...ALTER_USER_ACCOUNTS_PROFILE_COLUMNS,
      ...ALTER_USER_ACCOUNTS_LOGIN_COLUMNS,
    ]) {
      await client.query(stmt)
    }
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query(
      'TRUNCATE TABLE oidc_codes, oidc_flows, oidc_links, oidc_providers, user_accounts',
    )
  })

  const api = () =>
    createOidcApi(
      async () => getTestDbClient(),
      async (fn) => {
        const client = getTestDbClient()
        await client.query('BEGIN')
        try {
          const result = await fn(client)
          await client.query('COMMIT')
          return result
        } catch (error) {
          await client.query('ROLLBACK')
          throw error
        }
      },
    )

  test('providers: insert once, get, list, update keeps omitted fields', async () => {
    const a = api()
    const inserted = await a.insertOidcProvider(providerInput())
    expect(inserted).toMatchObject({ allowed_email_domains: ['example.com'], id: 'google', preset: 'google' })
    expect(inserted?.created_at).toBeInstanceOf(Date)
    expect(await a.insertOidcProvider(providerInput())).toBeNull()
    await a.insertOidcProvider(providerInput({ id: 'keycloak', preset: null }))

    expect((await a.getOidcProvider('google'))?.client_secret).toBe('secret')
    expect(await a.getOidcProvider('nope')).toBeNull()
    expect((await a.listOidcProviders()).map((p) => p.id)).toEqual(['google', 'keycloak'])

    const updated = await a.updateOidcProvider('google', { allowed_email_domains: [], display_name: 'G' })
    expect(updated).toMatchObject({ allowed_email_domains: [], client_secret: 'secret', display_name: 'G' })
    expect(updated!.updated_at.getTime()).toBeGreaterThanOrEqual(inserted!.updated_at.getTime())
    expect(await a.updateOidcProvider('nope', { display_name: 'x' })).toBeNull()
  })

  test('links: unique per (issuer, subject), listed with the provider name, counted and deleted per user', async () => {
    const a = api()
    await a.insertOidcProvider(providerInput())
    const link = await a.insertOidcLink({
      email: 'ada@example.com',
      issuer: 'https://accounts.google.com',
      provider_id: 'google',
      subject: 's1',
      username: 'ada',
    })
    expect(link).toMatchObject({ provider_display_name: 'Google', subject: 's1', username: 'ada' })
    expect(
      await a.insertOidcLink({
        email: null,
        issuer: 'https://accounts.google.com',
        provider_id: 'google',
        subject: 's1',
        username: 'bob',
      }),
    ).toBeNull()

    expect((await a.getOidcLinkBySubject('https://accounts.google.com', 's1'))?.id).toBe(link!.id)
    expect(await a.getOidcLinkBySubject('https://other', 's1')).toBeNull()
    expect((await a.listOidcLinksForUser('ada')).map((l) => l.id)).toEqual([link!.id])
    expect((await a.listOidcLinksForProvider('google')).map((l) => l.username)).toEqual(['ada'])
    expect(await a.countOidcLinks('ada')).toBe(1)
    expect(await a.countOidcLinks('bob')).toBe(0)

    const at = new Date('2026-11-16T10:00:00Z')
    await a.recordOidcLogin(link!.id, null, at)
    expect(await a.getOidcLinkBySubject('https://accounts.google.com', 's1')).toMatchObject({
      email: 'ada@example.com',
      last_login_at: at,
    })
    await a.recordOidcLogin(link!.id, 'ada@new.example.com', at)
    expect((await a.listOidcLinksForUser('ada'))[0].email).toBe('ada@new.example.com')

    expect(await a.deleteOidcLink('bob', link!.id)).toBe(false)
    expect(await a.deleteOidcLink('ada', link!.id)).toBe(true)
    expect(await a.countOidcLinks('ada')).toBe(0)
  })

  test('deleting a provider deletes its links, flows and codes', async () => {
    const a = api()
    await a.insertOidcProvider(providerInput())
    for (const subject of ['s1', 's2']) {
      await a.insertOidcLink({ email: null, issuer: 'i', provider_id: 'google', subject, username: subject })
    }
    const now = new Date()
    await a.saveOidcFlow({
      client: null,
      code_verifier: 'v',
      created_at: now,
      intent: 'login',
      invitation: null,
      nonce: 'n',
      provider_id: 'google',
      state_hash: 'h',
      username: null,
      verifier_hash: 'vh',
    })
    expect(await a.deleteOidcProvider('google')).toBe(2)
    expect(await a.deleteOidcProvider('google')).toBeNull()
    expect(await a.countOidcLinks('s1')).toBe(0)
    expect(await a.takeOidcFlow('h')).toBeNull()
  })

  test('flows and codes are single use, codes can be peeked, and old ones are pruned', async () => {
    const a = api()
    await a.insertOidcProvider(providerInput())
    const old = new Date('2026-11-16T09:00:00Z')
    const fresh = new Date('2026-11-16T10:00:00Z')
    const flow = {
      client: null,
      code_verifier: 'v',
      created_at: fresh,
      intent: 'link' as const,
      invitation: null,
      nonce: 'n',
      provider_id: 'google',
      state_hash: 'h1',
      username: 'ada',
      verifier_hash: 'vh',
    }
    await a.saveOidcFlow(flow)
    await a.saveOidcFlow({ ...flow, created_at: old, state_hash: 'h2' })
    const appFlow = {
      ...flow,
      client: 'app' as const,
      intent: 'login' as const,
      state_hash: 'h3',
      username: null,
    }
    await a.saveOidcFlow(appFlow)
    const code = {
      code_hash: 'c1',
      created_at: fresh,
      email: 'ada@example.com',
      email_verified: true,
      invitation: 'inv',
      issuer: 'i',
      kind: 'signup' as const,
      name: 'Ada',
      provider_id: 'google',
      subject: 's',
      username: null,
      verifier_hash: 'vh',
    }
    await a.saveOidcCode(code)
    await a.saveOidcCode({ ...code, code_hash: 'c2', created_at: old })

    expect(await a.peekOidcCode('c1')).toEqual(code)
    expect(await a.takeOidcCode('c1')).toEqual(code)
    expect(await a.takeOidcCode('c1')).toBeNull()
    expect(await a.takeOidcFlow('h1')).toEqual(flow)
    expect(await a.takeOidcFlow('h1')).toBeNull()
    expect(await a.takeOidcFlow('h3')).toEqual(appFlow)

    await a.pruneOidcFlows(new Date('2026-11-16T09:30:00Z'), new Date('2026-11-16T09:30:00Z'))
    expect(await a.takeOidcFlow('h2')).toBeNull()
    expect(await a.peekOidcCode('c2')).toBeNull()
  })

  test('password_login defaults to true and can be turned off on an existing row only', async () => {
    const accounts = createUserAccountsApi(async () => getTestDbClient())
    expect(await accounts.getPasswordLogin('ada')).toBe(true)
    expect(await accounts.setPasswordLogin('ada', false)).toBe(false)
    await accounts.ensureUserAccount('ada', { createdAt: new Date(), preExisting: false })
    expect(await accounts.getPasswordLogin('ada')).toBe(true)
    expect(await accounts.setPasswordLogin('ada', false)).toBe(true)
    expect(await accounts.getPasswordLogin('ada')).toBe(false)
    await accounts.setPasswordLogin('ada', true)
    expect(await accounts.getPasswordLogin('ada')).toBe(true)
  })
})
