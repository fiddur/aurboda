import { afterEach, beforeEach, describe, expect, test } from 'vitest'
import { createToken, getUsernameFromToken, initializeAuth } from './auth'

describe('auth', () => {
  const originalEnv = process.env.SESSION_SALT

  beforeEach(() => {
    process.env.SESSION_SALT = 'test-secret-key-32-bytes-long!!!' // exactly 32 bytes
    initializeAuth()
  })

  afterEach(() => {
    process.env.SESSION_SALT = originalEnv
  })

  describe('initializeAuth', () => {
    test('throws if SESSION_SALT is not set', () => {
      delete process.env.SESSION_SALT
      expect(() => initializeAuth()).toThrow('SESSION_SALT must be set and be exactly 32 bytes')
    })

    test('throws if SESSION_SALT is too short', () => {
      process.env.SESSION_SALT = 'too-short'
      expect(() => initializeAuth()).toThrow('SESSION_SALT must be set and be exactly 32 bytes')
    })

    test('throws if SESSION_SALT is too long', () => {
      process.env.SESSION_SALT = 'this-is-way-too-long-for-a-256-bit-key-it-has-too-many-bytes'
      expect(() => initializeAuth()).toThrow('SESSION_SALT must be set and be exactly 32 bytes')
    })

    test('succeeds with exactly 32 bytes', () => {
      process.env.SESSION_SALT = 'exactly-32-bytes-long-key-here!!'
      expect(() => initializeAuth()).not.toThrow()
    })
  })

  describe('createToken', () => {
    test('creates a token with expected format', () => {
      const token = createToken('testuser')
      const parts = token.split('-')
      expect(parts).toHaveLength(3)
    })

    test('creates different tokens for same username (unique IV)', () => {
      const token1 = createToken('testuser')
      const token2 = createToken('testuser')
      expect(token1).not.toBe(token2)
    })

    test('can create multiple tokens without error (fresh cipher each time)', () => {
      expect(() => {
        createToken('user1')
        createToken('user2')
        createToken('user3')
      }).not.toThrow()
    })
  })

  describe('getUsernameFromToken', () => {
    test('decrypts token to original username', () => {
      const token = createToken('testuser')
      const username = getUsernameFromToken(token)
      expect(username).toBe('testuser')
    })

    test('can decrypt the same token multiple times (no cipher reuse bug)', () => {
      const token = createToken('testuser')

      const username1 = getUsernameFromToken(token)
      const username2 = getUsernameFromToken(token)

      expect(username1).toBe('testuser')
      expect(username2).toBe('testuser')
    })

    test('can decrypt different tokens consecutively', () => {
      const token1 = createToken('user1')
      const token2 = createToken('user2')

      expect(getUsernameFromToken(token1)).toBe('user1')
      expect(getUsernameFromToken(token2)).toBe('user2')
      expect(getUsernameFromToken(token1)).toBe('user1')
    })

    test('throws on empty token', () => {
      expect(() => getUsernameFromToken('')).toThrow('unauthenticated')
    })

    test('throws on malformed token', () => {
      expect(() => getUsernameFromToken('not-a-valid-token')).toThrow()
    })

    test('throws on tampered token', () => {
      const token = createToken('testuser')
      const parts = token.split('-')
      parts[0] = 'tampered' + parts[0]
      const tamperedToken = parts.join('-')
      expect(() => getUsernameFromToken(tamperedToken)).toThrow()
    })
  })

  describe('round-trip token creation and validation', () => {
    test('handles usernames with special characters', () => {
      const usernames = ['user@example.com', 'user-name', 'user_name', 'user.name']
      for (const username of usernames) {
        const token = createToken(username)
        expect(getUsernameFromToken(token)).toBe(username)
      }
    })

    test('handles unicode usernames', () => {
      const token = createToken('用户名')
      expect(getUsernameFromToken(token)).toBe('用户名')
    })

    test('stress test: create and validate many tokens', () => {
      for (let i = 0; i < 100; i++) {
        const username = `user${i}`
        const token = createToken(username)
        expect(getUsernameFromToken(token)).toBe(username)
      }
    })
  })
})
