import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'

/**
 * WebAuthn / passkey routes.
 *
 * Authentication endpoints (`/auth/options`, `/auth/verify`) are unauthenticated
 * — they replace the password check. All other endpoints require an existing
 * session (you must be logged in to manage your own passkeys).
 */
import {
  type WebAuthnAuthOptionsBody,
  webauthnAuthOptionsBodySchema,
  type WebAuthnAuthOptionsResponse,
  type WebAuthnAuthVerifyBody,
  webauthnAuthVerifyBodySchema,
  type WebAuthnAuthVerifyResponse,
  type WebAuthnCredentialsResponse,
  type WebAuthnDeleteCredentialResponse,
  type WebAuthnRegistrationOptionsResponse,
  type WebAuthnRegistrationVerifyBody,
  webauthnRegistrationVerifyBodySchema,
  type WebAuthnRegistrationVerifyResponse,
  type WebAuthnUpdateCredentialBody,
  webauthnUpdateCredentialBodySchema,
} from '@aurboda/api-spec'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { WebAuthnService } from '../services/webauthn.ts'
import type { AnyMiddleware, TypedRouter } from '../typed-router.ts'

import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

interface WebAuthnRouterDeps {
  authMiddleware: AnyMiddleware
  webAuthn: WebAuthnService
  auth: Auth
  centralDb: CentralDb
}

export const createWebAuthnRouter = ({
  authMiddleware,
  webAuthn,
  auth,
  centralDb,
}: WebAuthnRouterDeps): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, WebAuthnRegistrationOptionsResponse>(
    '/register/options',
    authMiddleware,
    async (req, res) => {
      const options = await webAuthn.getRegistrationOptions(req.user!)
      res.json({ options_json: JSON.stringify(options), success: true })
    },
  )

  router.post<Record<string, never>, WebAuthnRegistrationVerifyResponse, WebAuthnRegistrationVerifyBody>(
    '/register/verify',
    authMiddleware,
    validateBody(webauthnRegistrationVerifyBodySchema),
    async (req, res) => {
      let response: RegistrationResponseJSON
      try {
        response = JSON.parse(req.body.response_json) as RegistrationResponseJSON
      } catch {
        res.status(400).json({ error: 'Invalid response_json', success: false, verified: false })
        return
      }

      try {
        const result = await webAuthn.verifyRegistration(req.user!, response, req.body.nickname)
        if (!result.verified) {
          res.status(400).json({ error: 'Verification failed', success: false, verified: false })
          return
        }
        res.json({ credential_id: result.credentialId, success: true, verified: true })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Verification failed'
        res.status(400).json({ error: msg, success: false, verified: false })
      }
    },
  )

  router.post<Record<string, never>, WebAuthnAuthOptionsResponse, WebAuthnAuthOptionsBody>(
    '/auth/options',
    validateBody(webauthnAuthOptionsBodySchema),
    async (req, res) => {
      const options = await webAuthn.getAuthenticationOptions(req.body.username)
      res.json({ options_json: JSON.stringify(options), success: true })
    },
  )

  router.post<Record<string, never>, WebAuthnAuthVerifyResponse, WebAuthnAuthVerifyBody>(
    '/auth/verify',
    validateBody(webauthnAuthVerifyBodySchema),
    async (req, res) => {
      let response: AuthenticationResponseJSON
      try {
        response = JSON.parse(req.body.response_json) as AuthenticationResponseJSON
      } catch {
        res.status(400).json({ error: 'Invalid response_json', success: false, verified: false })
        return
      }

      try {
        const result = await webAuthn.verifyAuthentication(response)
        if (!result.verified || !result.user) {
          res.status(401).json({ error: 'Verification failed', success: false, verified: false })
          return
        }
        const token = auth.createToken(result.user)
        const isAdmin = await centralDb.isAdmin(result.user)
        res.json({
          is_admin: isAdmin,
          refresh: token,
          success: true,
          token,
          username: result.user,
          verified: true,
        })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Verification failed'
        res.status(401).json({ error: msg, success: false, verified: false })
      }
    },
  )

  router.get<Record<string, never>, WebAuthnCredentialsResponse>(
    '/credentials',
    authMiddleware,
    async (req, res) => {
      const credentials = await webAuthn.listCredentials(req.user!)
      res.json({ credentials, success: true })
    },
  )

  router.patch<{ id: string }, WebAuthnDeleteCredentialResponse, WebAuthnUpdateCredentialBody>(
    '/credentials/:id',
    authMiddleware,
    validateBody(webauthnUpdateCredentialBodySchema),
    async (req, res) => {
      const ok = await webAuthn.renameCredential(req.user!, req.params.id, req.body.nickname)
      if (!ok) {
        res.status(404).json({ error: 'Credential not found', success: false })
        return
      }
      res.json({ success: true })
    },
  )

  router.delete<{ id: string }, WebAuthnDeleteCredentialResponse>(
    '/credentials/:id',
    authMiddleware,
    async (req, res) => {
      const ok = await webAuthn.deleteCredential(req.user!, req.params.id)
      if (!ok) {
        res.status(404).json({ error: 'Credential not found', success: false })
        return
      }
      res.json({ success: true })
    },
  )

  return router
}
