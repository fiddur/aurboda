import { Note } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeRecord,
  ChallengeThreadEntryInput,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  TimelineEntryRecord,
} from '../db/index.ts'
import type { RaiseNotificationInput } from './notifications.ts'

import { AS_PUBLIC } from './activitypub/object.ts'
import { dateToTemporalInstant } from './activitypub/temporal-interop.ts'
import {
  admitInboundThreadNote,
  INBOUND_NON_MEMBER_DAILY_LIMIT,
  type InboundThreadDeps,
  parseLocalPostUri,
  removeInboundThreadEntry,
  resolveInboundThread,
} from './challenge-thread-inbound.ts'

const WEB = 'https://aurboda.test'
const CHALLENGE_URI = `${WEB}/users/alice/challenges/abc`
const ALICE = `${WEB}/users/alice`
const BOB = `${WEB}/users/bob`
const CAROL = 'https://remote.example/users/carol'
const POST_ID = '11111111-1111-4111-8111-111111111111'
const BOB_POST = `${BOB}/feed/${POST_ID}`
const CAROL_NOTE = 'https://remote.example/notes/1'
const NOW = Date.parse('2026-11-10T12:00:00Z')

const challenge = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-12-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'Push-ups',
  result_published_at: null,
  slug: 'abc',
  spec: {
    activity_type_id: null,
    aggregation: 'sum',
    bucket_size: 'auto',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern: 'steps',
    source_type: 'metric',
    unit: 'steps',
  },
  start_ts: new Date('2026-10-01T00:00:00Z'),
  timezone: 'UTC',
  updated_at: new Date('2026-10-01T00:00:00Z'),
  ...over,
})

const member = (over: Partial<ChallengeMemberRecord>): ChallengeMemberRecord => ({
  actor: null,
  actor_verified_at: null,
  cached_buckets: null,
  cached_total: null,
  challenge_id: 'c1',
  data_endpoint_url: null,
  data_last_updated: null,
  display_name: 'm',
  id: 'm1',
  identity_base_url: `${WEB}/u/bob`,
  joined_at: new Date('2026-10-02T00:00:00Z'),
  kind: 'local',
  last_error: null,
  last_fetched_at: null,
  local_user: 'bob',
  status: 'active',
  ...over,
})

const REMOTE_CAROL = member({
  actor: CAROL,
  id: 'm2',
  identity_base_url: 'https://remote.example/u/carol',
  kind: 'remote',
  local_user: null,
})

const storedEntry = (input: ChallengeThreadEntryInput, id: string): ChallengeThreadEntryRecord => ({
  ...input,
  created_at: new Date(NOW),
  hidden_at: null,
  id,
})

const entryInput = (objectUri: string, actorUri: string): ChallengeThreadEntryInput => ({
  actor_uri: actorUri,
  audience: 'public',
  avatar_url: null,
  challenge_id: 'c1',
  content: '<p>hi</p>',
  display_name: null,
  edited_at: null,
  handle: null,
  images: [],
  in_reply_to_uri: CHALLENGE_URI,
  kind: 'comment',
  object_uri: objectUri,
  published_at: new Date('2026-11-01T00:00:00Z'),
  root_entry_id: null,
  url: null,
})

interface World {
  challenges?: Record<string, ChallengeRecord>
  members?: ChallengeMemberRecord[]
  posts?: Record<string, Partial<FeedPostRecord>>
  entries?: Record<string, ChallengeThreadEntryRecord>
  timeline?: Record<string, Partial<TimelineEntryRecord>>
  recent?: number
}

