/**
 * Single sign-on through OpenID Connect: the providers an admin configures, the login, link and
 * signup flows, and a user's links. See docs/sso.md.
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema, queryBooleanSchema } from './common.ts'
import { displayNameInputSchema } from './profile.ts'

export const OIDC_PROVIDER_ID_RE = /^[a-z][a-z0-9_-]{1,30}$/

export const oidcProviderIdSchema = z.string().regex(OIDC_PROVIDER_ID_RE).meta({
  description:
    'The provider id, chosen by the admin and used in URLs: 2-31 characters, a lowercase letter first, then lowercase letters, digits, - and _',
  example: 'google',
})

export const oidcPresets = ['google'] as const

export const oidcPresetSchema = z.enum(oidcPresets).meta({
  description: 'A known provider whose sign-in button follows its own branding (google)',
  id: 'OidcPreset',
})

export type OidcPreset = z.infer<typeof oidcPresetSchema>

/** Why an OIDC sign-in ended back on the login (or settings) page instead of signed in. */
export const oidcErrorCodes = [
  'failed',
  'expired',
  'domain_not_allowed',
  'not_linked',
  'signup_closed',
  'already_linked',
] as const

export const oidcErrorCodeSchema = z.enum(oidcErrorCodes).meta({
  description:
    'failed: the provider refused or the answer did not validate; expired: the sign-in took too long or its link was used; domain_not_allowed: the email is not verified or not in an allowed domain; not_linked: no account is linked to this identity; signup_closed: no account may be created here; already_linked: the identity is linked to another account',
  id: 'OidcErrorCode',
})

export type OidcErrorCode = z.infer<typeof oidcErrorCodeSchema>

const emailDomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/, 'Not a valid domain')

export const oidcProviderSchema = z
  .object({
    allow_signup: z
      .boolean()
      .meta({ description: 'Whether someone without an account may create one through this provider' }),
    allowed_email_domains: z.array(z.string()).meta({
      description:
        'When not empty, only a verified email in one of these domains may log in, link or sign up',
    }),
    client_id: z.string().meta({ description: 'The OAuth client id registered with the provider' }),
    client_secret_set: z.boolean().meta({ description: 'Whether a client secret is stored' }),
    created_at: iso8601DateTimeSchema,
    display_name: z.string().meta({ description: 'Shown on the buttons, e.g. "Google"' }),
    enabled: z.boolean().meta({ description: 'Whether the provider is offered at all' }),
    id: oidcProviderIdSchema,
    issuer: z.string().meta({ description: 'The OpenID Connect issuer URL' }),
    preset: oidcPresetSchema.nullable(),
    redirect_uri: z.string().meta({
      description: 'The one redirect URI to register with the provider, the same for every provider',
    }),
    updated_at: iso8601DateTimeSchema,
  })
  .meta({ description: 'An OpenID Connect provider as the admin sees it', id: 'OidcProvider' })

export type OidcProvider = z.infer<typeof oidcProviderSchema>

export const oidcProvidersResponseSchema = baseResponseSchema
  .extend({
    providers: z.array(oidcProviderSchema),
    redirect_uri: z.string().meta({ description: 'The redirect URI to register with every provider' }),
  })
  .meta({ id: 'OidcProvidersResponse' })

export type OidcProvidersResponse = z.infer<typeof oidcProvidersResponseSchema>

export const oidcProviderResponseSchema = baseResponseSchema
  .extend({ provider: oidcProviderSchema })
  .meta({ id: 'OidcProviderResponse' })

export type OidcProviderResponse = z.infer<typeof oidcProviderResponseSchema>

const providerFields = {
  allow_signup: z.boolean().meta({
    description: 'Whether someone without an account may create one through this provider (default false)',
  }),
  allowed_email_domains: z.array(emailDomainSchema).max(50).meta({
    description:
      'Only a verified email in one of these domains may log in, link or sign up; empty allows any (default)',
  }),
  client_id: z.string().trim().min(1).max(512).meta({ description: 'The OAuth client id' }),
  client_secret: z.string().min(1).max(1024).meta({
    description: 'The OAuth client secret. Write-only: never returned, only `client_secret_set`',
  }),
  display_name: z.string().trim().min(1).max(60).meta({ description: 'Shown on the buttons' }),
  enabled: z.boolean().meta({ description: 'Whether the provider is offered (default true)' }),
  issuer: z.string().trim().url().max(512).meta({
    description: 'The issuer URL, e.g. https://accounts.google.com. Must be https',
  }),
  preset: oidcPresetSchema.nullable(),
}

