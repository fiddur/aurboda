import { describe, expect, it } from 'vitest'

import { createPkcePair, openState, sealState } from './oauth-state.ts'

const NOW = new Date('2026-09-03T10:00:00Z')

describe('PKCE state', () => {
  it('produces an S256 challenge for a fresh verifier', () => {
    const { challenge, verifier } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(challenge).not.toBe(verifier)
  })

  it('round-trips user + verifier through a sealed state', () => {
    const sealed = sealState({ iat: NOW.getTime(), user: 'alice', verifier: 'v' }, 'gcs_secret')
    expect(openState(sealed, 'gcs_secret', NOW)).toEqual({ iat: NOW.getTime(), user: 'alice', verifier: 'v' })
  })

  it('rejects a state sealed under a different secret, a tampered one, and an expired one', () => {
    const sealed = sealState({ iat: NOW.getTime(), user: 'alice', verifier: 'v' }, 'gcs_secret')
    expect(openState(sealed, 'gcs_other', NOW)).toBeNull()
    // Flip a character in the middle: every bit of it is payload, so the sealed
    // bytes always change (the trailing characters carry padding bits and can
    // decode to the same bytes — a tamper there was a 1-in-256 no-op).
    const tampered = `${sealed.slice(0, 20)}${sealed[20] === 'A' ? 'B' : 'A'}${sealed.slice(21)}`
    expect(openState(tampered, 'gcs_secret', NOW)).toBeNull()
    expect(openState(sealed, 'gcs_secret', new Date(NOW.getTime() + 11 * 60 * 1000))).toBeNull()
    expect(openState('not-a-state', 'gcs_secret', NOW)).toBeNull()
  })
})