const fakeDeps = (world: World = {}) => {
  const challenges = world.challenges ?? { 'alice/abc': challenge() }
  const entries = new Map(Object.entries(world.entries ?? {}))
  const notified: { user: string; input: RaiseNotificationInput }[] = []
  const deleted: string[] = []
  const signals: string[][] = []
  let presented = 0
  const deps: InboundThreadDeps = {
    countByActorSince: async () => world.recent ?? 0,
    countEntries: async () => entries.size,
    deleteEntriesByActor: async (host, actorUri) => {
      deleted.push(`${host}:*${actorUri}`)
    },
    deleteEntry: async (host, objectUri, actorUri) => {
      deleted.push(`${host}:${objectUri}:${actorUri}`)
    },
    getChallengeById: async (user, id) =>
      Object.entries(challenges).find(([key, c]) => key.startsWith(`${user}/`) && c.id === id)?.[1] ?? null,
    getEntryByObjectUri: async (host, objectUri) => entries.get(`${host}:${objectUri}`) ?? null,
    getFeedPost: async (user, postId) =>
      (world.posts?.[`${user}/${postId}`] as FeedPostRecord | undefined) ?? null,
    getTimelineEntry: async (user, objectUri) =>
      (world.timeline?.[`${user}:${objectUri}`] as TimelineEntryRecord | undefined) ?? null,
    listMembers: async () => world.members ?? [member({ local_user: 'bob' })],
    loadChallenge: async (host, slug) => challenges[`${host}/${slug}`] ?? null,
    notify: async (user, input) => {
      notified.push({ input, user })
    },
    now: () => NOW,
    signal: (host, kind, object, target, recipients) => {
      signals.push([host, kind, object, target, ...recipients])
    },
    upsert: async (host, input) => {
      const key = `${host}:${input.object_uri}`
      const existing = entries.get(key)
      if (existing != null && existing.actor_uri !== input.actor_uri) return null
      const entry = storedEntry(input, existing?.id ?? `e${entries.size + 1}`)
      entries.set(key, entry)
      return { entry, inserted: existing == null }
    },
    webHost: WEB,
  }
  return {
    deleted,
    deps,
    entries,
    notified,
    presentation: async () => {
      presented++
      return { avatar_url: null, display_name: 'Carol', handle: '@carol@remote.example' }
    },
    presentedCount: () => presented,
    signals,
  }
}

const note = (
  over: {
    id?: string | null
    actor?: string
    attribution?: string | null
    target?: string | null
    public?: boolean
    context?: string
    published?: Date | null
    updated?: Date
    content?: string
  } = {},
): Note => {
  const actor = over.actor ?? CAROL
  const attribution = over.attribution === undefined ? actor : over.attribution
  const target = over.target === undefined ? CHALLENGE_URI : over.target
  const id = over.id === undefined ? CAROL_NOTE : over.id
  const published = over.published === undefined ? new Date('2026-11-10T10:00:00Z') : over.published
  return new Note({
    ...(attribution == null ? {} : { attribution: new URL(attribution) }),
    ccs: over.public === false ? [] : [new URL(AS_PUBLIC)],
    content: over.content ?? '<p>Go <script>x</script>team</p>',
    ...(over.context == null ? {} : { contexts: [new URL(over.context)] }),
    ...(id == null ? {} : { id: new URL(id) }),
    ...(published == null ? {} : { published: dateToTemporalInstant(published) }),
    ...(target == null ? {} : { replyTarget: new URL(target) }),
    tos: [new URL(`${actor}/followers`)],
    ...(over.updated == null ? {} : { updated: dateToTemporalInstant(over.updated) }),
  })
}

const admit = (
  fake: ReturnType<typeof fakeDeps>,
  n: Note,
  opts: { me?: string; actor?: string; presentation?: () => Promise<null> } = {},
) =>
  admitInboundThreadNote(fake.deps, {
    actor_uri: opts.actor ?? CAROL,
    me: opts.me ?? 'alice',
    note: n,
    origin: WEB,
    presentation: opts.presentation ?? fake.presentation,
  })

describe('parseLocalPostUri', () => {
  test('reads a local post id, and nothing else', () => {
    expect(parseLocalPostUri(WEB, BOB_POST)).toEqual({ post_id: POST_ID, user: 'bob' })
    expect(parseLocalPostUri(`${WEB}/`, BOB_POST)).toEqual({ post_id: POST_ID, user: 'bob' })
    expect(parseLocalPostUri(WEB, `${BOB}/feed/not-a-uuid`)).toBeNull()
    expect(parseLocalPostUri(WEB, `${BOB}/feed/${POST_ID}/x`)).toBeNull()
    expect(parseLocalPostUri(WEB, CHALLENGE_URI)).toBeNull()
    expect(parseLocalPostUri(WEB, `https://other.example/users/bob/feed/${POST_ID}`)).toBeNull()
    expect(parseLocalPostUri(WEB, `${WEB}/users/%E0%A4%A/feed/${POST_ID}`)).toBeNull()
  })
})

