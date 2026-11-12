import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createPublicTagsApi,
  CREATE_INSTANCE_TAG_FOLLOWS_TABLE,
  CREATE_PUBLIC_TAG_POSTS_INDEXES,
  CREATE_PUBLIC_TAG_POSTS_TABLE,
  type PublicTagPostInput,
} from './central-public-tags.ts'

const CONTAINER_TIMEOUT = 120_000

const BASE = new Date(Date.now() - 24 * 60 * 60 * 1000)
const KEEP = { retentionDays: 30 }

const post = (n: number, overrides: Partial<PublicTagPostInput> = {}): PublicTagPostInput => ({
  actor_uri: 'https://peer.example/users/bob',
  announce_uris: [`https://tags.example/announce/${n}`],
  avatar_url: null,
  content: `<p>Post ${n}</p>`,
  display_name: 'Bob',
  handle: '@bob@peer.example',
  images: [],
  local_user: null,
  note_uri: `https://peer.example/notes/${n}`,
  published_at: new Date(BASE.getTime() + n * 60_000),
  tags: ['aurboda'],
  url: `https://peer.example/@bob/${n}`,
  ...overrides,
})

describe('central public tag pages', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    await client.query(CREATE_INSTANCE_TAG_FOLLOWS_TABLE)
    await client.query(CREATE_PUBLIC_TAG_POSTS_TABLE)
    for (const stmt of CREATE_PUBLIC_TAG_POSTS_INDEXES) await client.query(stmt)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query('TRUNCATE TABLE instance_tag_follows, public_tag_posts')
  })

  const api = () => createPublicTagsApi(async () => getTestDbClient())

  const follow = (tag: string) => ({
    actor_uri: `https://tags.example/user/${tag}`,
    follow_activity_id: `https://aurboda.test/actor/follows/tags/${tag}`,
    inbox_uri: `https://tags.example/user/${tag}/inbox`,
    tag,
  })

  test('tag follows: upsert pending, look up by every key, accept, re-upsert resets, delete', async () => {
    const a = api()
    const row = await a.upsertInstanceTagFollow(follow('aurboda'))
    expect(row.accepted).toBe(false)
    await a.upsertInstanceTagFollow(follow('running'))
    expect((await a.listInstanceTagFollows()).map((r) => r.tag)).toEqual(['aurboda', 'running'])
    expect((await a.getInstanceTagFollow('aurboda'))?.actor_uri).toBe(row.actor_uri)
    expect((await a.getInstanceTagFollowByActor(row.actor_uri))?.tag).toBe('aurboda')
    expect((await a.getInstanceTagFollowByFollowId(row.follow_activity_id))?.tag).toBe('aurboda')
    expect((await a.setInstanceTagFollowAccepted(row.follow_activity_id, true))?.accepted).toBe(true)
    expect(await a.setInstanceTagFollowAccepted('https://nope.example/f', true)).toBeNull()
    expect((await a.upsertInstanceTagFollow(follow('aurboda'))).accepted).toBe(false)
    expect(await a.deleteInstanceTagFollow('aurboda')).toBe(true)
    expect(await a.deleteInstanceTagFollow('aurboda')).toBe(false)
    expect(await a.getInstanceTagFollow('aurboda')).toBeNull()
  })

  test('a post is upserted on its Note id, gathering Announce ids and keeping the local author', async () => {
    const a = api()
    const first = await a.upsertPublicTagPost(post(1, { images: [{ url: 'https://peer.example/a.png' }] }))
    expect(first.images).toEqual([{ url: 'https://peer.example/a.png' }])
    expect(new Date(first.cursor_ts).getTime()).toBe(BASE.getTime() + 60_000)
    const again = await a.upsertPublicTagPost(
      post(1, {
        announce_uris: ['https://tags.example/announce/other'],
        content: '<p>Edited</p>',
        tags: ['aurboda', 'running'],
      }),
    )
    expect(again.id).toBe(first.id)
    expect(again.content).toBe('<p>Edited</p>')
    expect(again.tags).toEqual(['aurboda', 'running'])
    expect([...again.announce_uris].sort()).toEqual(
      ['https://tags.example/announce/1', 'https://tags.example/announce/other'].sort(),
    )

    await a.upsertPublicTagPost(post(2, { announce_uris: [], local_user: 'alice' }))
    const kept = await a.upsertPublicTagPost(post(2, { local_user: null }))
    expect(kept.local_user).toBe('alice')
  })

  test('removing an Announce drops the post only when nothing else keeps it', async () => {
    const a = api()
    await a.upsertPublicTagPost(post(1))
    await a.upsertPublicTagPost(post(1, { announce_uris: ['https://tags.example/announce/1b'] }))
    await a.upsertPublicTagPost(post(2, { local_user: 'alice' }))

    await a.removePublicTagAnnounce('https://tags.example/announce/1')
    expect((await a.listPublicTagPosts('aurboda', 10, KEEP)).map((p) => p.note_uri)).toContain(
      'https://peer.example/notes/1',
    )
    await a.removePublicTagAnnounce('https://tags.example/announce/1b')
    await a.removePublicTagAnnounce('https://tags.example/announce/2')
    expect((await a.listPublicTagPosts('aurboda', 10, KEEP)).map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/2',
    ])
  })

  test('deletes are scoped to the author, and to the local user', async () => {
    const a = api()
    await a.upsertPublicTagPost(post(1))
    await a.upsertPublicTagPost(post(2, { announce_uris: [], local_user: 'alice' }))
    expect(await a.deletePublicTagPost('https://peer.example/notes/1', 'https://evil.example/users/x')).toBe(
      false,
    )
    expect(
      await a.deletePublicTagPost('https://peer.example/notes/1', 'https://peer.example/users/bob'),
    ).toBe(true)
    expect(await a.deleteLocalPublicTagPost('https://peer.example/notes/2', 'mallory')).toBe(false)
    expect(await a.deleteLocalPublicTagPost('https://peer.example/notes/2', 'alice')).toBe(true)
    expect(await a.listPublicTagPosts('aurboda', 10, KEEP)).toEqual([])
  })

  test('lists one tag newest first and pages on (published_at, id)', async () => {
    const a = api()
    for (const n of [1, 2, 3, 4]) await a.upsertPublicTagPost(post(n))
    await a.upsertPublicTagPost(post(5, { tags: ['running'] }))
    const page1 = await a.listPublicTagPosts('aurboda', 2, KEEP)
    expect(page1.map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/4',
      'https://peer.example/notes/3',
    ])
    const last = page1[1]
    const page2 = await a.listPublicTagPosts('aurboda', 10, {
      ...KEEP,
      before: { id: last.id, ts: last.cursor_ts },
    })
    expect(page2.map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/2',
      'https://peer.example/notes/1',
    ])
    expect((await a.listPublicTagPosts('running', 10, KEEP)).map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/5',
    ])
  })

  test('lists only posts within the retention, so lowering it takes effect at once', async () => {
    const a = api()
    await a.upsertPublicTagPost(post(1, { published_at: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) }))
    await a.upsertPublicTagPost(post(2))
    expect((await a.listPublicTagPosts('aurboda', 10, { retentionDays: 30 })).map((p) => p.note_uri)).toEqual(
      ['https://peer.example/notes/2', 'https://peer.example/notes/1'],
    )
    expect((await a.listPublicTagPosts('aurboda', 10, { retentionDays: 7 })).map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/2',
    ])
  })

  test("an actor's own Delete drops every remote post of theirs, never a local one", async () => {
    const a = api()
    await a.upsertPublicTagPost(post(1))
    await a.upsertPublicTagPost(post(2))
    await a.upsertPublicTagPost(post(3, { actor_uri: 'https://peer.example/users/carol' }))
    await a.upsertPublicTagPost(post(4, { announce_uris: [], local_user: 'bob' }))
    expect(await a.deletePublicTagPostsByActor('https://peer.example/users/bob')).toBe(2)
    expect((await a.listPublicTagPosts('aurboda', 10, KEEP)).map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/4',
      'https://peer.example/notes/3',
    ])
  })

  test('prunes by age and by the configured tags', async () => {
    const a = api()
    await a.upsertPublicTagPost(post(1, { published_at: new Date('2026-01-01T00:00:00Z') }))
    await a.upsertPublicTagPost(post(2))
    await a.upsertPublicTagPost(post(3, { tags: ['running', 'other'] }))
    expect(await a.prunePublicTagPosts(new Date('2026-06-01T00:00:00Z'))).toBe(1)
    expect(await a.prunePublicTagPostsNotTagged(['aurboda'])).toBe(1)
    expect(await a.prunePublicTagPostsNotTagged([])).toBe(1)
  })

  test('keeps the official feed’s posts past the retention, but only theirs with its tags', async () => {
    const a = api()
    const old = new Date('2026-01-01T00:00:00Z')
    await a.upsertPublicTagPost(
      post(1, { handle: '@Fiddur@aurboda.net', published_at: old, tags: ['aurbodablog'] }),
    )
    await a.upsertPublicTagPost(
      post(2, { handle: '@fiddur@aurboda.net', published_at: old, tags: ['other'] }),
    )
    await a.upsertPublicTagPost(post(3, { published_at: old, tags: ['aurbodablog'] }))
    await a.upsertPublicTagPost(post(4, { handle: null, published_at: old, tags: ['aurbodablog'] }))
    const keep = { handles: ['@fiddur@Aurboda.net'], tags: ['aurbodablog'] }
    expect(await a.prunePublicTagPosts(new Date('2026-06-01T00:00:00Z'), keep)).toBe(3)
    const rest = await a.listOfficialRemotePosts(['@fiddur@aurboda.net'], ['aurbodablog'], 10)
    expect(rest.map((p) => p.note_uri)).toEqual(['https://peer.example/notes/1'])
  })

  test('lists the official feed’s remote posts newest first by handle and tag, paging on the keyset', async () => {
    const a = api()
    const old = new Date('2026-01-01T00:00:00Z')
    await a.upsertPublicTagPost(
      post(1, { handle: '@fiddur@aurboda.net', published_at: old, tags: ['aurbodablog'] }),
    )
    await a.upsertPublicTagPost(post(2, { handle: '@Fiddur@Aurboda.net', tags: ['aurbodablog', 'qs'] }))
    await a.upsertPublicTagPost(post(3, { handle: '@fiddur@aurboda.net', tags: ['other'] }))
    await a.upsertPublicTagPost(post(4, { tags: ['aurbodablog'] }))
    await a.upsertPublicTagPost(post(5, { handle: '@alice@peer.example', tags: ['qs'] }))
    await a.upsertPublicTagPost(
      post(6, {
        announce_uris: [],
        handle: '@fiddur@aurboda.net',
        local_user: 'fiddur',
        tags: ['aurbodablog'],
      }),
    )
    const handles = ['@fiddur@aurboda.net', '@alice@peer.example']
    const all = await a.listOfficialRemotePosts(handles, ['aurbodablog', 'qs'], 10)
    expect(all.map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/5',
      'https://peer.example/notes/2',
      'https://peer.example/notes/1',
    ])
    const first = await a.listOfficialRemotePosts(handles, ['aurbodablog', 'qs'], 1)
    const next = await a.listOfficialRemotePosts(handles, ['aurbodablog', 'qs'], 10, {
      id: first[0].id,
      ts: first[0].cursor_ts,
    })
    expect(next.map((p) => p.note_uri)).toEqual([
      'https://peer.example/notes/2',
      'https://peer.example/notes/1',
    ])
    expect(await a.listOfficialRemotePosts([], ['aurbodablog'], 10)).toEqual([])
  })
})
