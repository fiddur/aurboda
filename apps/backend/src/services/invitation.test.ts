import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'
import { createInvitationAuth } from './invitation'

const VALID_SALT = 'test-secret-key-32-bytes-long!!!' // exactly 32 bytes

describe('invitation', () => {
  describe('createInvitationAuth', () => {
    test('throws if sessionSalt is empty', () => {
      expect(() => createInvitationAuth('')).toThrow(
        'SESSION_SECRET must be set and be exactly 32 bytes (256 bits)',
      )
    })

    test('throws if sessionSalt is too short', () => {
      expect(() => createInvitationAuth('too-short')).toThrow(
        'SESSION_SECRET must be set and be exactly 32 bytes (256 bits)',
      )
    })

    test('throws if sessionSalt is too long', () => {
      expect(() =>
        createInvitationAuth('this-is-way-too-long-for-a-256-bit-key-it-has-too-many-bytes'),
      ).toThrow('SESSION_SECRET must be set and be exactly 32 bytes (256 bits)')
    })

    test('succeeds with exactly 32 bytes', () => {
      expect(() => createInvitationAuth(VALID_SALT)).not.toThrow()
    })
  })

  describe('createInvitationToken', () => {
    const auth = createInvitationAuth(VALID_SALT)

    test('creates a token with expected format (3 parts separated by dashes)', () => {
      const token = auth.createInvitationToken()
      const parts = token.split('-')
      expect(parts).toHaveLength(3)
    })

    test('creates different tokens each time (unique IV)', () => {
      const token1 = auth.createInvitationToken()
      const token2 = auth.createInvitationToken()
      expect(token1).not.toBe(token2)
    })

    test('creates valid tokens with default 7-day expiry', () => {
      const token = auth.createInvitationToken()
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(true)
    })

    test('creates valid tokens with custom expiry', () => {
      const token = auth.createInvitationToken(24) // 24 hours
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(true)
    })
  })

  describe('validateInvitationToken', () => {
    const auth = createInvitationAuth(VALID_SALT)

    test('validates a valid token', () => {
      const token = auth.createInvitationToken()
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(true)
      expect(result.expired).toBeUndefined()
      expect(result.error).toBeUndefined()
    })

    test('returns invalid for empty token', () => {
      const result = auth.validateInvitationToken('')
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid token')
    })

    test('returns invalid for malformed token (wrong number of parts)', () => {
      expect(auth.validateInvitationToken('only-two-parts').valid).toBe(false)
      expect(auth.validateInvitationToken('too-many-parts-here-now').valid).toBe(false)
    })

    test('returns invalid for tampered token', () => {
      const token = auth.createInvitationToken()
      const parts = token.split('-')
      parts[0] = 'tampered' + parts[0]
      const tamperedToken = parts.join('-')
      const result = auth.validateInvitationToken(tamperedToken)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid token')
    })

    test('returns invalid for token from different salt', () => {
      const otherAuth = createInvitationAuth('other-secret-key-32-bytes-long!!') // exactly 32 bytes
      const token = otherAuth.createInvitationToken()
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(false)
      expect(result.error).toBe('Invalid token')
    })
  })

  describe('token expiry', () => {
    const auth = createInvitationAuth(VALID_SALT)

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('token expires after specified time', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      const token = auth.createInvitationToken(1) // 1 hour

      // Still valid after 59 minutes
      vi.setSystemTime(new Date('2024-01-15T12:59:00Z'))
      expect(auth.validateInvitationToken(token).valid).toBe(true)

      // Expired after 61 minutes
      vi.setSystemTime(new Date('2024-01-15T13:01:00Z'))
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(false)
      expect(result.expired).toBe(true)
      expect(result.error).toBe('Token expired')
    })

    test('default expiry is 7 days', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      const token = auth.createInvitationToken()

      // Still valid after 6 days
      vi.setSystemTime(new Date('2024-01-21T12:00:00Z'))
      expect(auth.validateInvitationToken(token).valid).toBe(true)

      // Expired after 8 days
      vi.setSystemTime(new Date('2024-01-23T12:00:00Z'))
      const result = auth.validateInvitationToken(token)
      expect(result.valid).toBe(false)
      expect(result.expired).toBe(true)
    })
  })

  describe('getTokenExpiry', () => {
    const auth = createInvitationAuth(VALID_SALT)

    beforeEach(() => {
      vi.useFakeTimers()
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    test('returns correct expiry date', () => {
      const now = new Date('2024-01-15T12:00:00Z')
      vi.setSystemTime(now)

      const token = auth.createInvitationToken(24) // 24 hours
      const expiry = auth.getTokenExpiry(token)

      expect(expiry).toEqual(new Date('2024-01-16T12:00:00Z'))
    })

    test('returns null for invalid token', () => {
      expect(auth.getTokenExpiry('')).toBeNull()
      expect(auth.getTokenExpiry('invalid-token-here')).toBeNull()
    })
  })

  describe('stress test', () => {
    const auth = createInvitationAuth(VALID_SALT)

    test('can create and validate many tokens without errors', () => {
      for (let i = 0; i < 100; i++) {
        const token = auth.createInvitationToken()
        expect(auth.validateInvitationToken(token).valid).toBe(true)
      }
    })
  })
})
