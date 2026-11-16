import {
  OIDC_APP_CALLBACK_URL,
  type OidcClient,
  type OidcErrorCode,
  type OidcLink,
  type OidcPublicProvider,
  type OidcSignupBody,
  type OidcSignupInfoResponse,
} from '@aurboda/api-spec'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

import type { AccountSignupInput, AccountSignupResult } from './account-signup.ts'
import type { CentralDb } from './central-db.ts'
import type {
  OidcCodeKind,
  OidcCodeRecord,
  OidcFlowRecord,
  OidcLinkRecord,
  OidcProviderRecord,
} from './central-oidc.ts'
import type { InvitationAuth } from './invitation.ts'
import type { LoginMethodCounter } from './login-methods.ts'
import type { OidcIdentity, OidcProviderClient } from './oidc-client.ts'

import { isValidUsername, signupGateRefusal } from './account-signup.ts'
import { LAST_LOGIN_METHOD_ERROR } from './login-methods.ts'

export const OIDC_FLOW_TTL_MS = 10 * 60 * 1000
export const OIDC_CODE_TTL_MS: Record<OidcCodeKind, number> = {
  link: 5 * 60 * 1000,
  login: 60 * 1000,
  signup: 5 * 60 * 1000,
}

export const hashOidcSecret = (value: string): string => createHash('sha256').update(value).digest('hex')

const verifierMatches = (verifier: string, verifierHash: string): boolean => {
  const given = Buffer.from(hashOidcSecret(verifier))
  const stored = Buffer.from(verifierHash)
  return given.length === stored.length && timingSafeEqual(given, stored)
}

const newRandomToken = (): string => randomBytes(32).toString('base64url')

export type OidcStartTarget =
  | { intent: 'login'; invitation?: string; client?: OidcClient }
  | { intent: 'link'; username: string }

export type OidcStartResult =
  | { ok: true; authorization_url: string; verifier: string }
  | { ok: false; status: 404 | 502; error: string }

export type OidcExchangeResult =
  | { ok: true; token: string; is_admin: boolean; username: string }
  | { ok: false }

export type OidcSignupInfoResult =
  | { ok: true; info: Required<Omit<OidcSignupInfoResponse, 'success' | 'error'>> }
  | { ok: false }

export type OidcSignupResult =
  | { ok: true; token: string; is_admin: boolean; username: string }
  | { ok: false; status: 400 | 403 | 409; error: string }

export type OidcLinkCompleteResult = { ok: true } | { ok: false; status: 400 | 409; error: string }

export const OIDC_LINK_EXPIRED_ERROR = 'This link has expired; start again from Settings'

export type OidcUnlinkResult = { ok: true } | { ok: false; status: 404 | 409; error: string }

export interface OidcServiceDeps {
  store: Pick<
    CentralDb,
    | 'getOidcLinkBySubject'
    | 'getOidcProvider'
    | 'getSignupMode'
    | 'insertOidcLink'
    | 'isAdmin'
    | 'listOidcLinksForUser'
    | 'listOidcProviders'
    | 'markEmailVerified'
    | 'deleteOidcLink'
    | 'peekOidcCode'
    | 'pruneOidcFlows'
    | 'recordOidcLogin'
    | 'saveOidcCode'
    | 'saveOidcFlow'
    | 'setPasswordLogin'
    | 'setUserEmail'
    | 'takeOidcCode'
    | 'takeOidcFlow'
  >
  discover: (provider: OidcProviderRecord) => Promise<OidcProviderClient>
  invitationAuth: Pick<InvitationAuth, 'validateInvitationToken'>
  createAccount: (input: AccountSignupInput) => Promise<AccountSignupResult>
  usernameTaken: (username: string) => Promise<boolean>
  loginMethods: LoginMethodCounter
  createSessionToken: (username: string) => string
  startEmailVerification?: (username: string) => void
  redirectUri: string
  webHost: string
  now?: () => Date
  randomToken?: () => string
  log?: Pick<Console, 'error' | 'warn'>
}

export interface OidcService {
  listPublicProviders: () => Promise<OidcPublicProvider[]>
  start: (providerId: string, target: OidcStartTarget) => Promise<OidcStartResult>
  /** Where to send the browser after the provider's redirect: a web page, or the app's scheme for an app flow. */
  callback: (params: URLSearchParams) => Promise<string>
  exchange: (code: string, verifier: string) => Promise<OidcExchangeResult>
  signupInfo: (code: string) => Promise<OidcSignupInfoResult>
  signup: (body: OidcSignupBody) => Promise<OidcSignupResult>
  /** Links the identity of a `link` code to `username`, the signed-in user who started the flow. */
  completeLink: (username: string, code: string, verifier: string) => Promise<OidcLinkCompleteResult>
  listLinks: (username: string) => Promise<{ links: OidcLink[]; login_methods: number }>
  unlink: (username: string, id: string) => Promise<OidcUnlinkResult>
}

