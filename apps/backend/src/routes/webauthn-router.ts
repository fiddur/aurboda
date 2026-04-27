/**
 * WebAuthn / passkey routes.
 *
 * Authentication endpoints (`/auth/options`, `/auth/verify`) are unauthenticated
 * — they replace the password check. All other endpoints require an existing
 * session (you must be logged in to manage your own passkeys).
 */
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from '@simplewebauthn/server'
import type { Client } from 'pg'

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
  type WebAuthnSignupOptionsBody,
  webauthnSignupOptionsBodySchema,
  type WebAuthnSignupOptionsResponse,
  type WebAuthnSignupVerifyBody,
  webauthnSignupVerifyBodySchema,
  type WebAuthnSignupVerifyResponse,
  type WebAuthnUpdateCredentialBody,
  webauthnUpdateCredentialBodySchema,
} from '@aurboda/api-spec'
import { randomBytes, randomUUID } from 'node:crypto'

import type { Auth } from '../auth.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { WebAuthnService } from '../services/webauthn.ts'
import type { AnyMiddleware, TypedRouter } from '../typed-router.ts'

import { RESERVED_USERNAMES } from '../api/auth-routes.ts'
import { dropUserDb, makeNewUserDb, query } from '../db/index.ts'
import { insertWebAuthnCredential } from '../db/webauthn.ts'
import { typedRouter } from '../typed-router.ts'
import { validateBody } from '../validation.ts'

const USERNAME_REGEX = /^[a-z][a-z0-9_]{2,30}$/

interface WebAuthnRouterDeps {
  authMiddleware: AnyMiddleware
  webAuthn: WebAuthnService
  auth: Auth
  centralDb: CentralDb
  invitationAuth: InvitationAuth
  userDb: Client
}

