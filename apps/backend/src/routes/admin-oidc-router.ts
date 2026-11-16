import {
  type AddOidcProviderBody,
  type BaseResponse,
  addOidcProviderBodySchema,
  type DeleteOidcProviderQuery,
  deleteOidcProviderQuerySchema,
  type DeleteOidcProviderResponse,
  type OidcProviderResponse,
  type OidcProvidersResponse,
  type UpdateOidcProviderBody,
  updateOidcProviderBodySchema,
} from '@aurboda/api-spec'

import type { OidcProviderAdmin } from '../services/oidc-providers.ts'

import { type AnyMiddleware, type TypedRouter, typedRouter } from '../typed-router.ts'
import { validateBody, validateQuery } from '../validation.ts'

/** The admin's sign-in providers, mounted at `/admin/oidc-providers`. */
export const createAdminOidcRouter = (
  authMiddleware: AnyMiddleware,
  adminMiddleware: AnyMiddleware,
  providers: OidcProviderAdmin,
): TypedRouter => {
  const router = typedRouter()

  router.get<Record<string, never>, OidcProvidersResponse>(
    '/',
    authMiddleware,
    adminMiddleware,
    async (_req, res) => {
      res.json({ providers: await providers.list(), redirect_uri: providers.redirectUri, success: true })
    },
  )

  router.post<Record<string, never>, OidcProviderResponse | BaseResponse, AddOidcProviderBody>(
    '/',
    authMiddleware,
    adminMiddleware,
    validateBody(addOidcProviderBodySchema),
    async (req, res) => {
      const result = await providers.add(req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.status(201).json({ provider: result.provider, success: true })
    },
  )

  router.put<{ id: string }, OidcProviderResponse | BaseResponse, UpdateOidcProviderBody>(
    '/:id',
    authMiddleware,
    adminMiddleware,
    validateBody(updateOidcProviderBodySchema),
    async (req, res) => {
      const result = await providers.update(req.params.id, req.body)
      if (!result.ok) return res.status(result.status).json({ error: result.error, success: false })
      res.json({ provider: result.provider, success: true })
    },
  )

  router.delete<{ id: string }, DeleteOidcProviderResponse, unknown, DeleteOidcProviderQuery>(
    '/:id',
    authMiddleware,
    adminMiddleware,
    validateQuery(deleteOidcProviderQuerySchema),
    async (req, res) => {
      const result = await providers.remove(req.params.id, req.query.force === true)
      if (!result.ok) {
        return res
          .status(result.status)
          .json({ error: result.error, stranded_users: result.stranded_users, success: false })
      }
      res.json({ removed_links: result.removed_links, stranded_users: result.stranded_users, success: true })
    },
  )

  return router
}
