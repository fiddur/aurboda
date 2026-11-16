import {
  addOidcProviderBodySchema,
  oidcProviderIdSchema,
  updateOidcProviderBodySchema,
} from '@aurboda/api-spec'
import { z } from 'zod'

import type { CentralDb } from '../services/central-db.ts'
import type { OidcProviderAdmin } from '../services/oidc-providers.ts'

import { errorResponse, jsonResponse, type McpServer } from './helpers.ts'

export const registerAdminOidcTools = (
  server: McpServer,
  user: string,
  centralDb: Pick<CentralDb, 'isAdmin'>,
  providers: OidcProviderAdmin,
) => {
  const requireAdmin = async (): Promise<string | null> =>
    (await centralDb.isAdmin(user)) ? null : 'Admin permission required'

  server.tool(
    'list_oidc_providers',
    'List the single sign-on (OpenID Connect) providers users can log in, link and sign up with, and the redirect URI to register with each provider. The client secret is never returned, only client_secret_set. Admin-only.',
    {},
    async () => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      return jsonResponse({
        providers: await providers.list(),
        redirect_uri: providers.redirectUri,
        success: true,
      })
    },
  )

  server.tool(
    'add_oidc_provider',
    'Add a single sign-on (OpenID Connect) provider. The issuer must be https and is checked by fetching its discovery document. Register the returned redirect_uri with the provider. For Google use issuer https://accounts.google.com and preset google. Admin-only.',
    { ...addOidcProviderBodySchema.shape },
    async (params) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const result = await providers.add(params)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ provider: result.provider, success: true })
    },
  )

  server.tool(
    'update_oidc_provider',
    'Change a single sign-on provider. An omitted field, the client secret included, keeps its value; a new issuer is checked like on add. Admin-only.',
    {
      id: oidcProviderIdSchema.describe('Provider id, from list_oidc_providers'),
      ...updateOidcProviderBodySchema.shape,
    },
    async ({ id, ...fields }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const result = await providers.update(id, fields)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({ provider: result.provider, success: true })
    },
  )

  server.tool(
    'delete_oidc_provider',
    'Delete a single sign-on provider and every link to it. Refused when a linked user would be left with no way to log in, unless force is true. Admin-only.',
    {
      force: z
        .boolean()
        .optional()
        .describe('Delete even when a linked user would be left with no login method'),
      id: oidcProviderIdSchema.describe('Provider id, from list_oidc_providers'),
    },
    async ({ id, force }) => {
      const denied = await requireAdmin()
      if (denied) return errorResponse(denied)
      const result = await providers.remove(id, force === true)
      if (!result.ok) return errorResponse(result.error)
      return jsonResponse({
        removed_links: result.removed_links,
        stranded_users: result.stranded_users,
        success: true,
      })
    },
  )
}
