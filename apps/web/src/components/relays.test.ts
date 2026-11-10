import { describe, expect, test } from 'vitest'

import { hasTagsPubRelay, relayStateLabel, relayStateTitle, relayStyleLabel, TAGS_PUB_RELAY } from './relays'

describe('relay labels', () => {
  test('name the states and styles', () => {
    expect(relayStateLabel('pending')).toBe('Pending')
    expect(relayStateLabel('accepted')).toBe('Accepted')
    expect(relayStateLabel('rejected')).toBe('Rejected')
    expect(relayStyleLabel('mastodon')).toBe('Mastodon')
    expect(relayStyleLabel('litepub')).toBe('LitePub')
  })

  test('the badge title is the last error when there is one', () => {
    expect(relayStateTitle({ last_error: 'connection refused', state: 'pending' })).toBe('connection refused')
    expect(relayStateTitle({ last_error: null, state: 'accepted' })).toBe('Accepted')
  })
})

describe('TAGS_PUB_RELAY', () => {
  test('is the tags.pub relay inbox, Mastodon style', () => {
    expect(TAGS_PUB_RELAY).toEqual({ style: 'mastodon', url: 'https://tags.pub/user/_____relay_____/inbox' })
  })

  test('hasTagsPubRelay finds it among the added relays', () => {
    expect(hasTagsPubRelay([{ url: TAGS_PUB_RELAY.url }])).toBe(true)
    expect(hasTagsPubRelay([{ url: 'https://relay.example/inbox' }])).toBe(false)
  })
})
