import type { Context, Federation } from '@fedify/fedify'

import { Follow, Hashtag, Note, Person, Undo } from '@fedify/fedify/vocab'
import { describe, expect, test, vi } from 'vitest'

import type { ServerSettings } from './central-db.ts'
import type {
  InstanceTagFollowRecord,
  PublicTagPostInput,
  PublicTagPostRecord,
} from './central-public-tags.ts'

import { INSTANCE_ACTOR_ID } from './activitypub/instance-actor.ts'
import { dateToTemporalInstant } from './activitypub/temporal-interop.ts'
import {
  applyInstanceTagFollowsAtStartup,
  applyPublicTagPages,
  createLocalPublicTagPosts,
  createPublicTagActions,
  createPublicTagInboxHooks,
  createPublicTagIngest,
  normalizePublicTagPages,
  publicTagFollowStates,
  readInstanceFollowedTags,
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
  follow_activity_id: `${ORIGIN}/actor/follows/tags/${tag}/stored`,
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
    host?: string
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
      deletePublicTagPostsByActor: vi.fn(async () => 0),
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
    tagActorHost: async () => overrides.host ?? TAG_HOST,
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

const settingsOf = (values: Partial<ServerSettings>) => ({
  getServerSetting: async <K extends keyof ServerSettings>(key: K) => values[key] ?? null,
})

describe('readInstanceFollowedTags', () => {
  test('is the public tag pages’, plus the official feed’s tags when it lists remote authors', async () => {
    const feed = { remote_authors: ['fiddur@aurboda.net'], tags: ['aurbodablog', 'running'], users: [] }
    expect(
      await readInstanceFollowedTags(
        settingsOf({ official_feed: feed, public_tag_pages: ['running', 'qs'] }),
      ),
    ).toEqual(['running', 'qs', 'aurbodablog'])
  })

  test('leaves out the official feed’s tags when it lists only local users', async () => {
    const feed = { remote_authors: [], tags: ['aurbodablog'], users: ['fiddur'] }
    expect(
      await readInstanceFollowedTags(settingsOf({ official_feed: feed, public_tag_pages: ['qs'] })),
    ).toEqual(['qs'])
  })

  test('keeps every tag of 20 pages and a 20-tag feed', async () => {
    const pages = Array.from({ length: 20 }, (_, i) => `page${i}`)
    const tags = Array.from({ length: 20 }, (_, i) => `feed${i}`)
    const feed = { remote_authors: ['bob@peer.example'], tags, users: [] }
    expect(
      await readInstanceFollowedTags(settingsOf({ official_feed: feed, public_tag_pages: pages })),
    ).toEqual([...pages, ...tags])
  })
})

describe('applyInstanceTagFollowsAtStartup', () => {
  test('applies the followed tags and says nothing when every tag actor resolved', async () => {
    const apply = vi.fn(async (tags: string[]) => ({ followed: tags, unresolved: [] }))
    const log = vi.fn()
    await applyInstanceTagFollowsAtStartup({ apply, log, readTags: async () => ['aurbodablog'] })
    expect(apply).toHaveBeenCalledWith(['aurbodablog'])
    expect(log).not.toHaveBeenCalled()
  })

  test('logs one line for unresolved tag actors, a failure or a timeout, and never throws', async () => {
    const log = vi.fn()
    await applyInstanceTagFollowsAtStartup({
      apply: async () => ({ followed: [], unresolved: ['aurbodablog'] }),
      log,
      readTags: async () => ['aurbodablog'],
    })
    await applyInstanceTagFollowsAtStartup({
      apply: async () => {
        throw new Error('fetch failed')
      },
      log,
      readTags: async () => ['aurbodablog'],
    })
    await applyInstanceTagFollowsAtStartup({
      apply: () => new Promise(() => {}),
      log,
      readTags: async () => ['aurbodablog'],
      timeoutMs: 5,
    })
    expect(log.mock.calls).toEqual([
      ['⚠️ Tag follows: could not resolve the tag actor of #aurbodablog'],
      ['⚠️ Tag follows not applied at startup: fetch failed'],
      ['⚠️ Tag follows not applied at startup: timeout'],
    ])
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

const FOLLOW_ID_RE = (tag: string) =>
  new RegExp(
    `^${ORIGIN}/actor/follows/tags/${tag}/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`,
  )

const sentOf = (sendActivity: ReturnType<typeof vi.fn>) =>
  sendActivity.mock.calls.map(([, recipient, activity]) => ({
    activity: activity as Follow | Undo,
    inbox: (recipient as { inboxId: URL }).inboxId.href,
  }))

describe('applyPublicTagPages', () => {
  test('follows the tag actor of each new tag as the instance actor, pending, under a fresh id', async () => {
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({
      lookup: (handle) => (handle === `aurboda@${TAG_HOST}` ? tagActor('aurboda') : null),
    })
    const result = await applyPublicTagPages(deps, ['#Aurboda', 'missing'])
    expect(result).toEqual({ followed: ['aurboda'], unresolved: ['missing'] })
    expect(lookupObject).toHaveBeenCalledWith(`aurboda@${TAG_HOST}`, expect.anything())
    const row = follows.get('aurboda')
    expect(row).toMatchObject({
      accepted: false,
      actor_uri: `https://${TAG_HOST}/user/aurboda`,
      inbox_uri: `https://${TAG_HOST}/user/aurboda/inbox`,
    })
    expect(row?.follow_activity_id).toMatch(FOLLOW_ID_RE('aurboda'))
    expect(follows.has('missing')).toBe(false)
    expect(sendActivity).toHaveBeenCalledTimes(1)
    const [sender, recipient, follow] = sendActivity.mock.calls[0]
    expect(sender).toEqual({ identifier: INSTANCE_ACTOR_ID })
    expect(recipient.id.href).toBe(`https://${TAG_HOST}/user/aurboda`)
    expect(follow).toBeInstanceOf(Follow)
    expect(follow.id.href).toBe(row?.follow_activity_id)
    expect(follow.actorId.href).toBe(`${ORIGIN}/actor`)
    expect(follow.objectId.href).toBe(`https://${TAG_HOST}/user/aurboda`)
  })

  test('each attempt mints a new follow id, so a tag removed and added again is followed afresh', async () => {
    const { deps, follows } = fakeDeps({ lookup: () => tagActor('aurboda') })
    await applyPublicTagPages(deps, ['aurboda'])
    const first = follows.get('aurboda')?.follow_activity_id
    await applyPublicTagPages(deps, [])
    await applyPublicTagPages(deps, ['aurboda'])
    const second = follows.get('aurboda')?.follow_activity_id
    expect(second).toMatch(FOLLOW_ID_RE('aurboda'))
    expect(second).not.toBe(first)
  })

  test('leaves accepted follows alone and unfollows removed ones by their stored follow id', async () => {
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({
      follows: [followRow('aurboda', true), followRow('running', true)],
    })
    expect(await applyPublicTagPages(deps, ['aurboda'])).toEqual({ followed: [], unresolved: [] })
    expect(lookupObject).not.toHaveBeenCalled()
    expect([...follows.keys()]).toEqual(['aurboda'])
    const [{ activity: undo, inbox }] = sentOf(sendActivity)
    expect(inbox).toBe(`https://${TAG_HOST}/user/running/inbox`)
    expect(undo).toBeInstanceOf(Undo)
    expect(undo.id?.href).toBe(`${ORIGIN}/actor/follows/tags/running/stored#undo`)
    const inner = await (undo as Undo).getObject()
    expect(inner).toBeInstanceOf(Follow)
    expect((inner as Follow).id?.href).toBe(`${ORIGIN}/actor/follows/tags/running/stored`)
  })

  test('a pending follow is sent again under a fresh id, without resolving the actor again', async () => {
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({ follows: [followRow('aurboda')] })
    expect(await applyPublicTagPages(deps, ['aurboda'])).toEqual({ followed: ['aurboda'], unresolved: [] })
    expect(lookupObject).not.toHaveBeenCalled()
    const row = follows.get('aurboda')
    expect(row?.follow_activity_id).toMatch(FOLLOW_ID_RE('aurboda'))
    const [{ activity }] = sentOf(sendActivity)
    expect(activity).toBeInstanceOf(Follow)
    expect(activity.id?.href).toBe(row?.follow_activity_id)
  })

  test('a follow on another tag actor host is undone and the tag followed anew on the current one', async () => {
    const newActor = new Person({
      id: new URL('https://tags.other/user/aurboda'),
      inbox: new URL('https://tags.other/user/aurboda/inbox'),
    })
    const { deps, follows, lookupObject, sendActivity } = fakeDeps({
      follows: [followRow('aurboda', true)],
      host: 'tags.other',
      lookup: (handle) => (handle === 'aurboda@tags.other' ? newActor : null),
    })
    expect(await applyPublicTagPages(deps, ['aurboda'])).toEqual({ followed: ['aurboda'], unresolved: [] })
    expect(lookupObject).toHaveBeenCalledWith('aurboda@tags.other', expect.anything())
    expect(follows.get('aurboda')).toMatchObject({
      accepted: false,
      actor_uri: 'https://tags.other/user/aurboda',
    })
    const sent = sentOf(sendActivity)
    expect(sent.map(({ activity, inbox }) => [activity.constructor.name, inbox])).toEqual([
      ['Undo', `https://${TAG_HOST}/user/aurboda/inbox`],
      ['Follow', 'https://tags.other/user/aurboda/inbox'],
    ])
  })

  test('new tags are resolved concurrently', async () => {
    let inFlight = 0
    let peak = 0
    const { deps } = fakeDeps({
      lookup: async () => {
        inFlight++
        peak = Math.max(peak, inFlight)
        await new Promise((resolve) => setTimeout(resolve, 5))
        inFlight--
        return null
      },
    })
    expect((await applyPublicTagPages(deps, ['a1', 'b2', 'c3'])).unresolved).toEqual(['a1', 'b2', 'c3'])
    expect(peak).toBe(3)
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

describe('publicTagFollowStates', () => {
  test('accepted, pending, or unresolved when the tag has no follow row', () => {
    expect(
      publicTagFollowStates(['aurboda', 'running', 'qs'], [followRow('aurboda', true), followRow('running')]),
    ).toEqual([
      { state: 'accepted', tag: 'aurboda' },
      { state: 'pending', tag: 'running' },
      { state: 'unresolved', tag: 'qs' },
    ])
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

  test('pages newest first with a keyset cursor, within the retention', async () => {
    const rows = Array.from({ length: PUBLIC_TAG_PAGE_SIZE + 1 }, (_, i) => record((i % 9) + 1))
    const { deps, listPublicTagPosts } = fakeDeps({ pages: ['aurboda'], posts: rows })
    const result = await createPublicTagActions(deps).page('#Aurboda')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.page.tag).toBe('aurboda')
    expect(result.page.retention_days).toBe(14)
    expect(result.page.posts).toHaveLength(PUBLIC_TAG_PAGE_SIZE)
    expect(result.page.next_cursor).not.toBeNull()
    expect(listPublicTagPosts).toHaveBeenCalledWith('aurboda', PUBLIC_TAG_PAGE_SIZE + 1, {
      before: undefined,
      retentionDays: 14,
    })

    await createPublicTagActions(deps).page('aurboda', result.page.next_cursor ?? undefined)
    const last = rows[PUBLIC_TAG_PAGE_SIZE - 1]
    expect(listPublicTagPosts).toHaveBeenLastCalledWith('aurboda', PUBLIC_TAG_PAGE_SIZE + 1, {
      before: { id: last.id, ts: last.cursor_ts },
      retentionDays: 14,
    })
    await createPublicTagActions(deps).latest('aurboda', 5)
    expect(listPublicTagPosts).toHaveBeenLastCalledWith('aurboda', 5, { retentionDays: 14 })
  })

  test('the last page has no cursor', async () => {
    const { deps } = fakeDeps({ pages: ['aurboda'], posts: [record(1)] })
    const result = await createPublicTagActions(deps).page('aurboda')
    expect(result.ok && result.page.next_cursor).toBeNull()
  })
})

describe('createPublicTagInboxHooks', () => {
  const FOLLOW_ID = `${ORIGIN}/actor/follows/tags/aurboda/stored`
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
      deletePublicTagPostsByActor: vi.fn(async () => 0),
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

  test('removes a post whose edit dropped the configured tag, and removes by author', async () => {
    const { ctx, deleteLocalPublicTagPost, posts, upsertPublicTagPost } = setup()
    await posts.record('alice', note(['running']), ctx)
    expect(upsertPublicTagPost).not.toHaveBeenCalled()
    expect(deleteLocalPublicTagPost).toHaveBeenCalledWith(
      `${ORIGIN}/users/alice/feed/11111111-1111-4111-8111-111111111111`,
      'alice',
    )
    await posts.remove('alice', 'https://aurboda.example/users/alice/feed/x')
    expect(deleteLocalPublicTagPost).toHaveBeenCalledWith(
      'https://aurboda.example/users/alice/feed/x',
      'alice',
    )
  })
})
