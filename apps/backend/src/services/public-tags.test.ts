import type { Context, Federation } from '@fedify/fedify'

import { Follow, Hashtag, Note, Person, Undo } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type {
  InstanceTagFollowRecord,
  PublicTagPostInput,
  PublicTagPostRecord,
} from './central-public-tags.ts'

import { INSTANCE_ACTOR_ID } from './activitypub/instance-actor.ts'
import { dateToTemporalInstant } from './activitypub/temporal-interop.ts'
import {
  applyPublicTagPages,
  createLocalPublicTagPosts,
  createPublicTagActions,
  createPublicTagInboxHooks,
  createPublicTagIngest,
  normalizePublicTagPages,
  PUBLIC_TAG_PAGE_SIZE,
  type PublicTagActionsDeps,
  serializePublicTagPost,
} from './public-tags.ts'

const ORIGIN = 'https://aurboda.example'
const TAG_HOST = 'tags.example'

const tagActor = (tag: string) =>
  new Person({
    id: new URL(`https://${TAG_HOST}/user/${tag}`),
    inbox: new URL(`https://${TAG_HOST}/user/${tag}/inbox`),
    preferredUsername: tag,
  })

const followRow = (tag: string, accepted = false): InstanceTagFollowRecord => ({
  accepted,
  actor_uri: `https://${TAG_HOST}/user/${tag}`,
  created_at: new Date(),
  follow_activity_id: `${ORIGIN}/actor/follows/tags/${tag}`,
  inbox_uri: `https://${TAG_HOST}/user/${tag}/inbox`,
  tag,
  updated_at: new Date(),
})

const record = (n: number, overrides: Partial<PublicTagPostRecord> = {}): PublicTagPostRecord => ({
  actor_uri: 'https://peer.example/users/bob',
  announce_uris: [],
  avatar_url: null,
  content: `<p>${n}</p>`,
  created_at: new Date('2026-11-02T00:00:00Z'),
  cursor_ts: `2026-11-01 00:00:0${n}+00`,
  display_name: 'Bob',
  handle: '@bob@peer.example',
  id: `0000000${n}-0000-4000-8000-000000000000`,
  images: [],
  local_user: null,
  note_uri: `https://peer.example/notes/${n}`,
  published_at: new Date(`2026-11-01T00:00:0${n}Z`),
  tags: ['aurboda'],
  updated_at: new Date(),
  url: null,
  ...overrides,
})

const fakeDeps = (
  overrides: {
    follows?: InstanceTagFollowRecord[]
    lookup?: (handle: string) => unknown
    pages?: string[]
    posts?: PublicTagPostRecord[]
    sendActivity?: ReturnType<typeof vi.fn>
  } = {},
) => {
  const follows = new Map((overrides.follows ?? []).map((row) => [row.tag, row]))
  const sendActivity = overrides.sendActivity ?? vi.fn(async () => {})
  const lookupObject = vi.fn(async (handle: string) => (overrides.lookup ?? (() => null))(handle))
  const ctx = {
    getActorUri: (id: string) =>
      new URL(id === INSTANCE_ACTOR_ID ? `${ORIGIN}/actor` : `${ORIGIN}/users/${id}`),
    getDocumentLoader: async () => async () => ({}),
    lookupObject,
    sendActivity,
  }
  const listPublicTagPosts = vi.fn(async () => overrides.posts ?? [])
  const deps: PublicTagActionsDeps = {
    federation: { createContext: () => ctx } as unknown as Federation<void>,
    origin: ORIGIN,
    store: {
      deleteInstanceTagFollow: vi.fn(async (tag: string) => follows.delete(tag)),
      deleteLocalPublicTagPost: vi.fn(async () => true),
      deletePublicTagPost: vi.fn(async () => true),
      getInstanceTagFollowByActor: vi.fn(async () => null),
      getInstanceTagFollowByFollowId: vi.fn(async () => null),
      getServerSetting: vi.fn(async (key: string) => {
        if (key === 'public_tag_pages') return overrides.pages ?? []
        if (key === 'public_tag_retention_days') return 14
        return null
      }) as unknown as PublicTagActionsDeps['store']['getServerSetting'],
      listInstanceTagFollows: vi.fn(async () => [...follows.values()]),
      listPublicTagPosts,
      removePublicTagAnnounce: vi.fn(async () => {}),
      setInstanceTagFollowAccepted: vi.fn(async () => null),
      upsertInstanceTagFollow: vi.fn(async (input) => {
        const row = { ...followRow(input.tag), ...input }
        follows.set(input.tag, row)
        return row
      }),
      upsertPublicTagPost: vi.fn(async () => record(1)),
    },
    tagActorHost: async () => TAG_HOST,
  }
  return { ctx, deps, follows, listPublicTagPosts, lookupObject, sendActivity }
}

