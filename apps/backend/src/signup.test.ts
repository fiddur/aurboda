import { describe, expect, test } from 'vitest'

/**
 * Test the username validation rules used by the signup endpoint.
 * Username must be 3-31 characters, start with a letter, and contain
 * only lowercase letters, numbers, and underscores.
 */
const isValidUsername = (username: string): boolean => /^[a-z][a-z0-9_]{2,30}$/.test(username)

describe('signup username validation', () => {
  describe('valid usernames', () => {
    test('accepts minimum length username (3 chars)', () => {
      expect(isValidUsername('abc')).toBe(true)
    })

    test('accepts maximum length username (31 chars)', () => {
      expect(isValidUsername('a123456789012345678901234567890')).toBe(true)
    })

    test('accepts username with underscores', () => {
      expect(isValidUsername('test_user')).toBe(true)
    })

    test('accepts username with numbers', () => {
      expect(isValidUsername('user123')).toBe(true)
    })

    test('accepts username with mixed allowed characters', () => {
      expect(isValidUsername('my_user_123')).toBe(true)
    })
  })

  describe('invalid usernames', () => {
    test('rejects username that starts with a number', () => {
      expect(isValidUsername('123user')).toBe(false)
    })

    test('rejects username that starts with an underscore', () => {
      expect(isValidUsername('_user')).toBe(false)
    })

    test('rejects username with uppercase letters', () => {
      expect(isValidUsername('TestUser')).toBe(false)
    })

    test('rejects username with special characters', () => {
      expect(isValidUsername('user@test')).toBe(false)
      expect(isValidUsername('user-test')).toBe(false)
      expect(isValidUsername('user.test')).toBe(false)
    })

    test('rejects username that is too short (< 3 chars)', () => {
      expect(isValidUsername('ab')).toBe(false)
    })

    test('rejects username that is too long (> 31 chars)', () => {
      expect(isValidUsername('a1234567890123456789012345678901')).toBe(false)
    })

    test('rejects empty username', () => {
      expect(isValidUsername('')).toBe(false)
    })

    test('rejects username with spaces', () => {
      expect(isValidUsername('test user')).toBe(false)
    })

    test('rejects username with only numbers after first char', () => {
      // This should pass since 'a12' is valid
      expect(isValidUsername('a12')).toBe(true)
      // But '123' starting with number fails
      expect(isValidUsername('123')).toBe(false)
    })
  })

  describe('PostgreSQL safety', () => {
    test('rejects SQL injection attempts', () => {
      expect(isValidUsername("admin'; DROP TABLE users;--")).toBe(false)
      expect(isValidUsername('admin OR 1=1')).toBe(false)
    })

    test('rejects PostgreSQL reserved words formatted as injection', () => {
      // While 'select' alone would be valid, these injection patterns are not
      expect(isValidUsername('a;SELECT * FROM pg_user')).toBe(false)
    })
  })
})
