import { describe, expect, test, vi } from 'vitest'

import type { PublicTagBlockRecord, PublicTagHiddenRecord } from './central-public-tags.ts'

import {
  createPublicTagModeration,
  HIDDEN_LIST_LIMIT,
  isBlocked,
  isPublicTagPostRefused,
  normalizeBlockDomain,
  type PublicTagModerationStore,
} from './public-tag-moderation.ts'

const ID = '11111111-1111-4111-8111-111111111111'

const blockRecord = (kind: 'actor' | 'domain', value: string): PublicTagBlockRecord => ({
  created_at: new Date('2026-11-15T00:00:00Z'),
  created_by: 'root',
  id: ID,
  kind,
  value,
})

const hiddenRecord: PublicTagHiddenRecord = {
  actor_uri: 'https://spam.example/users/x',
  hidden_at: new Date('2026-11-15T00:00:00Z'),
  hidden_by: 'root',
  id: ID,
  note_uri: 'https://spam.example/notes/1',
}

describe('isBlocked', () => {
  const blocks = [
    blockRecord('actor', 'https://peer.example/users/eve'),
    blockRecord('domain', 'spam.example'),
  ]

  test('an actor block matches that actor URI only', () => {
    expect(isBlocked('https://peer.example/users/eve', blocks)).toBe(true)
    expect(isBlocked('https://peer.example/users/eve2', blocks)).toBe(false)
    expect(isBlocked('https://peer.example/users/bob', blocks)).toBe(false)
  })

  test('a domain block matches the host and its subdomains, case- and port-insensitively', () => {
    expect(isBlocked('https://spam.example/users/x', blocks)).toBe(true)
    expect(isBlocked('https://Social.SPAM.example:8443/users/x', blocks)).toBe(true)
    expect(isBlocked('https://notspam.example/users/x', blocks)).toBe(false)
    expect(isBlocked('https://spam.example.org/users/x', blocks)).toBe(false)
  })

  test('an unparsable actor URI is only matched by an equal actor block', () => {
    expect(isBlocked('not a url', blocks)).toBe(false)
    expect(isBlocked('not a url', [blockRecord('actor', 'not a url')])).toBe(true)
    expect(isBlocked('https://peer.example/users/bob', [])).toBe(false)
  })
})

describe('normalizeBlockDomain', () => {
  test.each([
    ['example.org', 'example.org'],
    ['  Example.ORG ', 'example.org'],
    ['https://social.example.org/@bob/123', 'social.example.org'],
    ['@example.org', 'example.org'],
    ['@bob@example.org', 'example.org'],
    ['*.example.org', 'example.org'],
    ['example.org:443', 'example.org'],
    ['http://example.org:8080/path?x=1', 'example.org'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeBlockDomain(input)).toBe(expected)
  })

  test.each(['', '   ', 'https://', 'not a domain', 'exa mple.org', '-bad.example', 'a..b'])(
    'refuses %j',
    (input) => {
      expect(normalizeBlockDomain(input)).toBeNull()
    },
  )
})

describe('isPublicTagPostRefused', () => {
  test('refuses a hidden note, then a blocked actor, and lets the rest through', async () => {
    const store = {
      isPublicTagPostHidden: vi.fn(async (noteUri: string) => noteUri === 'https://peer.example/notes/1'),
      listPublicTagBlocks: vi.fn(async () => [blockRecord('domain', 'spam.example')]),
    }
    expect(
      await isPublicTagPostRefused(store, 'https://peer.example/notes/1', 'https://peer.example/u'),
    ).toBe(true)
    expect(store.listPublicTagBlocks).not.toHaveBeenCalled()
    expect(await isPublicTagPostRefused(store, 'https://spam.example/n/2', 'https://spam.example/u')).toBe(
      true,
    )
    expect(
      await isPublicTagPostRefused(store, 'https://peer.example/notes/3', 'https://peer.example/u'),
    ).toBe(false)
  })
})

const fakeStore = (actors: string[] = []): PublicTagModerationStore => ({
  deletePublicTagBlock: vi.fn(async (id: string) => id === ID),
  deletePublicTagPostsByActors: vi.fn(async (uris: string[]) => uris.length * 2),
  hidePublicTagPost: vi.fn(async (id: string) => (id === ID ? hiddenRecord : null)),
  insertPublicTagBlock: vi.fn(async (kind, value) =>
    value === 'dupe.example' ? null : blockRecord(kind, value),
  ),
  listHiddenPublicTagPosts: vi.fn(async () => [hiddenRecord]),
  listPublicTagBlocks: vi.fn(async () => [blockRecord('domain', 'spam.example')]),
  listPublicTagPostActors: vi.fn(async () => actors),
  unhidePublicTagPost: vi.fn(async (id: string) => id === ID),
})

