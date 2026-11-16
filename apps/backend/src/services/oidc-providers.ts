import type { AddOidcProviderBody, OidcProvider, UpdateOidcProviderBody } from '@aurboda/api-spec'

import type { CentralDb } from './central-db.ts'
import type { OidcProviderRecord } from './central-oidc.ts'
import type { LoginMethodCounter } from './login-methods.ts'

import { issuerUrlProblem } from './oidc-client.ts'

export const oidcRedirectUri = (apiBaseUrl: string): string => `${apiBaseUrl}/auth/oidc/callback`

export const serializeOidcProvider = (record: OidcProviderRecord, redirectUri: string): OidcProvider => ({
  allow_signup: record.allow_signup,
  allowed_email_domains: record.allowed_email_domains,
  client_id: record.client_id,
  client_secret_set: record.client_secret !== '',
  created_at: record.created_at.toISOString(),
  display_name: record.display_name,
  enabled: record.enabled,
  id: record.id,
  issuer: record.issuer,
  preset: record.preset,
  redirect_uri: redirectUri,
  updated_at: record.updated_at.toISOString(),
})

export type OidcProviderAdminResult =
  | { ok: true; provider: OidcProvider }
  | { ok: false; status: 400 | 404 | 409; error: string }

export type OidcProviderRemoveResult =
  | { ok: true; removed_links: number; stranded_users: number }
  | { ok: false; status: 404 | 409; error: string; stranded_users?: number }

export interface OidcProviderAdmin {
  redirectUri: string
  list: () => Promise<OidcProvider[]>
  add: (body: AddOidcProviderBody) => Promise<OidcProviderAdminResult>
  update: (id: string, body: UpdateOidcProviderBody) => Promise<OidcProviderAdminResult>
  remove: (id: string, force: boolean) => Promise<OidcProviderRemoveResult>
}

export interface OidcProviderAdminDeps {
  store: Pick<
    CentralDb,
    | 'deleteOidcProvider'
    | 'getOidcProvider'
    | 'insertOidcProvider'
    | 'listOidcLinksForProvider'
    | 'listOidcProviders'
    | 'updateOidcProvider'
  >
  /** Fetches the issuer's discovery document; throws when it does not answer as an OIDC issuer. */
  verifyIssuer: (issuer: string, clientId: string, clientSecret: string) => Promise<void>
  loginMethods: LoginMethodCounter
  redirectUri: string
  allowHttp: boolean
}

/** The admin's management of sign-in providers, shared by REST and MCP. */
export const createOidcProviderAdmin = (deps: OidcProviderAdminDeps): OidcProviderAdmin => {
  const { store, redirectUri } = deps

  const checkIssuer = async (
    issuer: string,
    clientId: string,
    clientSecret: string,
  ): Promise<{ ok: false; status: 400; error: string } | null> => {
    const problem = issuerUrlProblem(issuer, deps.allowHttp)
    if (problem) return { error: problem, ok: false, status: 400 }
    try {
      await deps.verifyIssuer(issuer, clientId, clientSecret)
      return null
    } catch {
      return {
        error: `${issuer} did not answer as an OpenID Connect issuer (no valid /.well-known/openid-configuration)`,
        ok: false,
        status: 400,
      }
    }
  }

  const strandedUsers = async (providerId: string): Promise<number> => {
    const links = await store.listOidcLinksForProvider(providerId)
    const perUser = new Map<string, number>()
    for (const link of links) perUser.set(link.username, (perUser.get(link.username) ?? 0) + 1)
    let stranded = 0
    for (const [username, here] of perUser) {
      if ((await deps.loginMethods(username)) - here <= 0) stranded += 1
    }
    return stranded
  }

  return {
    add: async (body) => {
      const { issuer } = body
      const refused = await checkIssuer(issuer, body.client_id, body.client_secret)
      if (refused) return refused
      const record = await store.insertOidcProvider({
        allow_signup: body.allow_signup ?? false,
        allowed_email_domains: body.allowed_email_domains ?? [],
        client_id: body.client_id,
        client_secret: body.client_secret,
        display_name: body.display_name,
        enabled: body.enabled ?? true,
        id: body.id,
        issuer,
        preset: body.preset ?? null,
      })
      if (!record) {
        return { error: `A provider with the id ${body.id} exists already`, ok: false, status: 409 }
      }
      return { ok: true, provider: serializeOidcProvider(record, redirectUri) }
    },

    list: async () =>
      (await store.listOidcProviders()).map((record) => serializeOidcProvider(record, redirectUri)),

    redirectUri,

    remove: async (id, force) => {
      if (!(await store.getOidcProvider(id))) return { error: 'Provider not found', ok: false, status: 404 }
      const stranded = await strandedUsers(id)
      if (stranded > 0 && !force) {
        return {
          error: `${stranded} linked user(s) would have no way left to log in; delete with force to do it anyway`,
          ok: false,
          status: 409,
          stranded_users: stranded,
        }
      }
      const removed = await store.deleteOidcProvider(id)
      if (removed === null) return { error: 'Provider not found', ok: false, status: 404 }
      return { ok: true, removed_links: removed, stranded_users: stranded }
    },

    update: async (id, body) => {
      const current = await store.getOidcProvider(id)
      if (!current) return { error: 'Provider not found', ok: false, status: 404 }
      const { issuer } = body
      if (issuer !== undefined && issuer !== current.issuer) {
        const refused = await checkIssuer(
          issuer,
          body.client_id ?? current.client_id,
          body.client_secret ?? current.client_secret,
        )
        if (refused) return refused
      }
      const record = await store.updateOidcProvider(id, body)
      if (!record) return { error: 'Provider not found', ok: false, status: 404 }
      return { ok: true, provider: serializeOidcProvider(record, redirectUri) }
    },
  }
}
