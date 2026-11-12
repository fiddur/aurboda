import { describe, expect, test } from 'vitest'

import { createExportTokens } from './export-token.ts'

const SECRET = '0123456789abcdef0123456789abcdef'
const t0 = new Date('2026-11-06T12:00:00Z')
const later = (seconds: number) => new Date(t0.getTime() + seconds * 1000)

describe('export tokens', () => {
  test('a fresh token verifies to its user', () => {
    const tokens = createExportTokens(SECRET)
    const { expires_at, token } = tokens.createExportToken('alice', 600, t0)
    expect(expires_at).toEqual(later(600))
    expect(tokens.verifyExportToken(token, later(599))?.user).toBe('alice')
  })

  test('the token is URL-safe', () => {
    const { token } = createExportTokens(SECRET).createExportToken('alice', 600, t0)
    expect(encodeURIComponent(token)).toBe(token)
  })

  test('an expired token is rejected', () => {
    const tokens = createExportTokens(SECRET)
    const { token } = tokens.createExportToken('alice', 600, t0)
    expect(tokens.verifyExportToken(token, later(600))).toBeNull()
  })

  test('a tampered token is rejected', () => {
    const tokens = createExportTokens(SECRET)
    const { token } = tokens.createExportToken('alice', 600, t0)
    const [encrypted, iv, tag] = token.split('.')
    const bytes = Buffer.from(encrypted, 'base64url')
    bytes[0] ^= 1
    const flipped = bytes.toString('base64url')
    expect(tokens.verifyExportToken(`${flipped}.${iv}.${tag}`, t0)).toBeNull()
    expect(tokens.verifyExportToken('not-a-token', t0)).toBeNull()
    expect(tokens.verifyExportToken('', t0)).toBeNull()
  })

  test('a token from another secret is rejected', () => {
    const { token } = createExportTokens(SECRET).createExportToken('alice', 600, t0)
    expect(createExportTokens('fedcba9876543210fedcba9876543210').verifyExportToken(token, t0)).toBeNull()
  })

  test('a spent token is rejected, other tokens for the user are not', () => {
    const tokens = createExportTokens(SECRET)
    const first = tokens.createExportToken('alice', 600, t0)
    const second = tokens.createExportToken('alice', 600, t0)
    const payload = tokens.verifyExportToken(first.token, t0)
    expect(payload).not.toBeNull()
    tokens.spendExportToken(payload!)
    expect(tokens.verifyExportToken(first.token, t0)).toBeNull()
    expect(tokens.verifyExportToken(second.token, t0)?.user).toBe('alice')
  })

  test('refuses a secret of the wrong length', () => {
    expect(() => createExportTokens('short')).toThrow(/32 bytes/)
  })
})