describe('normalizePublicTagPages', () => {
  test('stores lowercase tags without #, deduplicated, invalid ones dropped, capped at 20', () => {
    expect(normalizePublicTagPages(['#Aurboda', 'aurboda', 'not a tag', 'Running'])).toEqual([
      'aurboda',
      'running',
    ])
    expect(normalizePublicTagPages(Array.from({ length: 30 }, (_, i) => `t${i}`))).toHaveLength(20)
  })
})

describe('serializePublicTagPost', () => {
  test('maps a stored post to a timeline entry', () => {
    const entry = serializePublicTagPost(record(1, { images: [{ url: 'https://peer.example/a.png' }] }))
    expect(entry).toEqual({
      actor_uri: 'https://peer.example/users/bob',
      avatar_url: null,
      content: '<p>1</p>',
      display_name: 'Bob',
      handle: '@bob@peer.example',
      id: '00000001-0000-4000-8000-000000000000',
      images: [{ url: 'https://peer.example/a.png' }],
      object_uri: 'https://peer.example/notes/1',
      published_at: '2026-11-01T00:00:01.000Z',
      received_at: '2026-11-02T00:00:00.000Z',
      tags: ['aurboda'],
      url: null,
    })
    expect(serializePublicTagPost(record(2))).not.toHaveProperty('images')
  })
})

describe('applyPublicTagPages', () => {
  test('follows the tag actor of each new tag as the instance actor, pending', async () => {
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({
      lookup: (handle) => (handle === `aurboda@${TAG_HOST}` ? tagActor('aurboda') : null),
    })
    const result = await applyPublicTagPages(deps, ['#Aurboda', 'missing'])
    expect(result).toEqual({ followed: ['aurboda'], unresolved: ['missing'] })
    expect(lookupObject).toHaveBeenCalledWith(`aurboda@${TAG_HOST}`, expect.anything())
    expect(follows.get('aurboda')).toMatchObject({
      accepted: false,
      actor_uri: `https://${TAG_HOST}/user/aurboda`,
      follow_activity_id: `${ORIGIN}/actor/follows/tags/aurboda`,
      inbox_uri: `https://${TAG_HOST}/user/aurboda/inbox`,
    })
    expect(follows.has('missing')).toBe(false)
    expect(sendActivity).toHaveBeenCalledTimes(1)
    const [sender, recipient, follow] = sendActivity.mock.calls[0]
    expect(sender).toEqual({ identifier: INSTANCE_ACTOR_ID })
    expect(recipient.id.href).toBe(`https://${TAG_HOST}/user/aurboda`)
    expect(follow).toBeInstanceOf(Follow)
    expect(follow.id.href).toBe(`${ORIGIN}/actor/follows/tags/aurboda`)
    expect(follow.actorId.href).toBe(`${ORIGIN}/actor`)
    expect(follow.objectId.href).toBe(`https://${TAG_HOST}/user/aurboda`)
  })

  test('leaves followed tags alone and unfollows removed ones', async () => {
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({
      follows: [followRow('aurboda', true), followRow('running', true)],
    })
    expect(await applyPublicTagPages(deps, ['aurboda'])).toEqual({ followed: [], unresolved: [] })
    expect(lookupObject).not.toHaveBeenCalled()
    expect([...follows.keys()]).toEqual(['aurboda'])
    const [, recipient, undo] = sendActivity.mock.calls[0]
    expect(recipient.inboxId.href).toBe(`https://${TAG_HOST}/user/running/inbox`)
    expect(undo).toBeInstanceOf(Undo)
    const inner = await (undo as Undo).getObject()
    expect(inner).toBeInstanceOf(Follow)
    expect((inner as Follow).id?.href).toBe(`${ORIGIN}/actor/follows/tags/running`)
  })

  test('a failed delivery keeps the follow row, and a failed Undo still drops it', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const sendActivity = vi.fn(async () => {
      throw new Error('down')
    })
    const { deps, follows } = fakeDeps({
      follows: [followRow('running')],
      lookup: () => tagActor('aurboda'),
      sendActivity,
    })
    expect(await applyPublicTagPages(deps, ['aurboda'])).toEqual({ followed: ['aurboda'], unresolved: [] })
    expect([...follows.keys()]).toEqual(['aurboda'])
    error.mockRestore()
  })
})