export const addOidcProviderBodySchema = z
  .object({
    ...providerFields,
    allow_signup: providerFields.allow_signup.optional(),
    allowed_email_domains: providerFields.allowed_email_domains.optional(),
    enabled: providerFields.enabled.optional(),
    id: oidcProviderIdSchema,
    preset: providerFields.preset.optional(),
  })
  .meta({
    description:
      'A new provider. The issuer is checked by fetching its discovery document before the provider is stored.',
    id: 'AddOidcProviderBody',
  })

export type AddOidcProviderBody = z.infer<typeof addOidcProviderBodySchema>

export const updateOidcProviderBodySchema = z
  .object({
    allow_signup: providerFields.allow_signup.optional(),
    allowed_email_domains: providerFields.allowed_email_domains.optional(),
    client_id: providerFields.client_id.optional(),
    client_secret: providerFields.client_secret.optional(),
    display_name: providerFields.display_name.optional(),
    enabled: providerFields.enabled.optional(),
    issuer: providerFields.issuer.optional(),
    preset: providerFields.preset.optional(),
  })
  .meta({
    description: 'The fields to change; an omitted field, the client secret included, keeps its value.',
    id: 'UpdateOidcProviderBody',
  })

export type UpdateOidcProviderBody = z.infer<typeof updateOidcProviderBodySchema>

export const deleteOidcProviderQuerySchema = z
  .object({
    force: queryBooleanSchema.optional().meta({
      description: 'Delete even when a linked user would be left with no way to log in',
    }),
  })
  .meta({ id: 'DeleteOidcProviderQuery' })

export type DeleteOidcProviderQuery = z.infer<typeof deleteOidcProviderQuerySchema>

export const deleteOidcProviderResponseSchema = baseResponseSchema
  .extend({
    removed_links: z.number().int().optional().meta({ description: 'The links deleted with the provider' }),
    stranded_users: z.number().int().optional().meta({
      description: 'The linked users who would have no login method left (on a refusal, or with force)',
    }),
  })
  .meta({ id: 'DeleteOidcProviderResponse' })

export type DeleteOidcProviderResponse = z.infer<typeof deleteOidcProviderResponseSchema>

export const oidcPublicProviderSchema = z
  .object({
    allow_signup: z.boolean(),
    display_name: z.string(),
    id: oidcProviderIdSchema,
    preset: oidcPresetSchema.nullable(),
  })
  .meta({ description: 'An enabled provider, as the login page lists it', id: 'OidcPublicProvider' })

export type OidcPublicProvider = z.infer<typeof oidcPublicProviderSchema>

export const oidcPublicProvidersResponseSchema = z
  .object({ providers: z.array(oidcPublicProviderSchema) })
  .meta({ id: 'OidcPublicProvidersResponse' })

export type OidcPublicProvidersResponse = z.infer<typeof oidcPublicProvidersResponseSchema>

export const oidcClients = ['app'] as const

export const oidcClientSchema = z.enum(oidcClients).meta({
  description:
    'Who started the sign-in when it is not the web: app is the Android app, which the callback sends back to net.aurboda.oidc://callback with ?code= or ?error=',
  id: 'OidcClient',
})

export type OidcClient = z.infer<typeof oidcClientSchema>

/** Where the callback sends a sign-in the app started. Android's intent filter claims this scheme and host. */
export const OIDC_APP_CALLBACK_URL = 'net.aurboda.oidc://callback'

export const oidcStartBodySchema = z
  .object({
    client: oidcClientSchema.optional(),
    invitation: z
      .string()
      .optional()
      .meta({ description: 'The invitation token, carried to a signup on an invite-only server' }),
  })
  .meta({ id: 'OidcStartBody' })

export type OidcStartBody = z.infer<typeof oidcStartBodySchema>

