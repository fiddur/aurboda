import {
  type BaseResponse,
  type OidcExchangeBody,
  oidcExchangeBodySchema,
  type OidcLinkCompleteBody,
  oidcLinkCompleteBodySchema,
  type OidcLinksResponse,
  type OidcLoginResponse,
  type OidcPublicProvidersResponse,
  type OidcSignupBody,
  oidcSignupBodySchema,
  type OidcSignupInfoQuery,
  oidcSignupInfoQuerySchema,
  type OidcSignupInfoResponse,
  type OidcStartBody,
  oidcStartBodySchema,
  type OidcStartResponse,
} from '@aurboda/api-spec'

import type { OidcService } from '../services/oidc.ts'

import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

const EXPIRED_CODE_ERROR = 'This sign-in has expired or was used already; start again'

/**
 * Sign-in through OpenID Connect providers, mounted at the root. The `/auth/oidc/*` routes are
 * public (rate-limited by `mountRateLimits`); `/account/oidc/*` need a session. Web only: linking
 * runs through browser redirects, so there is no MCP twin.
 */
export const createOidcRouter = (authMiddleware: AnyMiddleware, oidc: OidcService): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, OidcPublicProvidersResponse>(
    '/auth/oidc/providers',
    async (_req, res) => {
      res.json({ providers: await oidc.listPublicProviders() })
    },
  )

  router.get<Record<string, never>, never>('/auth/oidc/callback', async (req, res) => {
    const params = new URL(req.originalUrl, 'http://callback.invalid').searchParams
    res.redirect(302, await oidc.callback(params))
  })

  router.post<Record<string, never>, OidcLoginResponse, OidcExchangeBody>(
    '/auth/oidc/exchange',
    validateBody(oidcExchangeBodySchema),
    async (req, res) => {
      const result = await oidc.exchange(req.body.code, req.body.verifier)
      if (!result.ok) return res.status(400).json({ error: EXPIRED_CODE_ERROR, success: false })
      res.json({ is_admin: result.is_admin, success: true, token: result.token, username: result.username })
    },
  )

  router.get<Record<string, never>, OidcSignupInfoResponse, unknown, OidcSignupInfoQuery>(
    '/auth/oidc/signup-info',
    validateQuery(oidcSignupInfoQuerySchema),
    async (req, res) => {
      const result = await oidc.signupInfo(req.query.code)
      if (!result.ok) return res.status(400).json({ error: EXPIRED_CODE_ERROR, success: false })
      res.json({ ...result.info, success: true })
    },
  )

  router.post<Record<string, never>, OidcLoginResponse, OidcSignupBody>(
    '/auth/oidc/signup',
    validateBody(oidcSignupBodySchema),
    async (req, res) => {
      const result = await oidc.signup(req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ is_admin: result.is_admin, success: true, token: result.token, username: result.username })
    },
  )

  router.post<{ provider: string }, OidcStartResponse, OidcStartBody>(
    '/auth/oidc/:provider/start',
    validateBody(oidcStartBodySchema),
    async (req, res) => {
      const result = await oidc.start(req.params.provider, {
        client: req.body.client,
        intent: 'login',
        invitation: req.body.invitation,
      })
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ authorization_url: result.authorization_url, success: true, verifier: result.verifier })
    },
  )

  router.post<{ provider: string }, OidcStartResponse>(
    '/account/oidc/:provider/link/start',
    authMiddleware,
    async (req, res) => {
      const result = await oidc.start(req.params.provider, { intent: 'link', username: req.user! })
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ authorization_url: result.authorization_url, success: true, verifier: result.verifier })
    },
  )

  router.post<Record<string, never>, BaseResponse, OidcLinkCompleteBody>(
    '/account/oidc/link/complete',
    authMiddleware,
    validateBody(oidcLinkCompleteBodySchema),
    async (req, res) => {
      const result = await oidc.completeLink(req.user!, req.body.code, req.body.verifier)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ success: true })
    },
  )

  router.get<Record<string, never>, OidcLinksResponse>(
    '/account/oidc/links',
    authMiddleware,
    async (req, res) => {
      res.json({ ...(await oidc.listLinks(req.user!)), success: true })
    },
  )

  router.delete<{ id: string }, BaseResponse>('/account/oidc/links/:id', authMiddleware, async (req, res) => {
    const result = await oidc.unlink(req.user!, req.params.id)
    if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
    res.json({ success: true })
  })

  return router
}