describe('public tag page listing', () => {
  test('a tag without a page is not found', async () => {
    const { deps } = fakeDeps({ pages: ['aurboda'] })
    const actions = createPublicTagActions(deps)
    expect(await actions.page('running')).toEqual({ ok: false })
    expect(await actions.page('not a tag')).toEqual({ ok: false })
    expect(await actions.latest('running', 5)).toBeNull()
  })

  test('pages newest first with a keyset cursor and the retention', async () => {
    const rows = Array.from({ length: PUBLIC_TAG_PAGE_SIZE + 1 }, (_, i) => record((i % 9) + 1))
    const { deps, listPublicTagPosts } = fakeDeps({ pages: ['aurboda'], posts: rows })
    const result = await createPublicTagActions(deps).page('#Aurboda')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.tag).toBe('aurboda')
    expect(result.page.retention_days).toBe(14)
    expect(result.page.posts).toHaveLength(PUBLIC_TAG_PAGE_SIZE)
    expect(result.page.next_cursor).not.toBeNull()
    expect(listPublicTagPosts).toHaveBeenCalledWith('aurboda', PUBLIC_TAG_PAGE_SIZE + 1, undefined)

    await createPublicTagActions(deps).page('aurboda', result.page.next_cursor ?? undefined)
    const last = rows[PUBLIC_TAG_PAGE_SIZE - 1]
    expect(listPublicTagPosts).toHaveBeenLastCalledWith('aurboda', PUBLIC_TAG_PAGE_SIZE + 1, {
      id: last.id,
      ts: last.cursor_ts,
    })
  })

  test('the last page has no cursor', async () => {
    const { deps } = fakeDeps({ pages: ['aurboda'], posts: [record(1)] })
    const result = await createPublicTagActions(deps).page('aurboda')
    expect(result.ok && result.page.next_cursor).toBeNull()
  })
})

describe('createPublicTagInboxHooks', () => {
  const FOLLOW_ID = `${ORIGIN}/actor/follows/tags/aurboda`
  const ACTOR = `https://${TAG_HOST}/user/aurboda`
  const store = () => ({
    deleteInstanceTagFollow: vi.fn(async () => true),
    getInstanceTagFollowByFollowId: vi.fn(async (id: string) =>
      id === FOLLOW_ID ? followRow('aurboda') : null,
    ),
    setInstanceTagFollowAccepted: vi.fn(async () => null),
  })

  test('the tag actor accepting marks the follow accepted', async () => {
    const s = store()
    expect(await createPublicTagInboxHooks(s).onAccept(FOLLOW_ID, ACTOR)).toBe(true)
    expect(s.setInstanceTagFollowAccepted).toHaveBeenCalledWith(FOLLOW_ID, true)
  })

  test("a stranger's Accept or Reject of our follow changes nothing, but is still ours", async () => {
    const s = store()
    const hooks = createPublicTagInboxHooks(s)
    expect(await hooks.onAccept(FOLLOW_ID, 'https://evil.example/users/eve')).toBe(true)
    expect(await hooks.onReject(FOLLOW_ID, null)).toBe(true)
    expect(s.setInstanceTagFollowAccepted).not.toHaveBeenCalled()
    expect(s.deleteInstanceTagFollow).not.toHaveBeenCalled()
  })

  test('a Reject by the tag actor drops the follow; an unknown follow id is not ours', async () => {
    const s = store()
    const hooks = createPublicTagInboxHooks(s)
    expect(await hooks.onReject(FOLLOW_ID, ACTOR)).toBe(true)
    expect(s.deleteInstanceTagFollow).toHaveBeenCalledWith('aurboda')
    expect(await hooks.onAccept(`${ORIGIN}/users/alice/follows/x`, ACTOR)).toBe(false)
  })
})

