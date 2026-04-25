/**
 * WebAuthn / passkey service.
 *
 * Wraps `@simplewebauthn/server` and our per-user DB layer so the route
 * handlers stay thin. Challenges are kept in process memory with a TTL —
 * fine for single-instance deploys.
 */
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server'
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import {
  deleteWebAuthnCredential as dbDeleteCredential,
  getWebAuthnCredentialById,
  getWebAuthnCredentialsForUser,
  insertWebAuthnCredential,
  updateWebAuthnCredentialNickname,
  updateWebAuthnCredentialUsage,
  type WebAuthnCredentialRow,
} from '../db/webauthn.ts'

const CHALLENGE_TTL_MS = 5 * 60 * 1000

interface RegistrationChallenge {
  kind: 'registration'
  challenge: string
  expiresAt: number
}

interface AuthenticationChallenge {
  kind: 'authentication'
  challenge: string
  user?: string
  expiresAt: number
}

/**
 * Encode a username as the `userID` Uint8Array used by WebAuthn. The
 * authenticator returns this verbatim as `userHandle` on assertion, which
 * lets us identify the user in the discoverable-credentials flow without
 * a typed username.
 */
const encodeUserHandle = (username: string): Uint8Array<ArrayBuffer> => {
  const encoded = new TextEncoder().encode(username)
  // SimpleWebAuthn's typing requires Uint8Array<ArrayBuffer>, while TextEncoder
  // yields the broader ArrayBufferLike. Copy into a fresh ArrayBuffer.
  const buf = new ArrayBuffer(encoded.length)
  const out = new Uint8Array(buf)
  out.set(encoded)
  return out
}

const decodeUserHandle = (handle: string): string => {
  // SimpleWebAuthn delivers userHandle as base64url
  const normalized = handle.replaceAll('-', '+').replaceAll('_', '/')
  return Buffer.from(normalized, 'base64').toString('utf8')
}

const toAuthenticatorTransports = (transports: string[]): AuthenticatorTransportFuture[] =>
  transports as AuthenticatorTransportFuture[]

const credentialToWire = (row: WebAuthnCredentialRow) => ({
  backed_up: row.backed_up,
  created_at: row.created_at.toISOString(),
  credential_id: row.credential_id,
  device_type: row.device_type,
  last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
  nickname: row.nickname,
  transports: row.transports,
})

export interface WebAuthnConfig {
  rpID: string
  rpName: string
  expectedOrigins: string[]
}

export interface WebAuthnService {
  getRegistrationOptions: (user: string) => Promise<PublicKeyCredentialCreationOptionsJSON>
  verifyRegistration: (
    user: string,
    response: RegistrationResponseJSON,
    nickname?: string,
  ) => Promise<{ verified: boolean; credentialId?: string }>
  getAuthenticationOptions: (
    username?: string,
  ) => Promise<PublicKeyCredentialRequestOptionsJSON>
  verifyAuthentication: (
    response: AuthenticationResponseJSON,
  ) => Promise<{ verified: boolean; user?: string }>
  listCredentials: (user: string) => Promise<ReturnType<typeof credentialToWire>[]>
  renameCredential: (user: string, credentialId: string, nickname: string) => Promise<boolean>
  deleteCredential: (user: string, credentialId: string) => Promise<boolean>
}

