/**
 * WebAuthn / passkey schemas.
 *
 * The W3C JSON blobs (`PublicKeyCredentialCreationOptionsJSON`,
 * `RegistrationResponseJSON`, etc.) are passed as opaque JSON strings:
 *  - `@simplewebauthn/browser` and `androidx.credentials` already parse them
 *  - typing them in Zod adds drift with no safety win
 *  - keeping them as strings lets the Kotlin generator produce a usable type
 */

import { z } from 'zod'

import { baseResponseSchema, iso8601DateTimeSchema } from './common.ts'

// ============================================================================
// Registration ceremony (authenticated)
// ============================================================================

export const webauthnRegistrationOptionsResponseSchema = baseResponseSchema
  .extend({
    options_json: z
      .string()
      .meta({ description: 'JSON-stringified PublicKeyCredentialCreationOptionsJSON' }),
  })
  .meta({ id: 'WebAuthnRegistrationOptionsResponse' })

export type WebAuthnRegistrationOptionsResponse = z.infer<typeof webauthnRegistrationOptionsResponseSchema>

export const webauthnRegistrationVerifyBodySchema = z
  .object({
    nickname: z
      .string()
      .max(64)
      .optional()
      .meta({ description: 'Optional user-chosen label for this credential' }),
    response_json: z.string().meta({
      description: 'JSON-stringified RegistrationResponseJSON returned by the authenticator',
    }),
  })
  .meta({ id: 'WebAuthnRegistrationVerifyBody' })

export type WebAuthnRegistrationVerifyBody = z.infer<typeof webauthnRegistrationVerifyBodySchema>

export const webauthnRegistrationVerifyResponseSchema = baseResponseSchema
  .extend({
    credential_id: z.string().optional().meta({ description: 'Stored credential ID (base64url)' }),
    verified: z.boolean().meta({ description: 'Whether the credential was verified and stored' }),
  })
  .meta({ id: 'WebAuthnRegistrationVerifyResponse' })

export type WebAuthnRegistrationVerifyResponse = z.infer<typeof webauthnRegistrationVerifyResponseSchema>

// ============================================================================
// Authentication ceremony (unauthenticated — login)
// ============================================================================

export const webauthnAuthOptionsBodySchema = z
  .object({
    username: z.string().optional().meta({
      description: 'Username — omit for discoverable-credentials (resident key) flow',
    }),
  })
  .meta({ id: 'WebAuthnAuthOptionsBody' })

export type WebAuthnAuthOptionsBody = z.infer<typeof webauthnAuthOptionsBodySchema>

export const webauthnAuthOptionsResponseSchema = baseResponseSchema
  .extend({
    options_json: z
      .string()
      .meta({ description: 'JSON-stringified PublicKeyCredentialRequestOptionsJSON' }),
  })
  .meta({ id: 'WebAuthnAuthOptionsResponse' })

export type WebAuthnAuthOptionsResponse = z.infer<typeof webauthnAuthOptionsResponseSchema>

export const webauthnAuthVerifyBodySchema = z
  .object({
    response_json: z.string().meta({
      description: 'JSON-stringified AuthenticationResponseJSON returned by the authenticator',
    }),
  })
  .meta({ id: 'WebAuthnAuthVerifyBody' })

export type WebAuthnAuthVerifyBody = z.infer<typeof webauthnAuthVerifyBodySchema>

export const webauthnAuthVerifyResponseSchema = baseResponseSchema
  .extend({
    is_admin: z.boolean().optional().meta({ description: 'Whether the user is an admin' }),
    refresh: z.string().optional().meta({ description: 'Refresh token (currently same as token)' }),
    token: z.string().optional().meta({ description: 'Authentication token' }),
    username: z.string().optional().meta({ description: 'Authenticated username' }),
    verified: z.boolean().meta({ description: 'Whether the assertion was verified' }),
  })
  .meta({ id: 'WebAuthnAuthVerifyResponse' })

export type WebAuthnAuthVerifyResponse = z.infer<typeof webauthnAuthVerifyResponseSchema>

// ============================================================================
// Credential management (authenticated)
// ============================================================================

export const webauthnCredentialSchema = z
  .object({
    backed_up: z
      .boolean()
      .meta({ description: 'Whether the credential is backed up to a cloud (multi-device)' }),
    created_at: iso8601DateTimeSchema.meta({ description: 'When the credential was registered' }),
    credential_id: z.string().meta({ description: 'Credential ID (base64url)' }),
    device_type: z
      .string()
      .nullable()
      .meta({ description: 'singleDevice or multiDevice (from authenticator metadata)' }),
    last_used_at: z
      .string()
      .nullable()
      .meta({ description: 'When the credential was last used to authenticate (ISO 8601)' }),
    nickname: z.string().nullable().meta({ description: 'User-chosen label' }),
    transports: z
      .array(z.string())
      .meta({ description: 'Supported transports (usb, nfc, internal, hybrid)' }),
  })
  .meta({ id: 'WebAuthnCredential' })

export type WebAuthnCredential = z.infer<typeof webauthnCredentialSchema>

export const webauthnCredentialsResponseSchema = baseResponseSchema
  .extend({
    credentials: z.array(webauthnCredentialSchema),
  })
  .meta({ id: 'WebAuthnCredentialsResponse' })

export type WebAuthnCredentialsResponse = z.infer<typeof webauthnCredentialsResponseSchema>

export const webauthnUpdateCredentialBodySchema = z
  .object({
    nickname: z.string().max(64).meta({ description: 'New nickname for the credential' }),
  })
  .meta({ id: 'WebAuthnUpdateCredentialBody' })

export type WebAuthnUpdateCredentialBody = z.infer<typeof webauthnUpdateCredentialBodySchema>

export const webauthnDeleteCredentialResponseSchema = baseResponseSchema.meta({
  id: 'WebAuthnDeleteCredentialResponse',
})

export type WebAuthnDeleteCredentialResponse = z.infer<typeof webauthnDeleteCredentialResponseSchema>