describe('createPublicTagIngest', () => {
  test('only an accepted tag follow counts as a followed tag actor', async () => {
    const rows = new Map([
      ['https://tags.example/user/aurboda', followRow('aurboda', true)],
      ['https://tags.example/user/running', followRow('running', false)],
    ])
    const ingest = createPublicTagIngest({
      deletePublicTagPost: vi.fn(async () => true),
      getInstanceTagFollowByActor: async (uri) => rows.get(uri) ?? null,
      removePublicTagAnnounce: vi.fn(async () => {}),
      upsertPublicTagPost: vi.fn(async () => record(1)),
    })
    expect(await ingest.followedTagActor('https://tags.example/user/aurboda')).toEqual({
      actor_uri: 'https://tags.example/user/aurboda',
      tag: 'aurboda',
    })
    expect(await ingest.followedTagActor('https://tags.example/user/running')).toBeNull()
    expect(await ingest.followedTagActor('https://tags.example/user/other')).toBeNull()
  })
})

describe('createLocalPublicTagPosts', () => {
  const note = (tags: string[]) =>
    new Note({
      content: '<p>Ran <script>x</script>far</p>',
      id: new URL(`${ORIGIN}/users/alice/feed/11111111-1111-4111-8111-111111111111`),
      published: dateToTemporalInstant(new Date('2026-11-01T10:00:00Z')),
      tags: tags.map((name) => new Hashtag({ href: new URL(`${ORIGIN}/tags/${name}`), name: `#${name}` })),
      url: new URL(`${ORIGIN}/u/alice/posts/11111111-1111-4111-8111-111111111111`),
    })

  const setup = () => {
    const upsertPublicTagPost = vi.fn(async (_input: PublicTagPostInput) => record(1))
    const deleteLocalPublicTagPost = vi.fn(async () => true)
    const posts = createLocalPublicTagPosts({
      localActor: async () =>
        new Person({ id: new URL(`${ORIGIN}/users/alice`), name: 'Alice', preferredUsername: 'alice' }),
      publicTagPages: async () => ['aurboda'],
      store: { deleteLocalPublicTagPost, upsertPublicTagPost },
    })
    const ctx = {
      getActorUri: (user: string) => new URL(`${ORIGIN}/users/${user}`),
    } as unknown as Context<void>
    return { ctx, deleteLocalPublicTagPost, posts, upsertPublicTagPost }
  }

  test('records a post carrying a configured tag, as its local author', async () => {
    const { ctx, posts, upsertPublicTagPost } = setup()
    await posts.record('alice', note(['Aurboda', 'running']), ctx)
    expect(upsertPublicTagPost).toHaveBeenCalledWith({
      actor_uri: `${ORIGIN}/users/alice`,
      announce_uris: [],
      avatar_url: null,
      content: '<p>Ran far</p>',
      display_name: 'Alice',
      handle: '@alice@aurboda.example',
      images: [],
      local_user: 'alice',
      note_uri: `${ORIGIN}/users/alice/feed/11111111-1111-4111-8111-111111111111`,
      published_at: new Date('2026-11-01T10:00:00Z'),
      tags: ['aurboda', 'running'],
      url: `${ORIGIN}/u/alice/posts/11111111-1111-4111-8111-111111111111`,
    })
  })

  test('ignores a post without a configured tag, and removes by author', async () => {
    const { ctx, deleteLocalPublicTagPost, posts, upsertPublicTagPost } = setup()
    await posts.record('alice', note(['running']), ctx)
    expect(upsertPublicTagPost).not.toHaveBeenCalled()
    await posts.remove('alice', 'https://aurboda.example/users/alice/feed/x')
    expect(deleteLocalPublicTagPost).toHaveBeenCalledWith(
      'https://aurboda.example/users/alice/feed/x',
      'alice',
    )
  })
})
