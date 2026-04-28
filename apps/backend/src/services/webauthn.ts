/**
 * WebAuthn / passkey service.
 *
 * Wraps `@simplewebauthn/server` and our per-user DB layer so the route
 * handlers stay thin. Challenges are kept in process memory with a TTL
 * and a hard size cap — appropriate for single-instance deploys.
 */
import type {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
  RegistrationResponseJSON,
} from '@simplewebauthn/server'

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
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
const MAX_PENDING_CHALLENGES = 10_000

interface RegistrationChallenge {
  challenge: string
  expiresAt: number
}

interface AuthenticationChallenge {
  challenge: string
  expiresAt: number
}

interface PendingSignup {
  username: string
  userHandleUuid: string
  challenge: string
  expiresAt: number
}

/**
 * Subset of `VerifiedRegistrationResponse.registrationInfo` that the route
 * needs to persist after a successful signup. Re-typed here so the route
 * doesn't need to depend on `@simplewebauthn/server` types.
 */
export interface VerifiedSignupCredential {
  credentialId: string
  publicKey: Buffer
  counter: number | bigint
  transports: string[]
  deviceType: string
  backedUp: boolean
}

const uuidStringToBytes = (uuid: string): Uint8Array<ArrayBuffer> => {
  const hex = uuid.replaceAll('-', '')
  const buf = new ArrayBuffer(16)
  const out = new Uint8Array(buf)
  for (let i = 0; i < 16; i++) {
    out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  }
  return out
}

const bytesToUuidString = (bytes: Uint8Array): string => {
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`
}

const decodeBase64UrlBytes = (s: string): Uint8Array => Buffer.from(s, 'base64url')

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

/**
 * Adapter for the central-DB userHandle ↔ username mapping. Modelled as a
 * narrow interface so this service can be unit-tested without spinning up
 * the central database.
 */
export interface UserHandleStore {
  getOrCreateWebAuthnUserHandle: (username: string) => Promise<string>
  getUsernameByWebAuthnUserHandle: (userHandle: string) => Promise<string | null>
}

export interface WebAuthnService {
  getRegistrationOptions: (user: string) => Promise<PublicKeyCredentialCreationOptionsJSON>
  verifyRegistration: (
    user: string,
    response: RegistrationResponseJSON,
    nickname?: string,
  ) => Promise<{ verified: boolean; credentialId?: string }>
  /**
   * Generate registration options for a *new* user. The user is not created
   * yet; the route inserts the Postgres role only after `verifySignup`
   * succeeds. The given `userHandleUuid` is what becomes the WebAuthn
   * userID (and later the userHandle on assertion).
   */
  getSignupOptions: (
    username: string,
    userHandleUuid: string,
  ) => Promise<PublicKeyCredentialCreationOptionsJSON>
  /**
   * Verify the registration response for a pending signup. Returns the
   * unwrapped credential data so the route can create the user + persist
   * the credential. Does *not* persist anything by itself.
   */
  verifySignup: (
    username: string,
    response: RegistrationResponseJSON,
  ) => Promise<{ verified: boolean; credential?: VerifiedSignupCredential; userHandleUuid?: string }>
  getAuthenticationOptions: () => Promise<PublicKeyCredentialRequestOptionsJSON>
  verifyAuthentication: (
    response: AuthenticationResponseJSON,
  ) => Promise<{ verified: boolean; user?: string }>
  listCredentials: (user: string) => Promise<ReturnType<typeof credentialToWire>[]>
  renameCredential: (user: string, credentialId: string, nickname: string) => Promise<boolean>
  deleteCredential: (user: string, credentialId: string) => Promise<boolean>
}

export const createWebAuthnService = (
  config: WebAuthnConfig,
  userHandleStore: UserHandleStore,
): WebAuthnService => {
  // Pending registrations are keyed by username (one in-flight per user).
  // Pending authentications are keyed by challenge string because for
  // discoverable credentials we don't yet know the user.
  const pendingRegistrations = new Map<string, RegistrationChallenge>()
  const pendingAuthentications = new Map<string, AuthenticationChallenge>()
  const pendingSignups = new Map<string, PendingSignup>()

  const sweep = () => {
    const now = Date.now()
    for (const [k, v] of pendingRegistrations) {
      if (v.expiresAt < now) pendingRegistrations.delete(k)
    }
    for (const [k, v] of pendingAuthentications) {
      if (v.expiresAt < now) pendingAuthentications.delete(k)
    }
    for (const [k, v] of pendingSignups) {
      if (v.expiresAt < now) pendingSignups.delete(k)
    }
  }

  // Map.set/delete keep insertion order, so the first key is also the oldest.
  const enforceCap = <T>(map: Map<string, T>): void => {
    while (map.size > MAX_PENDING_CHALLENGES) {
      const oldest = map.keys().next().value
      if (oldest === undefined) break
      map.delete(oldest)
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
      const [existing, userHandleUuid] = await Promise.all([
        getWebAuthnCredentialsForUser(user),
        userHandleStore.getOrCreateWebAuthnUserHandle(user),
      ])
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
        userID: uuidStringToBytes(userHandleUuid),
        userName: user,
      })

      pendingRegistrations.set(user, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      })
      enforceCap(pendingRegistrations)

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

    getSignupOptions: async (username, userHandleUuid) => {
      sweep()
      const options = await generateRegistrationOptions({
        attestationType: 'none',
        authenticatorSelection: {
          residentKey: 'preferred',
          userVerification: 'preferred',
        },
        rpID: config.rpID,
        rpName: config.rpName,
        userID: uuidStringToBytes(userHandleUuid),
        userName: username,
      })

      pendingSignups.set(username, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
        userHandleUuid,
        username,
      })
      enforceCap(pendingSignups)

      return options
    },

    verifySignup: async (username, response) => {
      sweep()
      const pending = pendingSignups.get(username)
      if (!pending) return { verified: false }
      pendingSignups.delete(username)

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
      return {
        credential: {
          backedUp: info.credentialBackedUp,
          counter: info.credential.counter,
          credentialId: info.credential.id,
          deviceType: info.credentialDeviceType,
          publicKey: Buffer.from(info.credential.publicKey),
          transports: info.credential.transports ?? [],
        },
        userHandleUuid: pending.userHandleUuid,
        verified: true,
      }
    },

    getAuthenticationOptions: async () => {
      sweep()
      // No allowCredentials — always discoverable. Avoids leaking
      // credential IDs / user-existence info to unauthenticated callers.
      const options = await generateAuthenticationOptions({
        rpID: config.rpID,
        userVerification: 'preferred',
      })

      pendingAuthentications.set(options.challenge, {
        challenge: options.challenge,
        expiresAt: Date.now() + CHALLENGE_TTL_MS,
      })
      enforceCap(pendingAuthentications)

      return options
    },

    verifyAuthentication: async (response) => {
      sweep()
      const challenge = readChallengeFromClientData(response.response.clientDataJSON)
      if (!challenge) return { verified: false }

      const pending = pendingAuthentications.get(challenge)
      if (!pending) return { verified: false }
      pendingAuthentications.delete(challenge)

      // Identify the user via the discoverable-credential userHandle, which
      // we registered as the random per-user UUID.
      const userHandleStr = response.response.userHandle
      if (!userHandleStr) return { verified: false }

      let userHandleUuid: string
      try {
        userHandleUuid = bytesToUuidString(decodeBase64UrlBytes(userHandleStr))
      } catch {
        return { verified: false }
      }

      const username = await userHandleStore.getUsernameByWebAuthnUserHandle(userHandleUuid)
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
        Number(credRow.counter),
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