describe('createPublicTagModeration', () => {
  const OWN = 'aurboda.example.org'

  test('a domain block is normalised, stored and removes the posts it matches', async () => {
    const store = fakeStore([
      'https://spam.example/users/a',
      'https://m.spam.example/users/b',
      'https://peer.example/users/c',
    ])
    const moderation = createPublicTagModeration({ ownHost: OWN, store })
    const result = await moderation.addBlock({ kind: 'domain', value: 'https://Spam.example/' }, 'root')
    expect(store.insertPublicTagBlock).toHaveBeenCalledWith('domain', 'spam.example', 'root')
    expect(store.deletePublicTagPostsByActors).toHaveBeenCalledWith([
      'https://spam.example/users/a',
      'https://m.spam.example/users/b',
    ])
    expect(result).toEqual({
      block: {
        created_at: '2026-11-15T00:00:00.000Z',
        created_by: 'root',
        id: ID,
        kind: 'domain',
        value: 'spam.example',
      },
      ok: true,
      removed_posts: 4,
    })
  })

  test('an actor block removes that actor’s posts only', async () => {
    const store = fakeStore(['https://peer.example/users/eve', 'https://peer.example/users/bob'])
    const moderation = createPublicTagModeration({ ownHost: OWN, store })
    const result = await moderation.addBlock(
      { kind: 'actor', value: ' https://peer.example/users/eve ' },
      'root',
    )
    expect(store.insertPublicTagBlock).toHaveBeenCalledWith('actor', 'https://peer.example/users/eve', 'root')
    expect(store.deletePublicTagPostsByActors).toHaveBeenCalledWith(['https://peer.example/users/eve'])
    expect(result.ok).toBe(true)
  })

  test('refuses a non-URL actor, a non-domain, this server’s own host or a parent of it, and a duplicate', async () => {
    const store = fakeStore()
    const moderation = createPublicTagModeration({ ownHost: OWN, store })
    for (const input of [
      { kind: 'actor' as const, value: 'eve@peer.example' },
      { kind: 'actor' as const, value: 'ftp://peer.example/eve' },
      { kind: 'domain' as const, value: 'not a domain' },
      { kind: 'domain' as const, value: 'aurboda.example.org' },
      { kind: 'domain' as const, value: 'example.org' },
    ]) {
      expect(await moderation.addBlock(input, 'root')).toMatchObject({ ok: false, status: 400 })
    }
    expect(store.insertPublicTagBlock).not.toHaveBeenCalled()
    expect(await moderation.addBlock({ kind: 'domain', value: 'dupe.example' }, 'root')).toEqual({
      error: 'Already blocked',
      ok: false,
      status: 409,
    })
    expect(store.deletePublicTagPostsByActors).not.toHaveBeenCalled()
  })

  test('hides by post id as the admin, null for an unknown or malformed id', async () => {
    const store = fakeStore()
    const moderation = createPublicTagModeration({ ownHost: OWN, store })
    expect(await moderation.hide(ID, 'root')).toEqual({
      actor_uri: 'https://spam.example/users/x',
      hidden_at: '2026-11-15T00:00:00.000Z',
      hidden_by: 'root',
      id: ID,
      note_uri: 'https://spam.example/notes/1',
    })
    expect(store.hidePublicTagPost).toHaveBeenCalledWith(ID, 'root')
    expect(await moderation.hide('22222222-2222-4222-8222-222222222222', 'root')).toBeNull()
    expect(await moderation.hide('nope', 'root')).toBeNull()
    expect(store.hidePublicTagPost).toHaveBeenCalledTimes(2)
  })

  test('lists, unhides and unblocks, never querying with a malformed id', async () => {
    const store = fakeStore()
    const moderation = createPublicTagModeration({ ownHost: OWN, store })
    expect(await moderation.listHidden()).toHaveLength(1)
    expect(store.listHiddenPublicTagPosts).toHaveBeenCalledWith(HIDDEN_LIST_LIMIT)
    expect((await moderation.listBlocks())[0]).toMatchObject({ kind: 'domain', value: 'spam.example' })
    expect(await moderation.unhide(ID)).toBe(true)
    expect(await moderation.removeBlock(ID)).toBe(true)
    expect(await moderation.unhide('nope')).toBe(false)
    expect(await moderation.removeBlock('nope')).toBe(false)
    expect(store.unhidePublicTagPost).toHaveBeenCalledTimes(1)
    expect(store.deletePublicTagBlock).toHaveBeenCalledTimes(1)
  })
})
