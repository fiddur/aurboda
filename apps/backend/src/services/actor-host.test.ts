import { actorHost, hostMatches } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

describe('actorHost', () => {
  test('is the lowercased host without port, null for a non-URL', () => {
    expect(actorHost('https://Social.Peer.example:8443/users/bob')).toBe('social.peer.example')
    expect(actorHost('nope')).toBeNull()
  })
})

describe('hostMatches', () => {
  test('matches the domain itself and its subdomains, not a lookalike', () => {
    expect(hostMatches('peer.example', 'peer.example')).toBe(true)
    expect(hostMatches('social.peer.example', 'peer.example')).toBe(true)
    expect(hostMatches('notpeer.example', 'peer.example')).toBe(false)
    expect(hostMatches('peer.example', 'social.peer.example')).toBe(false)
  })
})