/** The email's local part reduced to the username rule, or '' when nothing valid is left. */
export const usernameFromEmail = (email: string | null | undefined): string => {
  const local = (email ?? '').split('@')[0].toLowerCase()
  const reduced = local
    .replaceAll(/[^a-z0-9_]+/g, '_')
    .replaceAll(/_+/g, '_')
    .replace(/^[^a-z]+/, '')
    .slice(0, 31)
    .replace(/_+$/, '')
  return isValidUsername(reduced) ? reduced : ''
}

/** Whether the identity passes the provider's email domain rule (any identity when it lists none). */
export const emailDomainAllowed = (
  provider: Pick<OidcProviderRecord, 'allowed_email_domains'>,
  identity: OidcIdentity,
) => {
  if (provider.allowed_email_domains.length === 0) return true
  if (identity.email_verified !== true || !identity.email) return false
  const domain = identity.email.slice(identity.email.lastIndexOf('@') + 1).toLowerCase()
  return provider.allowed_email_domains.some((allowed) => allowed.toLowerCase() === domain)
}

const serializeLink = (link: OidcLinkRecord): OidcLink => ({
  created_at: link.created_at.toISOString(),
  email: link.email,
  id: link.id,
  last_login_at: link.last_login_at?.toISOString() ?? null,
  provider_display_name: link.provider_display_name,
  provider_id: link.provider_id,
})

