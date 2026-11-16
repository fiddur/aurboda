import { describe, expect, test, vi } from 'vitest'

import type { OidcLinkRecord, OidcProviderRecord } from './central-oidc.ts'

import { createLoginMethodCounter } from './login-methods.ts'
import { createOidcProviderAdmin, oidcRedirectUri } from './oidc-providers.ts'

const T0 = new Date('2026-11-16T10:00:00Z')
const REDIRECT = oidcRedirectUri('https://aurboda.test/api')

const record = (overrides: Partial<OidcProviderRecord> = {}): OidcProviderRecord => ({
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

const link = (username: string): OidcLinkRecord => ({
  created_at: T0,
  email: null,
  id: `id-${username}`,
  issuer: 'https://accounts.google.com',
  last_login_at: null,
  provider_display_name: 'Google',
  provider_id: 'google',
  subject: `sub-${username}`,
  username,
})

const setup = ({
  providers = [record()],
  links = [] as OidcLinkRecord[],
  methods = {} as Record<string, number>,
  verifyFails = false,
} = {}) => {
  const store = {
    deleteOidcProvider: vi.fn(async () => links.length),
    getOidcProvider: vi.fn(async (id: string) => providers.find((p) => p.id === id) ?? null),
    insertOidcProvider: vi.fn(async (input: Omit<OidcProviderRecord, 'created_at' | 'updated_at'>) =>
      providers.some((p) => p.id === input.id) ? null : { ...input, created_at: T0, updated_at: T0 },
    ),
    listOidcLinksForProvider: vi.fn(async () => links),
    listOidcProviders: vi.fn(async () => providers),
    updateOidcProvider: vi.fn(async (id: string, fields: Partial<OidcProviderRecord>) => {
      const current = providers.find((p) => p.id === id)
      return current
        ? { ...current, ...Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined)) }
        : null
    }),
  }
  const verifyIssuer = vi.fn(async () => {
    if (verifyFails) throw new Error('404')
  })
  const admin = createOidcProviderAdmin({
    allowHttp: false,
    loginMethods: async (username) => methods[username] ?? 1,
    redirectUri: REDIRECT,
    store,
    verifyIssuer,
  })
  return { admin, store, verifyIssuer }
}

describe('OIDC provider admin', () => {
  test('lists providers without the secret, with the redirect URI', async () => {
    const { admin } = setup({
      providers: [record(), record({ client_secret: '', id: 'other', preset: null })],
    })
    const listed = await admin.list()
    expect(listed[0]).toEqual({
      allow_signup: false,
      allowed_email_domains: [],
      client_id: 'client',
      client_secret_set: true,
      created_at: T0.toISOString(),
      display_name: 'Google',
      enabled: true,
      id: 'google',
      issuer: 'https://accounts.google.com',
      preset: 'google',
      redirect_uri: 'https://aurboda.test/api/auth/oidc/callback',
      updated_at: T0.toISOString(),
    })
    expect(listed[1].client_secret_set).toBe(false)
    expect(JSON.stringify(listed)).not.toContain('secret"')
  })

  test('add checks the issuer by discovery and fills the defaults', async () => {
    const { admin, store, verifyIssuer } = setup({ providers: [] })
    const result = await admin.add({
      client_id: 'c',
      client_secret: 's',
      display_name: 'Keycloak',
      id: 'keycloak',
      issuer: 'https://sso.example.com/realms/main',
    })
    expect(verifyIssuer).toHaveBeenCalledWith('https://sso.example.com/realms/main', 'c', 's')
    expect(store.insertOidcProvider).toHaveBeenCalledWith({
      allow_signup: false,
      allowed_email_domains: [],
      client_id: 'c',
      client_secret: 's',
      display_name: 'Keycloak',
      enabled: true,
      id: 'keycloak',
      issuer: 'https://sso.example.com/realms/main',
      preset: null,
    })
    expect(result).toMatchObject({ ok: true, provider: { client_secret_set: true, id: 'keycloak' } })
  })

  test('add refuses an http issuer, an issuer that is not OIDC, and a taken id', async () => {
    const body = { client_id: 'c', client_secret: 's', display_name: 'X', id: 'google' }
    expect(await setup({ providers: [] }).admin.add({ ...body, issuer: 'http://sso.example.com' })).toEqual({
      error: 'The issuer must be an https URL',
      ok: false,
      status: 400,
    })
    expect(
      await setup({ providers: [], verifyFails: true }).admin.add({ ...body, issuer: 'https://example.com' }),
    ).toMatchObject({
      error: expect.stringContaining('did not answer as an OpenID Connect issuer'),
      status: 400,
    })
    expect(await setup().admin.add({ ...body, issuer: 'https://accounts.google.com' })).toMatchObject({
      ok: false,
      status: 409,
    })
  })

  test('update keeps an omitted secret and checks only a changed issuer', async () => {
    const { admin, store, verifyIssuer } = setup()
    expect(await admin.update('google', { display_name: 'Google Workspace' })).toMatchObject({
      ok: true,
      provider: { client_secret_set: true, display_name: 'Google Workspace' },
    })
    expect(store.updateOidcProvider).toHaveBeenCalledWith('google', { display_name: 'Google Workspace' })
    expect(verifyIssuer).not.toHaveBeenCalled()
    await admin.update('google', { issuer: 'https://other.example.com' })
    expect(verifyIssuer).toHaveBeenCalledWith('https://other.example.com', 'client', 'secret')
    expect(await admin.update('nope', {})).toMatchObject({ ok: false, status: 404 })
  })

  test('delete refuses when a linked user would have no login method left, unless forced', async () => {
    const links = [link('ada'), link('bob')]
    const { admin, store } = setup({ links, methods: { ada: 1, bob: 2 } })
    expect(await admin.remove('google', false)).toMatchObject({ ok: false, status: 409, stranded_users: 1 })
    expect(store.deleteOidcProvider).not.toHaveBeenCalled()
    expect(await admin.remove('google', true)).toEqual({ ok: true, removed_links: 2, stranded_users: 1 })
  })

  test('delete goes ahead when every linked user keeps a way in', async () => {
    const { admin } = setup({ links: [link('bob')], methods: { bob: 2 } })
    expect(await admin.remove('google', false)).toEqual({ ok: true, removed_links: 1, stranded_users: 0 })
    expect(await admin.remove('nope', false)).toMatchObject({ ok: false, status: 404 })
  })
})

describe('createLoginMethodCounter', () => {
  test('counts a usable password, the passkeys and the links', async () => {
    const count = createLoginMethodCounter({
      countOidcLinks: async () => 1,
      countPasskeys: async () => 2,
      getPasswordLogin: async (u) => u === 'ada',
    })
    expect(await count('ada')).toBe(4)
    expect(await count('bob')).toBe(3)
  })
})
