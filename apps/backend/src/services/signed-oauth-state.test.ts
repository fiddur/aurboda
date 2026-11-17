import { createHmac } from 'node:crypto'
import { describe, expect, test } from 'vitest'

import { SIGNED_STATE_MAX_AGE_MS, signOAuthState, verifyOAuthState } from './signed-oauth-state.ts'

const secret = 'client-secret'
const now = new Date('2026-11-17T12:00:00Z')
const at = (offsetMs: number) => new Date(now.getTime() + offsetMs)

const sign = (user = 'alice', provider = 'oura', when = now) =>
  signOAuthState({ provider, user }, secret, when)

describe('signed OAuth state', () => {
  test('round-trips the username', () => {
    expect(verifyOAuthState(sign(), { provider: 'oura' }, secret, now)).toBe('alice')
  })

  test('round-trips a username with dots and unicode', () => {
    const user = 'år.ö.ðü.名前'
    expect(verifyOAuthState(sign(user), { provider: 'oura' }, secret, now)).toBe(user)
  })

  test('rejects a state signed with another secret', () => {
    const state = signOAuthState({ provider: 'oura', user: 'alice' }, 'other-secret', now)
    expect(verifyOAuthState(state, { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('rejects a tampered payload carrying the original hmac', () => {
    const [payloadB64, hmac] = sign().split('.')
    const payload = JSON.parse(Buffer.from(payloadB64, 'base64url').toString())
    const swapped = Buffer.from(JSON.stringify({ ...payload, user: 'mallory' })).toString('base64url')
    expect(verifyOAuthState(`${swapped}.${hmac}`, { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('rejects a truncated or altered hmac', () => {
    const state = sign()
    const lastChar = state.at(-1)
    expect(verifyOAuthState(state.slice(0, -1), { provider: 'oura' }, secret, now)).toBeNull()
    expect(
      verifyOAuthState(
        `${state.slice(0, -1)}${lastChar === 'A' ? 'B' : 'A'}`,
        { provider: 'oura' },
        secret,
        now,
      ),
    ).toBeNull()
  })

  test('rejects a state issued for another provider', () => {
    expect(verifyOAuthState(sign('alice', 'strava'), { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('accepts a state exactly at the max age and rejects it 1 ms later', () => {
    const state = sign()
    expect(verifyOAuthState(state, { provider: 'oura' }, secret, at(SIGNED_STATE_MAX_AGE_MS))).toBe('alice')
    expect(verifyOAuthState(state, { provider: 'oura' }, secret, at(SIGNED_STATE_MAX_AGE_MS + 1))).toBeNull()
  })

  test('allows a minute of clock skew and rejects a state issued further in the future', () => {
    expect(verifyOAuthState(sign('alice', 'oura', at(60_000)), { provider: 'oura' }, secret, now)).toBe(
      'alice',
    )
    expect(verifyOAuthState(sign('alice', 'oura', at(60_001)), { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('rejects a validly signed state with an empty user', () => {
    expect(verifyOAuthState(sign(''), { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('rejects a validly signed payload missing fields', () => {
    const payloadB64 = Buffer.from(
      JSON.stringify({ iat: now.getTime(), provider: 'oura', user: 'alice' }),
    ).toString('base64url')
    const hmac = createHmac('sha256', secret).update(payloadB64).digest('base64url')
    expect(verifyOAuthState(`${payloadB64}.${hmac}`, { provider: 'oura' }, secret, now)).toBeNull()
  })

  test.each(['', 'garbage', 'a.b', 'alice'])('rejects %j', (state) => {
    expect(verifyOAuthState(state, { provider: 'oura' }, secret, now)).toBeNull()
  })

  test('signs the same user differently each time', () => {
    expect(sign()).not.toBe(sign())
  })
})
