import { describe, expect, test } from 'vitest'

import { adminContactLinks, hasAdminContact } from './admin-contact'

describe('adminContactLinks', () => {
  test('a handle on this server links to the local public profile', () => {
    expect(adminContactLinks('fiddur@aurboda.net', null, 'aurboda.net').fediverse).toEqual({
      href: '/u/fiddur',
      label: '@fiddur@aurboda.net',
    })
  })

  test('the host comparison ignores case', () => {
    expect(adminContactLinks('fiddur@aurboda.net', null, 'Aurboda.net').fediverse?.href).toBe('/u/fiddur')
  })

  test('a handle on another server links to its profile there', () => {
    expect(adminContactLinks('alice@mastodon.example', null, 'aurboda.net').fediverse).toEqual({
      href: 'https://mastodon.example/@alice',
      label: '@alice@mastodon.example',
    })
  })

  test('reddit links to a private message to the user', () => {
    expect(adminContactLinks(null, 'fiddur', 'aurboda.net').reddit).toEqual({
      href: 'https://www.reddit.com/message/compose/?to=fiddur',
      label: 'u/fiddur',
    })
  })

  test('nothing set means no contact', () => {
    const links = adminContactLinks(null, null, 'aurboda.net')
    expect(links).toEqual({ fediverse: null, reddit: null })
    expect(hasAdminContact(links)).toBe(false)
    expect(hasAdminContact(adminContactLinks(null, 'fiddur', 'aurboda.net'))).toBe(true)
  })
})