export const createOidcService = (deps: OidcServiceDeps): OidcService => {
  const { store } = deps
  const now = deps.now ?? (() => new Date())
  const randomToken = deps.randomToken ?? newRandomToken
  const log = deps.log ?? console
  const web = deps.webHost.replace(/\/+$/, '')

  const loginError = (code: OidcErrorCode) => `${web}/login?oidc_error=${code}`
  const settingsError = (code: OidcErrorCode) => `${web}/settings?oidc_error=${code}#sign-in-providers`
  const appError = (code: OidcErrorCode) => `${OIDC_APP_CALLBACK_URL}?error=${code}`

  const isFresh = (createdAt: Date, ttlMs: number) => now().getTime() - createdAt.getTime() <= ttlMs

  const prune = () => {
    const at = now().getTime()
    void store
      .pruneOidcFlows(new Date(at - OIDC_FLOW_TTL_MS), new Date(at - OIDC_CODE_TTL_MS.signup))
      .catch((error: unknown) => log.warn('⚠️ Pruning old OIDC flows failed:', error))
  }

  const issueCode = async (
    kind: OidcCodeKind,
    provider: OidcProviderRecord,
    identity: OidcIdentity,
    fields: { username: string | null; invitation: string | null; verifier_hash: string },
  ): Promise<string> => {
    const code = randomToken()
    await store.saveOidcCode({
      code_hash: hashOidcSecret(code),
      created_at: now(),
      email: identity.email ?? null,
      email_verified: identity.email_verified === true,
      invitation: fields.invitation,
      issuer: identity.iss,
      kind,
      name: identity.name ?? null,
      provider_id: provider.id,
      subject: identity.sub,
      username: fields.username,
      verifier_hash: fields.verifier_hash,
    })
    return code
  }

  const freshCode = (code: OidcCodeRecord | null, kind: OidcCodeKind): code is OidcCodeRecord =>
    code !== null && code.kind === kind && isFresh(code.created_at, OIDC_CODE_TTL_MS[kind])

  const ownCode = (
    code: OidcCodeRecord | null,
    kind: OidcCodeKind,
    verifier: string,
  ): code is OidcCodeRecord => freshCode(code, kind) && verifierMatches(verifier, code.verifier_hash)

  const enabledProvider = async (id: string) => {
    const provider = await store.getOidcProvider(id)
    return provider?.enabled ? provider : null
  }

  const identify = async (
    provider: OidcProviderRecord,
    flow: OidcFlowRecord,
    params: URLSearchParams,
    state: string,
  ): Promise<OidcIdentity | null> => {
    try {
      const client = await deps.discover(provider)
      const callbackUrl = new URL(deps.redirectUri)
      for (const [key, value] of params) callbackUrl.searchParams.append(key, value)
      return await client.exchange(callbackUrl, {
        codeVerifier: flow.code_verifier,
        nonce: flow.nonce,
        state,
      })
    } catch (error) {
      log.warn(`⚠️ OIDC sign-in with ${provider.id} failed:`, error)
      return null
    }
  }

  const issueLinkCode = async (
    provider: OidcProviderRecord,
    flow: OidcFlowRecord,
    identity: OidcIdentity,
  ) => {
    if (!flow.username) return settingsError('failed')
    const code = await issueCode('link', provider, identity, {
      invitation: null,
      username: flow.username,
      verifier_hash: flow.verifier_hash,
    })
    return `${web}/settings/oidc-link#code=${encodeURIComponent(code)}`
  }

  const completeLogin = async (
    provider: OidcProviderRecord,
    flow: OidcFlowRecord,
    identity: OidcIdentity,
  ) => {
    const existing = await store.getOidcLinkBySubject(identity.iss, identity.sub)
    if (existing) {
      await store.recordOidcLogin(existing.id, identity.email ?? null, now())
      const code = await issueCode('login', provider, identity, {
        invitation: null,
        username: existing.username,
        verifier_hash: flow.verifier_hash,
      })
      return flow.client === 'app'
        ? `${OIDC_APP_CALLBACK_URL}?code=${encodeURIComponent(code)}`
        : `${web}/login/oidc#code=${encodeURIComponent(code)}`
    }
    // The signup page needs the verifier in the browser's storage, and for an app flow the app holds it.
    if (flow.client === 'app') return appError('not_linked')
    if (!provider.allow_signup) return loginError('not_linked')
    if (await signupGateRefusal({ centralDb: store, invitationAuth: deps.invitationAuth }, flow.invitation)) {
      return loginError('signup_closed')
    }
    const code = await issueCode('signup', provider, identity, {
      invitation: flow.invitation,
      username: null,
      verifier_hash: flow.verifier_hash,
    })
    return `${web}/signup/oidc#code=${encodeURIComponent(code)}`
  }

  return {
    callback: async (params) => {
      const state = params.get('state')
      if (!state) return loginError('expired')
      const flow = await store.takeOidcFlow(hashOidcSecret(state))
      if (!flow || !isFresh(flow.created_at, OIDC_FLOW_TTL_MS)) return loginError('expired')
      const fail = flow.client === 'app' ? appError : flow.intent === 'link' ? settingsError : loginError
      if (params.get('error')) return fail('failed')

      const provider = await enabledProvider(flow.provider_id)
      if (!provider) return fail('failed')
      const identity = await identify(provider, flow, params, state)
      if (!identity) return fail('failed')
      if (!emailDomainAllowed(provider, identity)) return fail('domain_not_allowed')

      return flow.intent === 'link'
        ? issueLinkCode(provider, flow, identity)
        : completeLogin(provider, flow, identity)
    },

    completeLink: async (username, code, verifier) => {
      const record = await store.takeOidcCode(hashOidcSecret(code))
      if (!ownCode(record, 'link', verifier) || record.username !== username) {
        return { error: OIDC_LINK_EXPIRED_ERROR, ok: false, status: 400 }
      }
      if (!(await enabledProvider(record.provider_id))) {
        return { error: OIDC_LINK_EXPIRED_ERROR, ok: false, status: 400 }
      }
      const alreadyLinked = {
        error: 'This sign-in is linked to another account already',
        ok: false,
        status: 409,
      } as const
      const existing = await store.getOidcLinkBySubject(record.issuer, record.subject)
      if (existing) return existing.username === username ? { ok: true } : alreadyLinked
      const inserted = await store.insertOidcLink({
        email: record.email,
        issuer: record.issuer,
        provider_id: record.provider_id,
        subject: record.subject,
        username,
      })
      return inserted ? { ok: true } : alreadyLinked
    },

    exchange: async (code, verifier) => {
      const record = await store.takeOidcCode(hashOidcSecret(code))
      if (!ownCode(record, 'login', verifier) || !record.username) return { ok: false }
      const link = await store.getOidcLinkBySubject(record.issuer, record.subject)
      if (link?.username !== record.username) return { ok: false }
      return {
        is_admin: await store.isAdmin(record.username),
        ok: true,
        token: deps.createSessionToken(record.username),
        username: record.username,
      }
    },

    listLinks: async (username) => {
      const [links, loginMethods] = await Promise.all([
        store.listOidcLinksForUser(username),
        deps.loginMethods(username),
      ])
      return { links: links.map(serializeLink), login_methods: loginMethods }
    },

    listPublicProviders: async () =>
      (await store.listOidcProviders())
        .filter((provider) => provider.enabled)
        .map((provider) => ({
          allow_signup: provider.allow_signup,
          display_name: provider.display_name,
          id: provider.id,
          preset: provider.preset,
        })),

    signup: async ({ code, verifier, username, display_name }) => {
      const codeHash = hashOidcSecret(code)
      const record = await store.takeOidcCode(codeHash)
      const expired = {
        error: 'This sign-up link has expired; start again from the sign-up page',
        ok: false as const,
        status: 400 as const,
      }
      if (!ownCode(record, 'signup', verifier)) return expired
      const provider = await enabledProvider(record.provider_id)
      if (!provider || !provider.allow_signup) return expired
      if (await store.getOidcLinkBySubject(record.issuer, record.subject)) {
        return {
          error: 'This identity is linked to an account already; log in instead',
          ok: false,
          status: 409,
        }
      }

      const created = await deps.createAccount({
        display_name,
        invitation: record.invitation ?? undefined,
        password: randomToken(),
        username,
      })
      if (!created.ok) {
        await store.saveOidcCode(record)
        return created
      }

      const logFailure = (step: string) => (error: unknown) =>
        log.error(`⚠️ OIDC signup of ${username}: ${step} failed:`, error)
      await store.setPasswordLogin(username, false).catch(logFailure('marking the password unused'))
      const link = await store
        .insertOidcLink({
          email: record.email,
          issuer: record.issuer,
          provider_id: provider.id,
          subject: record.subject,
          username,
        })
        .catch(logFailure('linking the identity'))
      if (!link) log.error(`⚠️ OIDC signup of ${username}: the identity was not linked`)
      if (record.email) {
        const email = record.email
        await (async () => {
          if (!(await store.setUserEmail(username, email))) return
          if (record.email_verified) await store.markEmailVerified(username, email)
          else deps.startEmailVerification?.(username)
        })().catch(logFailure('saving the email'))
      }
      return { is_admin: created.is_admin, ok: true, token: created.token, username }
    },

    signupInfo: async (code) => {
      const record = await store.peekOidcCode(hashOidcSecret(code))
      if (!freshCode(record, 'signup')) return { ok: false }
      const provider = await enabledProvider(record.provider_id)
      if (!provider) return { ok: false }
      const suggestion = usernameFromEmail(record.email)
      return {
        info: {
          display_name: record.name ?? '',
          email: record.email ?? '',
          provider_display_name: provider.display_name,
          suggested_username: suggestion && !(await deps.usernameTaken(suggestion)) ? suggestion : '',
        },
        ok: true,
      }
    },

    start: async (providerId, target) => {
      const provider = await enabledProvider(providerId)
      if (!provider) return { error: 'Unknown sign-in provider', ok: false, status: 404 }
      prune()
      let client: OidcProviderClient
      try {
        client = await deps.discover(provider)
      } catch (error) {
        log.warn(`⚠️ OIDC discovery for ${provider.id} failed:`, error)
        return { error: 'The sign-in provider could not be reached', ok: false, status: 502 }
      }
      const state = randomToken()
      const nonce = randomToken()
      const codeVerifier = randomToken()
      const verifier = randomToken()
      await store.saveOidcFlow({
        client: target.intent === 'login' ? (target.client ?? null) : null,
        code_verifier: codeVerifier,
        created_at: now(),
        intent: target.intent,
        invitation: target.intent === 'login' ? (target.invitation ?? null) : null,
        nonce,
        provider_id: provider.id,
        state_hash: hashOidcSecret(state),
        username: target.intent === 'link' ? target.username : null,
        verifier_hash: hashOidcSecret(verifier),
      })
      const url = await client.authorizationUrl({ codeVerifier, nonce, redirectUri: deps.redirectUri, state })
      return { authorization_url: url, ok: true, verifier }
    },

    unlink: async (username, id) => {
      const links = await store.listOidcLinksForUser(username)
      if (!links.some((link) => link.id === id)) return { error: 'Link not found', ok: false, status: 404 }
      if ((await deps.loginMethods(username)) <= 1) {
        return { error: LAST_LOGIN_METHOD_ERROR, ok: false, status: 409 }
      }
      if (!(await store.deleteOidcLink(username, id))) {
        return { error: 'Link not found', ok: false, status: 404 }
      }
      return { ok: true }
    },
  }
}