export const oidcStartResponseSchema = baseResponseSchema
  .extend({
    authorization_url: z
      .string()
      .optional()
      .meta({ description: "Where to send the browser: the provider's sign-in" }),
    verifier: z.string().optional().meta({
      description:
        'Keep it in the browser that started the sign-in and send it with the one-time code: a code is only good together with the verifier of the start that led to it',
    }),
  })
  .meta({ id: 'OidcStartResponse' })

export type OidcStartResponse = z.infer<typeof oidcStartResponseSchema>

export const oidcCallbackQuerySchema = z
  .object({
    code: z.string().optional(),
    error: z.string().optional(),
    state: z.string().optional(),
  })
  .meta({ id: 'OidcCallbackQuery' })

export type OidcCallbackQuery = z.infer<typeof oidcCallbackQuerySchema>

export const oidcCodeSchema = z.string().min(1).max(200).meta({
  description: 'The one-time code the callback put in the web page URL fragment',
})

export const oidcVerifierSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .meta({
    description: 'The verifier the start of this sign-in answered with (43 base64url characters)',
    id: 'OidcVerifier',
  })

export const oidcExchangeBodySchema = z
  .object({ code: oidcCodeSchema, verifier: oidcVerifierSchema })
  .meta({ id: 'OidcExchangeBody' })

export type OidcExchangeBody = z.infer<typeof oidcExchangeBodySchema>

export const oidcLoginResponseSchema = baseResponseSchema
  .extend({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    token: z.string().optional().meta({ description: 'Authentication token' }),
    username: z.string().optional().meta({ description: 'The account signed in to' }),
  })
  .meta({ id: 'OidcLoginResponse' })

export type OidcLoginResponse = z.infer<typeof oidcLoginResponseSchema>

export const oidcSignupInfoQuerySchema = z
  .object({ code: oidcCodeSchema })
  .meta({ id: 'OidcSignupInfoQuery' })

export type OidcSignupInfoQuery = z.infer<typeof oidcSignupInfoQuerySchema>

export const oidcSignupInfoResponseSchema = baseResponseSchema
  .extend({
    display_name: z.string().optional().meta({ description: 'The name the provider gave, if any' }),
    email: z.string().optional().meta({ description: 'The email the provider gave, if any' }),
    provider_display_name: z.string().optional(),
    suggested_username: z.string().optional().meta({
      description: "The email's local part reduced to the username rule; empty when that fails or is taken",
    }),
  })
  .meta({ id: 'OidcSignupInfoResponse' })

export type OidcSignupInfoResponse = z.infer<typeof oidcSignupInfoResponseSchema>

export const oidcSignupBodySchema = z
  .object({
    code: oidcCodeSchema,
    display_name: displayNameInputSchema.optional(),
    username: z.string().trim().min(1).meta({ description: 'The username for the new account' }),
    verifier: oidcVerifierSchema,
  })
  .meta({ id: 'OidcSignupBody' })

export type OidcSignupBody = z.infer<typeof oidcSignupBodySchema>

export const oidcLinkCompleteBodySchema = z
  .object({ code: oidcCodeSchema, verifier: oidcVerifierSchema })
  .meta({
    description:
      "Completes a link: the code the provider's redirect put on /settings/oidc-link, and the verifier of the link start",
    id: 'OidcLinkCompleteBody',
  })

export type OidcLinkCompleteBody = z.infer<typeof oidcLinkCompleteBodySchema>

export const oidcLinkSchema = z
  .object({
    created_at: iso8601DateTimeSchema,
    email: z.string().nullable().meta({ description: 'The email as the provider last gave it' }),
    id: z.uuid(),
    last_login_at: iso8601DateTimeSchema.nullable(),
    provider_display_name: z.string(),
    provider_id: oidcProviderIdSchema,
  })
  .meta({ description: "A sign-in provider identity linked to the user's account", id: 'OidcLink' })

export type OidcLink = z.infer<typeof oidcLinkSchema>

export const oidcLinksResponseSchema = baseResponseSchema
  .extend({
    links: z.array(oidcLinkSchema),
    login_methods: z.number().int().meta({
      description:
        'How many ways the user can log in: the password (unless the account was created through a provider), each passkey and each link. The last one cannot be removed',
    }),
  })
  .meta({ id: 'OidcLinksResponse' })

export type OidcLinksResponse = z.infer<typeof oidcLinksResponseSchema>