describe('resolveInboundThread', () => {
  test('the challenge object itself, whoever receives it', async () => {
    const { deps } = fakeDeps()
    const thread = await resolveInboundThread(deps, WEB, 'bob', CHALLENGE_URI)
    expect(thread).toMatchObject({ host: 'alice', in_reply_to_uri: CHALLENGE_URI })
    expect(thread?.challenge.id).toBe('c1')
  })

  test('an unknown challenge is no thread', async () => {
    const { deps } = fakeDeps()
    expect(await resolveInboundThread(deps, WEB, 'alice', `${ALICE}/challenges/gone`)).toBeNull()
  })

  test('a local post that is an entry of the thread is answered as that entry', async () => {
    const { deps } = fakeDeps({
      entries: { [`alice:${BOB_POST}`]: storedEntry(entryInput(BOB_POST, BOB), 'e1') },
      posts: { [`bob/${POST_ID}`]: { challenge_uri: CHALLENGE_URI, id: POST_ID } },
    })
    expect(await resolveInboundThread(deps, WEB, 'bob', BOB_POST)).toMatchObject({
      host: 'alice',
      in_reply_to_uri: BOB_POST,
    })
  })

  test('a local post of the thread that is no entry (a share without a note) is answered top level', async () => {
    const { deps } = fakeDeps({
      posts: { [`bob/${POST_ID}`]: { challenge_uri: CHALLENGE_URI, id: POST_ID } },
    })
    expect(await resolveInboundThread(deps, WEB, 'bob', BOB_POST)).toMatchObject({
      host: 'alice',
      in_reply_to_uri: CHALLENGE_URI,
    })
  })

  test('a local post outside any thread is no thread', async () => {
    const { deps } = fakeDeps({ posts: { [`bob/${POST_ID}`]: { challenge_uri: null, id: POST_ID } } })
    expect(await resolveInboundThread(deps, WEB, 'bob', BOB_POST)).toBeNull()
  })

  test('an entry of a thread the recipient hosts', async () => {
    const reply = 'https://remote.example/notes/0'
    const { deps } = fakeDeps({
      entries: { [`alice:${reply}`]: storedEntry(entryInput(reply, CAROL), 'e1') },
    })
    expect(await resolveInboundThread(deps, WEB, 'alice', reply)).toMatchObject({
      host: 'alice',
      in_reply_to_uri: reply,
    })
    expect(await resolveInboundThread(deps, WEB, 'bob', reply)).toBeNull()
  })

  test('a missing database is no thread', async () => {
    const missing = Object.assign(new Error('no db'), { code: '3D000' })
    const { deps } = fakeDeps()
    deps.getFeedPost = async () => {
      throw missing
    }
    deps.getEntryByObjectUri = async () => {
      throw missing
    }
    expect(await resolveInboundThread(deps, WEB, 'zed', BOB_POST)).toBeNull()
    expect(await resolveInboundThread(deps, WEB, 'zed', 'https://remote.example/x')).toBeNull()
  })
})

