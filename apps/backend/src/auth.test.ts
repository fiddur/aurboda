import { describe, expect, test } from 'vitest'
import { createAuth } from './auth'

const VALID_SALT = 'test-secret-key-32-bytes-long!!!' // exactly 32 bytes

describe('auth', () => {
  describe('createAuth', () => {
    test('throws if sessionSalt is empty', () => {
      expect(() => createAuth('')).toThrow('SESSION_SECRET must be set and be exactly 32 bytes (256 bits)')
    })

    test('throws if sessionSalt is too short', () => {
      expect(() => createAuth('too-short')).toThrow(
        'SESSION_SECRET must be set and be exactly 32 bytes (256 bits)',
      )
    })

    test('throws if sessionSalt is too long', () => {
      expect(() => createAuth('this-is-way-too-long-for-a-256-bit-key-it-has-too-many-bytes')).toThrow(
        'SESSION_SECRET must be set and be exactly 32 bytes (256 bits)',
      )
    })

    test('succeeds with exactly 32 bytes', () => {
      expect(() => createAuth(VALID_SALT)).not.toThrow()
    })
  })

  describe('createToken', () => {
    const auth = createAuth(VALID_SALT)

    test('creates a token with expected format (3 parts separated by dashes)', () => {
      const token = auth.createToken('testuser')
      const parts = token.split('-')
      expect(parts).toHaveLength(3)
    })

    test('creates different tokens for same username (unique IV each time)', () => {
      const token1 = auth.createToken('testuser')
      const token2 = auth.createToken('testuser')
      expect(token1).not.toBe(token2)
    })

    test('can create multiple tokens without error (fresh cipher each time)', () => {
      expect(() => {
        auth.createToken('user1')
        auth.createToken('user2')
        auth.createToken('user3')
      }).not.toThrow()
    })
  })

  describe('getUsernameFromToken', () => {
    const auth = createAuth(VALID_SALT)

    test('decrypts token to original username', () => {
      const token = auth.createToken('testuser')
      const username = auth.getUsernameFromToken(token)
      expect(username).toBe('testuser')
    })

    test('can decrypt the same token multiple times (no cipher reuse bug)', () => {
      const token = auth.createToken('testuser')

      const username1 = auth.getUsernameFromToken(token)
      const username2 = auth.getUsernameFromToken(token)

      expect(username1).toBe('testuser')
      expect(username2).toBe('testuser')
    })

    test('can decrypt different tokens consecutively', () => {
      const token1 = auth.createToken('user1')
      const token2 = auth.createToken('user2')

      expect(auth.getUsernameFromToken(token1)).toBe('user1')
      expect(auth.getUsernameFromToken(token2)).toBe('user2')
      expect(auth.getUsernameFromToken(token1)).toBe('user1')
    })

    test('throws "unauthenticated" on empty token', () => {
      expect(() => auth.getUsernameFromToken('')).toThrow('unauthenticated')
    })

    test('throws "unauthenticated" on malformed token (wrong number of parts)', () => {
      expect(() => auth.getUsernameFromToken('only-two-parts')).toThrow('unauthenticated')
      expect(() => auth.getUsernameFromToken('too-many-parts-here-now')).toThrow('unauthenticated')
    })

    test('throws "unauthenticated" on tampered token', () => {
      const token = auth.createToken('testuser')
      const parts = token.split('-')
      parts[0] = 'tampered' + parts[0]
      const tamperedToken = parts.join('-')
      expect(() => auth.getUsernameFromToken(tamperedToken)).toThrow('unauthenticated')
    })

    test('throws "unauthenticated" on invalid base64 in token', () => {
      expect(() => auth.getUsernameFromToken('invalid!base64-also!bad-more!bad')).toThrow('unauthenticated')
    })
  })

  describe('round-trip token creation and validation', () => {
    const auth = createAuth(VALID_SALT)

    test('handles usernames with special characters', () => {
      const usernames = ['user@example.com', 'user-name', 'user_name', 'user.name']
      for (const username of usernames) {
        const token = auth.createToken(username)
        expect(auth.getUsernameFromToken(token)).toBe(username)
      }
    })

    test('handles unicode usernames', () => {
      const token = auth.createToken('用户名')
      expect(auth.getUsernameFromToken(token)).toBe('用户名')
    })

    test('stress test: create and validate many tokens without cipher reuse errors', () => {
      for (let i = 0; i < 100; i++) {
        const username = `user${i}`
        const token = auth.createToken(username)
        expect(auth.getUsernameFromToken(token)).toBe(username)
      }
    })
  })

  describe('isolation between auth instances', () => {
    test('tokens from one auth instance cannot be decoded by another', () => {
      const auth1 = createAuth('salt-one-32-bytes-exactly-here!!')
      const auth2 = createAuth('salt-two-32-bytes-exactly-here!!')

      const token = auth1.createToken('testuser')

      expect(() => auth2.getUsernameFromToken(token)).toThrow('unauthenticated')
    })
  })
})