export const createWebAuthnRouter = ({
  authMiddleware,
  webAuthn,
  auth,
  centralDb,
  invitationAuth,
  userDb,
}: WebAuthnRouterDeps): TypedRouter => {
  const router = typedRouter()

  router.post<Record<string, never>, WebAuthnSignupOptionsResponse, WebAuthnSignupOptionsBody>(
    '/signup/options',
    validateBody(webauthnSignupOptionsBodySchema),
    async (req, res) => {
      const { username, invitation } = req.body

      const signupMode = await centralDb.getSignupMode()
      if (signupMode === 'closed') {
        res.status(403).json({ error: 'Signup is currently closed', success: false, options_json: '' })
        return
      }
      if (signupMode === 'invite_only') {
        if (!invitation) {
          res
            .status(403)
            .json({ error: 'An invitation is required to sign up', success: false, options_json: '' })
          return
        }
        const validation = invitationAuth.validateInvitationToken(invitation)
        if (!validation.valid) {
          const errorMsg = validation.expired ? 'Invitation has expired' : 'Invalid invitation'
          res.status(403).json({ error: errorMsg, success: false, options_json: '' })
          return
        }
      }

      if (!USERNAME_REGEX.test(username)) {
        res.status(400).json({
          error:
            'Username must be 3-31 characters, start with a letter, and contain only lowercase letters, numbers, and underscores',
          options_json: '',
          success: false,
        })
        return
      }
      if (RESERVED_USERNAMES.includes(username)) {
        res.status(400).json({ error: 'This username is reserved', success: false, options_json: '' })
        return
      }

      const existing = await query(userDb, 'SELECT usename FROM pg_user WHERE usename=$1', [username])
      if ((existing.rowCount ?? 0) > 0) {
        res.status(409).json({ error: 'Username already exists', success: false, options_json: '' })
        return
      }

      const userHandleUuid = randomUUID()
      const options = await webAuthn.getSignupOptions(username, userHandleUuid)
      res.json({ options_json: JSON.stringify(options), success: true })
    },
  )

  router.post<Record<string, never>, WebAuthnSignupVerifyResponse, WebAuthnSignupVerifyBody>(
    '/signup/verify',
    validateBody(webauthnSignupVerifyBodySchema),
    async (req, res) => {
      const { username, nickname } = req.body

      let response: RegistrationResponseJSON
      try {
        response = JSON.parse(req.body.response_json) as RegistrationResponseJSON
      } catch {
        res.status(400).json({ error: 'Invalid response_json', success: false, verified: false })
        return
      }

      let verifyResult: Awaited<ReturnType<WebAuthnService['verifySignup']>>
      try {
        verifyResult = await webAuthn.verifySignup(username, response)
      } catch (err) {
        console.error('WebAuthn signup verification failed:', err)
        res.status(400).json({ error: 'Verification failed', success: false, verified: false })
        return
      }
      if (!verifyResult.verified || !verifyResult.credential || !verifyResult.userHandleUuid) {
        res.status(400).json({ error: 'Verification failed', success: false, verified: false })
        return
      }

      const { credential, userHandleUuid } = verifyResult

      // Step 1: bind the user-handle UUID in central DB. If this fails the
      // username likely got taken between /options and /verify — surface 409.
      try {
        await centralDb.insertWebAuthnUserHandle(username, userHandleUuid)
      } catch (err) {
        console.error('Failed to insert WebAuthn user handle for signup:', err)
        res.status(409).json({ error: 'Username already exists', success: false, verified: false })
        return
      }

      // Step 2: create the Postgres role + per-user database. Random password
      // — only Postgres ever sees it; we discard it after the connect call.
      const randomPassword = randomBytes(32).toString('base64url')
      try {
        await makeNewUserDb(userDb, username, randomPassword)
      } catch (err) {
        console.error('Failed to create user DB during signup:', err)
        await centralDb.deleteWebAuthnUserHandle(username).catch(() => {})
        res.status(500).json({ error: 'Signup failed', success: false, verified: false })
        return
      }

      // Step 3: persist the credential in the user's DB. If this fails we
      // would orphan an account that has no way to log in — roll back.
      try {
        await insertWebAuthnCredential(username, {
          backedUp: credential.backedUp,
          counter: credential.counter,
          credentialId: credential.credentialId,
          deviceType: credential.deviceType,
          nickname: nickname ?? null,
          publicKey: credential.publicKey,
          transports: credential.transports,
        })
      } catch (err) {
        console.error('Failed to persist credential during signup; rolling back:', err)
        await dropUserDb(userDb, username).catch(() => {})
        await centralDb.deleteWebAuthnUserHandle(username).catch(() => {})
        res.status(500).json({ error: 'Signup failed', success: false, verified: false })
        return
      }

      // Step 4: first-user-becomes-admin (mirrors auth-routes.ts /signup).
      const adminCount = await centralDb.getAdminCount()
      let isAdmin = false
      if (adminCount === 0) {
        await centralDb.addAdmin(username)
        isAdmin = true
        console.info(`First user ${username} automatically made admin`)
      }

      const token = auth.createToken(username)
      res.json({
        is_admin: isAdmin,
        success: true,
        token,
        username,
        verified: true,
      })
    },
  )

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
        // Don't leak the underlying error string to authenticated callers either —
        // it can include implementation details from `@simplewebauthn/server`.
        console.error('WebAuthn registration verification failed:', err)
        res.status(400).json({ error: 'Verification failed', success: false, verified: false })
      }
    },
  )

  router.post<Record<string, never>, WebAuthnAuthOptionsResponse, WebAuthnAuthOptionsBody>(
    '/auth/options',
    validateBody(webauthnAuthOptionsBodySchema),
    async (_req, res) => {
      const options = await webAuthn.getAuthenticationOptions()
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
          success: true,
          token,
          username: result.user,
          verified: true,
        })
      } catch (err) {
        // Generic error to the caller; full detail in server logs.
        console.error('WebAuthn authentication verification failed:', err)
        res.status(401).json({ error: 'Verification failed', success: false, verified: false })
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