describe('admitInboundThreadNote', () => {
  test('admits a public reply to the challenge, sanitised, and notifies the host and members', async () => {
    const fake = fakeDeps()
    const result = await admit(fake, note())
    expect(result).toEqual({ challenge_id: 'c1', host: 'alice', quiet: true })
    const entry = fake.entries.get(`alice:${CAROL_NOTE}`)
    expect(entry).toMatchObject({
      actor_uri: CAROL,
      audience: 'public',
      content: '<p>Go team</p>',
      display_name: 'Carol',
      edited_at: null,
      in_reply_to_uri: CHALLENGE_URI,
      kind: 'comment',
      url: CAROL_NOTE,
    })
    expect(fake.notified.map((n) => n.user).sort()).toEqual(['alice', 'bob'])
  })

  test('an entry from the fediverse is signalled (Add) to the verified members on other servers', async () => {
    const OLA = 'https://home.example/users/ola'
    const verifiedOla = member({
      actor: OLA,
      actor_verified_at: new Date(),
      id: 'm3',
      kind: 'remote',
      local_user: null,
    })
    const fake = fakeDeps({ members: [member({ local_user: 'bob' }), verifiedOla] })
    await admit(fake, note())
    expect(fake.signals).toEqual([['alice', 'add', CAROL_NOTE, CHALLENGE_URI, OLA]])
  })

  test('an Update of an entry the thread already holds sends no second Add', async () => {
    const OLA = 'https://home.example/users/ola'
    const verifiedOla = member({
      actor: OLA,
      actor_verified_at: new Date(),
      id: 'm3',
      kind: 'remote',
      local_user: null,
    })
    const fake = fakeDeps({ members: [member({ local_user: 'bob' }), verifiedOla] })
    await admit(fake, note())
    await admit(fake, note({ content: '<p>edited</p>', updated: new Date('2026-11-10T11:00:00Z') }))
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)?.content).toBe('<p>edited</p>')
    expect(fake.signals).toEqual([['alice', 'add', CAROL_NOTE, CHALLENGE_URI, OLA]])
  })

  test('a comment a verified member pushed is not signalled, nor is a refused Note', async () => {
    const OLA = 'https://home.example/users/ola'
    const verified = (actor: string, id: string) =>
      member({ actor, actor_verified_at: new Date(), id, kind: 'remote', local_user: null })
    const fake = fakeDeps({ members: [verified(CAROL, 'm2'), verified(OLA, 'm3')] })
    await admit(fake, note())
    expect(fake.entries.size).toBe(1)
    await admit(fake, note({ attribution: 'https://remote.example/users/dave' }))
    expect(fake.signals).toEqual([])
  })

  test('a Note without id or published, or without a reply target, is none', async () => {
    const fake = fakeDeps()
    expect(await admit(fake, note({ id: null }))).toBeNull()
    expect(await admit(fake, note({ published: null }))).toBeNull()
    expect(await admit(fake, note({ target: null }))).toBeNull()
    expect(fake.entries.size).toBe(0)
  })

  test('a Note answering no thread is none', async () => {
    const fake = fakeDeps()
    expect(await admit(fake, note({ target: 'https://remote.example/notes/9' }))).toBeNull()
  })

  test('authority: the Note on the sender host and attributed to the sender', async () => {
    const fake = fakeDeps()
    expect(await admit(fake, note({ id: 'https://elsewhere.example/notes/1' }))).toBeNull()
    expect(await admit(fake, note({ attribution: null }))).toBeNull()
    expect(await admit(fake, note({ attribution: 'https://remote.example/users/dave' }))).toBeNull()
    expect(fake.entries.size).toBe(0)
    expect(fake.presentedCount()).toBe(0)
  })

  test('a Note of this instance already in the thread is left alone and still quiet', async () => {
    const original = storedEntry(entryInput(BOB_POST, BOB), 'e1')
    const fake = fakeDeps({ entries: { [`alice:${BOB_POST}`]: original } })
    const result = await admit(fake, note({ actor: BOB, content: '<p>@alice hi</p>', id: BOB_POST }), {
      actor: BOB,
    })
    expect(result).toEqual({ challenge_id: 'c1', host: 'alice', quiet: true })
    expect(fake.entries.get(`alice:${BOB_POST}`)).toBe(original)
    expect(fake.presentedCount()).toBe(0)
  })

  test('a Note of this instance not yet in the thread is admitted', async () => {
    const fake = fakeDeps()
    const result = await admit(fake, note({ actor: BOB, id: BOB_POST }), { actor: BOB })
    expect(result).toEqual({ challenge_id: 'c1', host: 'alice', quiet: true })
    expect(fake.entries.get(`alice:${BOB_POST}`)?.actor_uri).toBe(BOB)
  })

  test('a non-public Note needs the challenge as its context', async () => {
    const fake = fakeDeps({ members: [REMOTE_CAROL] })
    expect(await admit(fake, note({ public: false }))).toBeNull()
    const result = await admit(fake, note({ context: CHALLENGE_URI, public: false }))
    expect(result).not.toBeNull()
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)?.audience).toBe('participants')
  })

  test('a participants Note from a non-participant is refused', async () => {
    const fake = fakeDeps()
    expect(await admit(fake, note({ context: CHALLENGE_URI, public: false }))).toBeNull()
    expect(fake.entries.size).toBe(0)
  })

  test('an unlisted challenge takes nothing from a non-member, public or not', async () => {
    const fake = fakeDeps({ challenges: { 'alice/abc': challenge({ is_public: false }) } })
    expect(await admit(fake, note())).toBeNull()
    const asMember = fakeDeps({
      challenges: { 'alice/abc': challenge({ is_public: false }) },
      members: [REMOTE_CAROL],
    })
    expect(await admit(asMember, note())).not.toBeNull()
    expect(asMember.entries.get(`alice:${CAROL_NOTE}`)?.audience).toBe('participants')
  })

  test('a non-participant at the daily limit is refused, a member is not counted', async () => {
    const limited = fakeDeps({ recent: INBOUND_NON_MEMBER_DAILY_LIMIT })
    expect(await admit(limited, note())).toBeNull()
    const below = fakeDeps({ recent: INBOUND_NON_MEMBER_DAILY_LIMIT - 1 })
    expect(await admit(below, note())).not.toBeNull()
    const memberAtLimit = fakeDeps({ members: [REMOTE_CAROL], recent: INBOUND_NON_MEMBER_DAILY_LIMIT })
    expect(await admit(memberAtLimit, note())).not.toBeNull()
  })

  test('an Update of an existing entry is admitted past the limit', async () => {
    const fake = fakeDeps({
      entries: { [`alice:${CAROL_NOTE}`]: storedEntry(entryInput(CAROL_NOTE, CAROL), 'e1') },
      recent: INBOUND_NON_MEMBER_DAILY_LIMIT + 5,
    })
    const result = await admit(
      fake,
      note({ content: '<p>edited</p>', updated: new Date('2026-11-10T11:00:00Z') }),
    )
    expect(result).not.toBeNull()
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)).toMatchObject({
      content: '<p>edited</p>',
      edited_at: new Date('2026-11-10T11:00:00Z'),
    })
    expect(fake.notified).toEqual([])
  })

  test('an author who left still rewrites their participants entry', async () => {
    const fake = fakeDeps({
      entries: {
        [`alice:${CAROL_NOTE}`]: storedEntry(
          { ...entryInput(CAROL_NOTE, CAROL), audience: 'participants' },
          'e1',
        ),
      },
    })
    const result = await admit(
      fake,
      note({ content: '<p>edited</p>', context: CHALLENGE_URI, public: false }),
    )
    expect(result).not.toBeNull()
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)).toMatchObject({
      audience: 'participants',
      content: '<p>edited</p>',
    })
  })

  test('no presentation, no entry', async () => {
    const fake = fakeDeps()
    expect(await admit(fake, note(), { presentation: async () => null })).toBeNull()
    expect(fake.entries.size).toBe(0)
  })

  test('published in the future is clamped to now, and so is a later edit', async () => {
    const fake = fakeDeps()
    await admit(
      fake,
      note({ published: new Date('2027-01-01T00:00:00Z'), updated: new Date('2027-02-01T00:00:00Z') }),
    )
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)).toMatchObject({
      edited_at: new Date(NOW),
      published_at: new Date(NOW),
    })
  })

  test('an updated stamp not later than published is no edit', async () => {
    const fake = fakeDeps()
    const at = new Date('2026-11-10T10:00:00Z')
    await admit(fake, note({ published: at, updated: at }))
    expect(fake.entries.get(`alice:${CAROL_NOTE}`)?.edited_at).toBeNull()
  })

  test('a refusal by the thread (an entry of another author under that id) is none', async () => {
    const refused = fakeDeps({
      entries: {
        [`alice:${CAROL_NOTE}`]: storedEntry(
          entryInput(CAROL_NOTE, 'https://remote.example/users/dave'),
          'e1',
        ),
      },
    })
    expect(await admit(refused, note())).toBeNull()
  })

  test('quiet for the host and a member, not for a visitor or the author', async () => {
    expect((await admit(fakeDeps(), note(), { me: 'alice' }))?.quiet).toBe(true)
    expect((await admit(fakeDeps(), note(), { me: 'bob' }))?.quiet).toBe(true)
    expect((await admit(fakeDeps(), note(), { me: 'dave' }))?.quiet).toBe(false)
    const own = await admit(fakeDeps(), note({ actor: BOB, id: BOB_POST }), { actor: BOB, me: 'bob' })
    expect(own?.quiet).toBe(false)
  })

  test('a missing database is none', async () => {
    const fake = fakeDeps()
    fake.deps.listMembers = async () => {
      throw Object.assign(new Error('no db'), { code: '3D000' })
    }
    expect(await admit(fake, note())).toBeNull()
  })
})

