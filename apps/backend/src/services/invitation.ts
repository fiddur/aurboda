/**
 * Invitation token service for invite-only signup mode.
 *
 * Uses AES-256-GCM encryption (same pattern as auth.ts) to create secure,
 * time-limited invitation tokens.
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

// ============================================================================
// Types
// ============================================================================

export interface InvitationPayload {
  type: 'invitation'
  iat: number // Issued at (timestamp in seconds)
  exp: number // Expiration (timestamp in seconds)
}

export interface InvitationValidationResult {
  valid: boolean
  expired?: boolean
  error?: string
}

export interface InvitationAuth {
  createInvitationToken: (expiryHours?: number) => string
  validateInvitationToken: (token: string) => InvitationValidationResult
  getTokenExpiry: (token: string) => Date | null
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_EXPIRY_HOURS = 168 // 7 days

// ============================================================================
// Factory
// ============================================================================

/**
 * Create an invitation auth service.
 *
 * @param sessionSalt - The 32-byte session secret (same as used for auth tokens)
 * @returns InvitationAuth instance
 */
export const createInvitationAuth = (sessionSalt: string): InvitationAuth => {
  if (!sessionSalt || Buffer.from(sessionSalt).length !== 32) {
    throw new Error('SESSION_SECRET must be set and be exactly 32 bytes (256 bits)')
  }

  const encrypt = (payload: InvitationPayload): string => {
    const iv = randomBytes(12)
    const cipher = createCipheriv('aes-256-gcm', sessionSalt, iv)
    const json = JSON.stringify(payload)
    return (
      cipher.update(json, 'utf8', 'base64') +
      cipher.final('base64') +
      `-${iv.toString('base64')}-${cipher.getAuthTag().toString('base64')}`
    )
  }

  const decrypt = (token: string): InvitationPayload | null => {
    if (!token) return null

    const parts = token.split('-')
    if (parts.length !== 3) return null

    const [encrypted, iv, tag] = parts

    try {
      const decipher = createDecipheriv('aes-256-gcm', sessionSalt, Buffer.from(iv, 'base64'))
      decipher.setAuthTag(Buffer.from(tag, 'base64'))
      const json = decipher.update(encrypted, 'base64', 'utf8') + decipher.final('utf8')
      return JSON.parse(json) as InvitationPayload
    } catch {
      return null
    }
  }

  return {
    createInvitationToken: (expiryHours = DEFAULT_EXPIRY_HOURS): string => {
      const now = Math.floor(Date.now() / 1000)
      const payload: InvitationPayload = {
        exp: now + expiryHours * 60 * 60,
        iat: now,
        type: 'invitation',
      }
      return encrypt(payload)
    },

    getTokenExpiry: (token: string): Date | null => {
      const payload = decrypt(token)
      if (!payload) return null
      return new Date(payload.exp * 1000)
    },

    validateInvitationToken: (token: string): InvitationValidationResult => {
      const payload = decrypt(token)

      if (!payload) {
        return { error: 'Invalid token', valid: false }
      }

      if (payload.type !== 'invitation') {
        return { error: 'Invalid token type', valid: false }
      }

      const now = Math.floor(Date.now() / 1000)
      if (payload.exp < now) {
        return { error: 'Token expired', expired: true, valid: false }
      }

      return { valid: true }
    },
  }
}