export const createWebAuthnService = (config: WebAuthnConfig): WebAuthnService => {
  // Pending registrations are keyed by username (one in-flight per user).
  // Pending authentications are keyed by challenge string because for
  // discoverable credentials we don't yet know the user.
  const pendingRegistrations = new Map<string, RegistrationChallenge>()
  const pendingAuthentications = new Map<string, AuthenticationChallenge>()

  const sweep = () => {
    const now = Date.now()
    for (const [k, v] of pendingRegistrations) {
      if (v.expiresAt < now) pendingRegistrations.delete(k)
    }
    for (const [k, v] of pendingAuthentications) {
      if (v.expiresAt < now) pendingAuthentications.delete(k)
    }
  }

  const readChallengeFromClientData = (clientDataJSON: string): string | undefined => {
    try {
      const data = JSON.parse(Buffer.from(clientDataJSON, 'base64url').toString('utf8')) as {
        challenge?: string
      }
      return data.challenge
    } catch {
      return undefined
    }
  }

  return {
    getRegistrationOptions: async (user) => {
      sweep()
      const existing = await getWebAuthnCredentialsForUser(user)
      const options = await generateRegistrationOptions({
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        excludeCredentials: existing.map((c) => ({
          id: c.credential_id,
          transports: toAuthenticatorTransports(c.transports),
        })),
        rpID: config.rpID,
        rpName: config.rpName,
        userID: encodeUserHandle(user),
        userName: user,
      })

      pendingRegistrations.set(user, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
        kind: 'registration',
      })

      return options
    },

    verifyRegistration: async (user, response, nickname) => {
      sweep()
      const pending = pendingRegistrations.get(user)
      if (!pending) return { verified: false }
      pendingRegistrations.delete(user)

      const verification = await verifyRegistrationResponse({
        expectedChallenge: pending.challenge,
        expectedOrigin: config.expectedOrigins,
        expectedRPID: config.rpID,
        response,
      })

      if (!verification.verified || !verification.registrationInfo) {
        return { verified: false }
      }

      const info = verification.registrationInfo
      await insertWebAuthnCredential(user, {
        backedUp: info.credentialBackedUp,
        counter: info.credential.counter,
        credentialId: info.credential.id,
        deviceType: info.credentialDeviceType,
        nickname: nickname ?? null,
        publicKey: Buffer.from(info.credential.publicKey),
        transports: info.credential.transports ?? [],
      })

      return { verified: true, credentialId: info.credential.id }
    },

    getAuthenticationOptions: async (username) => {
      sweep()
      let allowCredentials: { id: string; transports?: AuthenticatorTransportFuture[] }[] | undefined
      if (username) {
        try {
          const creds = await getWebAuthnCredentialsForUser(username)
          allowCredentials = creds.map((c) => ({
            id: c.credential_id,
            transports: toAuthenticatorTransports(c.transports),
          }))
        } catch {
          // Unknown user — emit empty allowCredentials so the flow appears uniform
          allowCredentials = []
        }
      }

      const options = await generateAuthenticationOptions({
        allowCredentials,
        rpID: config.rpID,
        userVerification: 'preferred',
      })

      pendingAuthentications.set(options.challenge, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
        kind: 'authentication',
        user: username,
      })

      return options
    },

    verifyAuthentication: async (response) => {
      sweep()
      const challenge = readChallengeFromClientData(response.response.clientDataJSON)
      if (!challenge) return { verified: false }

      const pending = pendingAuthentications.get(challenge)
      if (!pending) return { verified: false }
      pendingAuthentications.delete(challenge)

      const userHandle = response.response.userHandle
      const username = pending.user ?? (userHandle ? decodeUserHandle(userHandle) : undefined)
      if (!username) return { verified: false }

      let credRow: WebAuthnCredentialRow | null
      try {
        credRow = await getWebAuthnCredentialById(username, response.id)
      } catch {
        return { verified: false }
      }
      if (!credRow) return { verified: false }

      const verification = await verifyAuthenticationResponse({
        credential: {
          counter: Number(credRow.counter),
          id: credRow.credential_id,
          publicKey: new Uint8Array(credRow.public_key),
          transports: toAuthenticatorTransports(credRow.transports),
        },
        expectedChallenge: pending.challenge,
        expectedOrigin: config.expectedOrigins,
        expectedRPID: config.rpID,
        response,
      })

      if (!verification.verified) return { verified: false }

      await updateWebAuthnCredentialUsage(
        username,
        credRow.credential_id,
        verification.authenticationInfo.newCounter,
      )

      return { verified: true, user: username }
    },

    listCredentials: async (user) => {
      const rows = await getWebAuthnCredentialsForUser(user)
      return rows.map(credentialToWire)
    },

    renameCredential: (user, credentialId, nickname) =>
      updateWebAuthnCredentialNickname(user, credentialId, nickname),

    deleteCredential: (user, credentialId) => dbDeleteCredential(user, credentialId),
  }
}