describe('removeInboundThreadEntry', () => {
  test('deletes from the recipient thread, scoped to the sender', async () => {
    const fake = fakeDeps()
    await removeInboundThreadEntry(fake.deps, WEB, 'alice', CAROL_NOTE, CAROL)
    expect(fake.deleted).toEqual([`alice:${CAROL_NOTE}:${CAROL}`])
  })

  test('deletes from the host thread when the recipient received it as an answer to a thread', async () => {
    const fake = fakeDeps({
      posts: { [`bob/${POST_ID}`]: { challenge_uri: CHALLENGE_URI, id: POST_ID } },
      timeline: { [`bob:${CAROL_NOTE}`]: { actor_uri: CAROL, in_reply_to_uri: BOB_POST } },
    })
    await removeInboundThreadEntry(fake.deps, WEB, 'bob', CAROL_NOTE, CAROL)
    expect(fake.deleted).toEqual([`bob:${CAROL_NOTE}:${CAROL}`, `alice:${CAROL_NOTE}:${CAROL}`])
  })

  test('a reply to the challenge object received by a follower', async () => {
    const fake = fakeDeps({
      timeline: { [`bob:${CAROL_NOTE}`]: { actor_uri: CAROL, in_reply_to_uri: CHALLENGE_URI } },
    })
    await removeInboundThreadEntry(fake.deps, WEB, 'bob', CAROL_NOTE, CAROL)
    expect(fake.deleted).toContain(`alice:${CAROL_NOTE}:${CAROL}`)
  })

  test('nothing in another thread for a timeline entry another actor wrote', async () => {
    const fake = fakeDeps({
      timeline: { [`bob:${CAROL_NOTE}`]: { actor_uri: CAROL, in_reply_to_uri: CHALLENGE_URI } },
    })
    const dave = 'https://remote.example/users/dave'
    await removeInboundThreadEntry(fake.deps, WEB, 'bob', CAROL_NOTE, dave)
    expect(fake.deleted).toEqual([`bob:${CAROL_NOTE}:${dave}`])
  })

  test('the host itself is not deleted from twice', async () => {
    const fake = fakeDeps({
      timeline: { [`alice:${CAROL_NOTE}`]: { actor_uri: CAROL, in_reply_to_uri: CHALLENGE_URI } },
    })
    await removeInboundThreadEntry(fake.deps, WEB, 'alice', CAROL_NOTE, CAROL)
    expect(fake.deleted).toEqual([`alice:${CAROL_NOTE}:${CAROL}`])
  })

  test('an actor deleting itself takes all its entries', async () => {
    const fake = fakeDeps()
    await removeInboundThreadEntry(fake.deps, WEB, 'alice', CAROL, CAROL)
    expect(fake.deleted).toEqual([`alice:${CAROL}:${CAROL}`, `alice:*${CAROL}`])
  })
})
