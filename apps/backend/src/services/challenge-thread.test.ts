import { describe, expect, test } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeRecord,
  ChallengeThreadEntryInput,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  ReplyPostInput,
} from '../db/index.ts'

import {
  type AdmissionFacts,
  addChallengeComment,
  allowedAudiences,
  assembleThread,
  type ChallengeThreadDeps,
  challengeCommentNotifications,
  challengeThreadRole,
  decideAdmission,
  followPostDeleteInThread,
  followPostEditInThread,
  followsPost,
  isThreadParticipant,
  MAX_REPLIES_PER_ENTRY,
  MAX_THREAD_ENTRIES,
  OTHER_SERVER_MESSAGE,
  ownPostIdOf,
  parseChallengeObjectUrl,
  parseChallengePageUrl,
  readableAudiences,
  readChallengeThread,
  type RemoteThreadBranch,
  resolveHostedChallenge,
  setChallengePostFollowing,
  setChallengeThreadEntryHidden,
  syncThreadEntryForPost,
  type ThreadCandidate,
  type ThreadPushChange,
  threadVisibilityLocked,
  verifiedRemoteActors,
  withFollowing,
} from './challenge-thread.ts'

const WEB = 'https://aurboda.test'
const CHALLENGE_URI = `${WEB}/users/alice/challenges/abc`
const POST_ID = '11111111-1111-4111-8111-111111111111'

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

const MEMBERS = [member({ local_user: 'alice' }), member({ id: 'm2', local_user: 'bob' })]

const entry = (over: Partial<ChallengeThreadEntryRecord> = {}): ChallengeThreadEntryRecord => ({
  actor_uri: `${WEB}/users/bob`,
  audience: 'public',
  avatar_url: null,
  challenge_id: 'c1',
  content: '<p>hi</p>',
  created_at: new Date('2026-10-05T00:00:00Z'),
  display_name: 'Bob',
  edited_at: null,
  handle: '@bob@aurboda.test',
  hidden_at: null,
  id: 'e1',
  images: [],
  in_reply_to_uri: CHALLENGE_URI,
  kind: 'comment',
  object_uri: `${WEB}/users/bob/feed/${POST_ID}`,
  published_at: new Date('2026-10-05T00:00:00Z'),
  root_entry_id: null,
  url: null,
  ...over,
})

const candidate = (over: Partial<ThreadCandidate> = {}): ThreadCandidate => ({
  audience: 'public',
  author: {
    actor_uri: `${WEB}/users/bob`,
    avatar_url: null,
    display_name: 'Bob',
    handle: '@bob@aurboda.test',
  },
  content: '<p>hi</p>',
  edited_at: null,
  images: [],
  in_reply_to_uri: CHALLENGE_URI,
  kind: 'comment',
  object_uri: `${WEB}/users/bob/feed/${POST_ID}`,
  published_at: new Date('2026-10-05T00:00:00Z'),
  url: null,
  ...over,
})

const facts = (over: Partial<AdmissionFacts> = {}): AdmissionFacts => ({
  challenge: { id: 'c1', is_public: true },
  challenge_object_uri: CHALLENGE_URI,
  entry_count: 0,
  existing: null,
  is_participant: true,
  parent: null,
  ...over,
})

const stored = (over: Partial<NonNullable<AdmissionFacts['existing']>> = {}) => ({
  actor_uri: `${WEB}/users/bob`,
  audience: 'public' as const,
  challenge_id: 'c1',
  kind: 'comment' as const,
  root_entry_id: null,
  ...over,
})

describe('parseChallengePageUrl', () => {
  test('reads the host and slug of a challenge page on this instance', () => {
    expect(parseChallengePageUrl(WEB, `${WEB}/u/alice/abc`)).toEqual({ slug: 'abc', username: 'alice' })
    expect(parseChallengePageUrl(WEB, `${WEB}/u/alice/abc/?embed=1`)).toEqual({
      slug: 'abc',
      username: 'alice',
    })
  })

  test('keeps a sub-path web host', () => {
    expect(parseChallengePageUrl(`${WEB}/app`, `${WEB}/app/u/alice/abc`)).toEqual({
      slug: 'abc',
      username: 'alice',
    })
    expect(parseChallengePageUrl(`${WEB}/app`, `${WEB}/u/alice/abc`)).toBeNull()
  })

  test('refuses another host, another shape and extra segments', () => {
    expect(parseChallengePageUrl(WEB, 'https://elsewhere.test/u/alice/abc')).toBeNull()
    expect(parseChallengePageUrl(WEB, `${WEB}/u/alice`)).toBeNull()
    expect(parseChallengePageUrl(WEB, `${WEB}/u/alice/abc/banner.webp`)).toBeNull()
    expect(parseChallengePageUrl(WEB, 'not a url')).toBeNull()
  })
})

describe('parseChallengeObjectUrl', () => {
  test('reads a challenge object id of this instance', () => {
    expect(parseChallengeObjectUrl(WEB, CHALLENGE_URI)).toEqual({ slug: 'abc', username: 'alice' })
    expect(parseChallengeObjectUrl(WEB, `${WEB}/users/alice/feed/abc`)).toBeNull()
    expect(parseChallengeObjectUrl(WEB, 'https://elsewhere.test/users/alice/challenges/abc')).toBeNull()
  })
})

describe('resolveHostedChallenge', () => {
  const load = async (host: string, slug: string) => (host === 'alice' && slug === 'abc' ? challenge() : null)

  test('finds a challenge hosted here', async () => {
    expect(await resolveHostedChallenge(WEB, `${WEB}/u/alice/abc`, load)).toMatchObject({
      host: 'alice',
      ok: true,
    })
  })

  test('another server is a 400 that names it, an unknown slug a 404', async () => {
    expect(await resolveHostedChallenge(WEB, 'https://elsewhere.test/u/alice/abc', load)).toEqual({
      error: OTHER_SERVER_MESSAGE,
      ok: false,
      status: 400,
    })
    expect(await resolveHostedChallenge(WEB, `${WEB}/u/alice/zzz`, load)).toMatchObject({ status: 404 })
    expect(await resolveHostedChallenge(WEB, `${WEB}/feed`, load)).toMatchObject({ status: 400 })
  })
})

describe('roles and audiences', () => {
  test('the host, an active local member, and everyone else', () => {
    expect(challengeThreadRole('alice', MEMBERS, 'alice')).toBe('host')
    expect(challengeThreadRole('alice', MEMBERS, 'bob')).toBe('member')
    expect(challengeThreadRole('alice', MEMBERS, 'carol')).toBe('visitor')
    expect(challengeThreadRole('alice', MEMBERS, null)).toBe('visitor')
    expect(challengeThreadRole('alice', [member({ status: 'withdrawn' })], 'bob')).toBe('visitor')
    expect(challengeThreadRole('alice', [member({ kind: 'remote' })], 'bob')).toBe('visitor')
  })

  test('who may post with which audience', () => {
    const open = challenge()
    const unlisted = challenge({ is_public: false })
    expect(allowedAudiences('host', open)).toEqual(['public', 'participants'])
    expect(allowedAudiences('member', open)).toEqual(['public', 'participants'])
    expect(allowedAudiences('member', unlisted)).toEqual(['participants'])
    expect(allowedAudiences('visitor', open)).toEqual(['public'])
    expect(allowedAudiences('visitor', open, false)).toEqual([])
    expect(allowedAudiences('visitor', unlisted)).toEqual([])
  })

  test('who may read which audience', () => {
    expect(readableAudiences('member', challenge())).toEqual(['public', 'participants'])
    expect(readableAudiences('visitor', challenge())).toEqual(['public'])
    expect(readableAudiences('visitor', challenge({ is_public: false }))).toEqual([])
  })

  test('participants are the host, local members, and remote members by actor or identity', () => {
    const remote = member({
      actor: 'https://far.test/users/zed',
      identity_base_url: 'https://far.test/u/zed',
      kind: 'remote',
      local_user: null,
    })
    const withoutActor = member({
      identity_base_url: 'https://far.test/u/yan',
      kind: 'remote',
      local_user: null,
    })
    const all = [...MEMBERS, remote, withoutActor]
    expect(isThreadParticipant(WEB, 'alice', all, `${WEB}/users/alice`)).toBe(true)
    expect(isThreadParticipant(WEB, 'alice', all, `${WEB}/users/bob`)).toBe(true)
    expect(isThreadParticipant(WEB, 'alice', all, 'https://far.test/users/zed')).toBe(true)
    expect(isThreadParticipant(WEB, 'alice', all, 'https://far.test/users/yan')).toBe(true)
    expect(isThreadParticipant(WEB, 'alice', all, `${WEB}/users/carol`)).toBe(false)
  })
})

describe('decideAdmission', () => {
  test('a top-level comment by a member is admitted with no root', () => {
    expect(decideAdmission(candidate(), facts())).toEqual({
      admitted: true,
      audience: 'public',
      root_entry_id: null,
    })
  })

  test('an unlisted challenge forces participants', () => {
    expect(decideAdmission(candidate(), facts({ challenge: { id: 'c1', is_public: false } }))).toMatchObject({
      admitted: true,
      audience: 'participants',
    })
  })

  test('a non-member cannot write participants, and not at all on an unlisted challenge', () => {
    expect(
      decideAdmission(candidate({ audience: 'participants' }), facts({ is_participant: false })),
    ).toEqual({ admitted: false, reason: 'not_participant' })
    expect(
      decideAdmission(
        candidate(),
        facts({ challenge: { id: 'c1', is_public: false }, is_participant: false }),
      ),
    ).toEqual({ admitted: false, reason: 'not_participant' })
    expect(decideAdmission(candidate(), facts({ is_participant: false }))).toMatchObject({ admitted: true })
  })

  test('a reply takes the root of its parent and may not be wider than it', () => {
    const parent = { audience: 'participants' as const, challenge_id: 'c1', id: 'p1', root_entry_id: null }
    const reply = candidate({ in_reply_to_uri: `${WEB}/users/alice/feed/x` })
    expect(decideAdmission(reply, facts({ parent }))).toEqual({
      admitted: false,
      reason: 'wider_than_parent',
    })
    expect(decideAdmission({ ...reply, audience: 'participants' }, facts({ parent }))).toEqual({
      admitted: true,
      audience: 'participants',
      root_entry_id: 'p1',
    })
    expect(
      decideAdmission(
        { ...reply, audience: 'participants' },
        facts({ parent: { ...parent, root_entry_id: 'r0' } }),
      ),
    ).toMatchObject({ root_entry_id: 'r0' })
  })

  test('a reply to an entry of another thread, or to nothing, is refused', () => {
    const reply = candidate({ in_reply_to_uri: `${WEB}/users/alice/feed/x` })
    expect(decideAdmission(reply, facts())).toEqual({ admitted: false, reason: 'unknown_parent' })
    expect(
      decideAdmission(
        reply,
        facts({ parent: { audience: 'public', challenge_id: 'other', id: 'p1', root_entry_id: null } }),
      ),
    ).toEqual({ admitted: false, reason: 'unknown_parent' })
  })

  test('a full thread refuses a new entry but takes an edit', () => {
    expect(decideAdmission(candidate(), facts({ entry_count: MAX_THREAD_ENTRIES }))).toEqual({
      admitted: false,
      reason: 'thread_full',
    })
    expect(
      decideAdmission(
        candidate(),
        facts({
          entry_count: MAX_THREAD_ENTRIES,
          existing: stored(),
        }),
      ),
    ).toMatchObject({ admitted: true })
  })

  test('an edit keeps its place when its author left or the entry it answered is gone', () => {
    const reply = candidate({ audience: 'participants', in_reply_to_uri: `${WEB}/users/alice/feed/x` })
    const existing = stored({ audience: 'participants', root_entry_id: 'r0' })
    expect(decideAdmission(reply, facts({ existing, is_participant: false }))).toEqual({
      admitted: true,
      audience: 'participants',
      root_entry_id: 'r0',
    })
  })

  test('an edit that changes the audience is judged like a new entry', () => {
    expect(
      decideAdmission(
        candidate({ audience: 'participants' }),
        facts({ existing: stored(), is_participant: false }),
      ),
    ).toEqual({ admitted: false, reason: 'not_participant' })
  })

  test('only the author updates an entry', () => {
    expect(
      decideAdmission(candidate(), facts({ existing: stored({ actor_uri: `${WEB}/users/carol` }) })),
    ).toEqual({ admitted: false, reason: 'not_author' })
  })

  test('a share and the result never need a parent', () => {
    expect(decideAdmission(candidate({ in_reply_to_uri: null, kind: 'share' }), facts())).toMatchObject({
      admitted: true,
      root_entry_id: null,
    })
  })
})

describe('assembleThread', () => {
  test('nests replies under their top-level entry and names what each answers', () => {
    const top = entry({ id: 't1', object_uri: `${WEB}/users/bob/feed/t1` })
    const r1 = entry({
      id: 'r1',
      in_reply_to_uri: top.object_uri,
      object_uri: `${WEB}/users/alice/feed/r1`,
      root_entry_id: 't1',
    })
    const r2 = entry({
      id: 'r2',
      in_reply_to_uri: r1.object_uri,
      object_uri: `${WEB}/users/bob/feed/r2`,
      root_entry_id: 't1',
    })
    const other = entry({ id: 't2', object_uri: `${WEB}/users/bob/feed/t2` })
    const thread = assembleThread([top, other], [r1, r2], (record) =>
      record.id === 'r1' ? { message: 'mine', post_id: 'p1' } : null,
    )
    expect(thread.map((e) => e.id)).toEqual(['t1', 't2'])
    expect(thread[0]?.in_reply_to_id).toBeNull()
    expect(thread[0]?.replies.map((r) => [r.id, r.in_reply_to_id])).toEqual([
      ['r1', 't1'],
      ['r2', 'r1'],
    ])
    expect(thread[0]?.replies[0]).toMatchObject({ message: 'mine', own_post_id: 'p1' })
    expect(thread[0]?.replies[1]).not.toHaveProperty('own_post_id')
    expect(thread[1]?.replies).toEqual([])
  })

  test('a hidden reply takes what answers it out of a non-host view', () => {
    const top = entry({ id: 't1', object_uri: `${WEB}/users/bob/feed/t1` })
    const reply = (id: string, answers: string, hidden = false) =>
      entry({
        hidden_at: hidden ? new Date() : null,
        id,
        in_reply_to_uri: `${WEB}/users/bob/feed/${answers}`,
        object_uri: `${WEB}/users/bob/feed/${id}`,
        root_entry_id: 't1',
      })
    const replies = [reply('r1', 't1', true), reply('r2', 'r1'), reply('r3', 'r2'), reply('r4', 't1')]
    const ids = (includeHidden: boolean) =>
      assembleThread([top], replies, () => null, includeHidden)[0]?.replies.map((r) => r.id)
    expect(ids(false)).toEqual(['r4'])
    expect(ids(true)).toEqual(['r1', 'r2', 'r3', 'r4'])
  })

  test('flags hidden entries', () => {
    const [shown] = assembleThread([entry({ hidden_at: new Date() })], [], () => null)
    expect(shown?.hidden).toBe(true)
  })
})

describe('ownPostIdOf', () => {
  test('an entry the viewer wrote under their own Note prefix', () => {
    expect(ownPostIdOf(WEB, 'bob', entry())).toBe(POST_ID)
    expect(ownPostIdOf(WEB, 'alice', entry())).toBeNull()
    expect(ownPostIdOf(WEB, null, entry())).toBeNull()
    expect(
      ownPostIdOf(WEB, 'bob', entry({ object_uri: `https://far.test/users/bob/feed/${POST_ID}` })),
    ).toBeNull()
  })
})

describe('challengeCommentNotifications', () => {
  test('the host and every local active member but the author', () => {
    const notes = challengeCommentNotifications(
      WEB,
      'alice',
      challenge(),
      [
        ...MEMBERS,
        member({ id: 'm3', local_user: 'carol' }),
        member({ id: 'm4', local_user: 'dan', status: 'withdrawn' }),
      ],
      entry(),
    )
    expect(notes.map((n) => n.user)).toEqual(['alice', 'carol'])
    expect(notes[0]?.input).toMatchObject({
      body: 'hi',
      dedupe_key: `challenge_comment:${entry().object_uri}`,
      link: '/u/alice/abc#comments',
      title: 'Bob posted in Push-ups',
      type: 'challenge_comment',
    })
  })
})

describe('following a post', () => {
  const CAROL = `${WEB}/users/carol`
  const DAN = `${WEB}/users/dan`
  const root = entry({ actor_uri: CAROL, display_name: 'Carol', id: 't1' })
  const replyBy = (actor: string, hidden = false) =>
    entry({ actor_uri: actor, hidden_at: hidden ? new Date() : null, root_entry_id: 't1' })

  test('followsPost: an explicit choice wins, else the root author and those who replied visibly', () => {
    expect(followsPost(undefined, CAROL, root, [])).toBe(true)
    expect(followsPost(undefined, DAN, root, [replyBy(DAN)])).toBe(true)
    expect(followsPost(undefined, DAN, root, [replyBy(DAN, true)])).toBe(false)
    expect(followsPost(undefined, DAN, root, [])).toBe(false)
    expect(followsPost(true, DAN, root, [])).toBe(true)
    expect(followsPost(false, CAROL, root, [replyBy(CAROL)])).toBe(false)
  })

  const members = [
    ...MEMBERS,
    member({ id: 'm3', local_user: 'carol' }),
    member({ id: 'm4', local_user: 'dan' }),
  ]
  const theReply = entry({ id: 'r9', object_uri: `${WEB}/users/bob/feed/r9`, root_entry_id: 't1' })

  test('a reply notifies only the recipients who follow its root, worded for each', () => {
    const notes = challengeCommentNotifications(WEB, 'alice', challenge(), members, theReply, {
      followers: new Set(['carol', 'dan', 'bob']),
      root,
    })
    expect(notes.map((n) => [n.user, n.input.type, n.input.title, n.input.dedupe_key])).toEqual([
      [
        'carol',
        'challenge_reply',
        'Bob replied to your post in Push-ups',
        `challenge_reply:${theReply.object_uri}`,
      ],
      [
        'dan',
        'challenge_reply',
        "Bob replied to Carol's post in Push-ups",
        `challenge_reply:${theReply.object_uri}`,
      ],
    ])
    expect(notes[0]?.input).toMatchObject({ link: '/u/alice/abc#comments' })
  })

  test('a reply whose root is unknown notifies nobody', () => {
    expect(challengeCommentNotifications(WEB, 'alice', challenge(), members, theReply)).toEqual([])
  })

  test('withFollowing marks each top-level entry from its own replies and the explicit choices', () => {
    const other = entry({ actor_uri: CAROL, id: 't2', object_uri: `${WEB}/users/carol/feed/t2` })
    const entries = assembleThread([root, other], [replyBy(DAN)], () => null)
    const marked = withFollowing(
      entries,
      [root, other],
      [replyBy(DAN)],
      DAN,
      new Map([[other.object_uri, true]]),
    )
    expect(marked.map((e) => [e.id, e.following])).toEqual([
      ['t1', true],
      ['t2', true],
    ])
    expect(withFollowing(entries, [root, other], [], DAN, new Map()).map((e) => e.following)).toEqual([
      false,
      false,
    ])
  })
})

describe('threadVisibilityLocked', () => {
  const comment = { challenge_uri: CHALLENGE_URI, kind: 'reply' as const, visibility: 'unlisted' as const }

  test('a comment keeps its visibility; its message is free', () => {
    expect(threadVisibilityLocked(comment, 'public')).toBe(true)
    expect(threadVisibilityLocked(comment, 'unlisted')).toBe(false)
    expect(threadVisibilityLocked(comment, undefined)).toBe(false)
    expect(threadVisibilityLocked({ ...comment, challenge_uri: null }, 'public')).toBe(false)
    expect(threadVisibilityLocked({ ...comment, kind: 'challenge' }, 'followers')).toBe(false)
  })
})

describe('addChallengeComment', () => {
  const post = (input: ReplyPostInput): FeedPostRecord => ({
    activity_id: null,
    article: null,
    autoshare_rule_id: null,
    challenge: null,
    challenge_uri: input.challenge_uri ?? null,
    created_at: new Date('2026-10-06T00:00:00Z'),
    dashboard: null,
    exercise: null,
    id: POST_ID,
    image_token: 't',
    in_reply_to_actor_uri: input.in_reply_to_actor_uri,
    in_reply_to_handle: input.in_reply_to_handle ?? null,
    in_reply_to_uri: input.in_reply_to_uri,
    include_chart: false,
    include_exercises: false,
    include_map: false,
    included_metrics: [],
    kind: 'reply',
    message: input.message,
    series_metrics: [],
    tags: [],
    updated_at: new Date('2026-10-06T00:00:00Z'),
    visibility: input.visibility,
  })

  const fakeDeps = (
    over: {
      count?: number
      existing?: ChallengeThreadEntryRecord
      members?: ChallengeMemberRecord[]
      remote?: RemoteThreadBranch
      upsertFails?: boolean
      hidden?: ChallengeThreadEntryRecord
      removed?: ChallengeThreadEntryRecord
      tops?: ChallengeThreadEntryRecord[]
      replies?: ChallengeThreadEntryRecord[]
      byId?: ChallengeThreadEntryRecord[]
      follows?: Record<string, Record<string, boolean>>
    } = {},
  ) => {
    const followSets: { following: boolean; uri: string; user: string }[] = []
    const notes: { type: string; title: string; user: string }[] = []
    const pushes: { change: ThreadPushChange; recipients: string[]; user: string }[] = []
    const signals: { host: string; kind: string; object: string; target: string; recipients: string[] }[] = []
    const asked: { include_hidden: boolean; perRoot?: number }[] = []
    const created: ReplyPostInput[] = []
    const deleted: string[] = []
    const upserts: ChallengeThreadEntryInput[] = []
    const delivered: string[] = []
    const notified: string[] = []
    const deps: ChallengeThreadDeps = {
      countEntries: async () => over.count ?? 0,
      countVisible: async () => 0,
      createReplyPost: async (_user, input) => {
        created.push(input)
        return post(input)
      },
      deleteEntry: async () => over.removed ?? null,
      deletePost: async (_user, id) => {
        deleted.push(id)
      },
      deliver: { createdReply: (_user, record) => delivered.push(record.id) },
      followChoices: async (user, uris) =>
        new Map(
          uris.flatMap((uri) => {
            const choice = over.follows?.[user]?.[uri]
            return choice === undefined ? [] : [[uri, choice] as const]
          }),
        ),
      getEntryById: async (_host, id) => over.byId?.find((e) => e.id === id) ?? null,
      getEntryByObjectUri: async (_host, uri) =>
        over.existing ?? over.byId?.find((e) => e.object_uri === uri) ?? null,
      getOwnPost: async () => null,
      listMembers: async () => over.members ?? MEMBERS,
      listReplies: async (_host, _ids, visibility, perRoot) => {
        asked.push({ include_hidden: visibility.include_hidden, perRoot })
        return over.replies ?? []
      },
      listTopLevel: async (_host, _id, visibility, limit) =>
        (over.tops ?? [])
          .filter((top) => visibility.include_hidden || top.hidden_at == null)
          .slice(0, limit)
          .map((top) => ({ ...top, cursor_ts: top.published_at.toISOString() })),
      loadChallenge: async () => challenge(),
      notify: async (user, input) => {
        notified.push(user)
        notes.push({ title: input.title, type: input.type, user })
      },
      push: (user, _post, change, recipients) => {
        pushes.push({ change, recipients, user })
      },
      ...(over.remote == null ? {} : { remote: over.remote }),
      presentation: async (user) => ({
        avatar_url: null,
        display_name: null,
        handle: `@${user}@aurboda.test`,
      }),
      resolveTags: async () => [],
      setFollow: async (user, uri, following) => {
        followSets.push({ following, uri, user })
      },
      setHidden: async (_host, _challengeId, _entryId, hidden) =>
        over.hidden == null ? null : { ...over.hidden, hidden_at: hidden ? new Date() : null },
      signal: (host, kind, object, target, recipients) => {
        signals.push({ host, kind, object, recipients, target })
      },
      upsert: async (_host, input) => {
        upserts.push(input)
        return over.upsertFails ? null : { entry: entry({ ...input, id: 'new' }), inserted: true }
      },
      webHost: WEB,
    }
    return {
      asked,
      created,
      deleted,
      delivered,
      deps,
      followSets,
      notes,
      notified,
      pushes,
      signals,
      upserts,
    }
  }

  const body = { audience: 'participants' as const, challenge_url: `${WEB}/u/alice/abc`, message: ' Go! ' }

  test('a member comments for participants: a participants post, admitted, nobody but the host told', async () => {
    const { created, delivered, deps, notified, upserts } = fakeDeps()
    const result = await addChallengeComment(deps, 'bob', body)
    expect(result).toMatchObject({ entry: { message: 'Go!', own_post_id: POST_ID, replies: [] }, ok: true })
    expect(created[0]).toMatchObject({
      challenge_uri: CHALLENGE_URI,
      in_reply_to_actor_uri: `${WEB}/users/alice`,
      in_reply_to_uri: CHALLENGE_URI,
      message: 'Go!',
      visibility: 'participants',
    })
    expect(upserts[0]).toMatchObject({ audience: 'participants', kind: 'comment', url: null })
    expect(delivered).toEqual([])
    expect(notified).toEqual(['alice'])
  })

  test('a public comment is an unlisted post and federates', async () => {
    const { created, delivered, deps } = fakeDeps()
    await addChallengeComment(deps, 'bob', { ...body, audience: 'public' })
    expect(created[0]?.visibility).toBe('unlisted')
    expect(delivered).toEqual([POST_ID])
  })

  test('a visitor may not comment for participants and posts nothing', async () => {
    const { created, deps } = fakeDeps()
    expect(await addChallengeComment(deps, 'carol', body)).toMatchObject({ ok: false, status: 403 })
    expect(created).toEqual([])
  })

  test('a reply to an entry that is not there is a 404', async () => {
    const { deps } = fakeDeps()
    expect(
      await addChallengeComment(deps, 'bob', {
        ...body,
        in_reply_to_id: '22222222-2222-4222-8222-222222222222',
      }),
    ).toMatchObject({ ok: false, status: 404 })
  })

  test('a full thread is a 409', async () => {
    const { created, deps } = fakeDeps({ count: MAX_THREAD_ENTRIES })
    expect(await addChallengeComment(deps, 'bob', body)).toMatchObject({ ok: false, status: 409 })
    expect(created).toEqual([])
  })

  test('a refused admission takes the post back', async () => {
    const { deleted, deps } = fakeDeps({ upsertFails: true })
    expect(await addChallengeComment(deps, 'bob', body)).toMatchObject({ ok: false })
    expect(deleted).toEqual([POST_ID])
  })

  const OLA = 'https://home.example/users/ola'
  const ZED = 'https://far.example/users/zed'
  const OTHER_URL = 'https://host.example/u/freja/nov'
  const remoteMembers = [
    ...MEMBERS,
    member({ actor: OLA, actor_verified_at: new Date(), id: 'm3', kind: 'remote', local_user: null }),
    member({ actor: ZED, id: 'm4', kind: 'remote', local_user: null }),
    member({
      actor: 'https://gone.example/users/x',
      actor_verified_at: new Date(),
      id: 'm5',
      kind: 'remote',
      local_user: null,
      status: 'withdrawn',
    }),
  ]

  const remoteBranch = () => {
    const calls: string[] = []
    const branch: RemoteThreadBranch = {
      afterJoin: async () => {},
      comment: async (user, input) => {
        calls.push(`comment ${user} ${input.challenge_url}`)
        return { error: 'remote', ok: false, status: 502 }
      },
      followDelete: async (user, record) => calls.push(`delete ${user} ${record.id}`),
      followEdit: async (user, record) => calls.push(`edit ${user} ${record.id}`),
      read: async (user, url) => {
        calls.push(`read ${user} ${url}`)
        return { error: 'remote', ok: false, status: 502 }
      },
      setFollowing: async (user, url, id, following) => {
        calls.push(`follow ${user} ${url} ${id} ${following}`)
        return { following, ok: true }
      },
    }
    return { branch, calls }
  }

  const reply = (over: Partial<FeedPostRecord> = {}): FeedPostRecord => ({
    ...post({
      challenge_uri: CHALLENGE_URI,
      in_reply_to_actor_uri: `${WEB}/users/alice`,
      in_reply_to_uri: CHALLENGE_URI,
      message: 'Edited',
      visibility: 'participants',
    }),
    ...over,
  })

  test('a comment admitted here is pushed to the verified, active members on other servers only', async () => {
    const { deps, pushes } = fakeDeps({ members: remoteMembers })
    await addChallengeComment(deps, 'bob', body)
    expect(pushes).toEqual([{ change: 'create', recipients: [OLA], user: 'bob' }])
  })

  test('with no verified member on another server nothing is pushed', async () => {
    const { deps, pushes } = fakeDeps()
    await addChallengeComment(deps, 'bob', body)
    expect(pushes).toEqual([])
  })

  test('verifiedRemoteActors falls back to the identity for a verified member with no actor', () => {
    expect(
      verifiedRemoteActors([
        member({
          actor: null,
          actor_verified_at: new Date(),
          identity_base_url: 'https://home.example/u/ola',
          kind: 'remote',
          local_user: null,
        }),
      ]),
    ).toEqual([OLA])
  })

  test('a comment on a challenge hosted elsewhere goes to the remote branch', async () => {
    const { branch, calls } = remoteBranch()
    const { created, deps } = fakeDeps({ remote: branch })
    await addChallengeComment(deps, 'bob', { ...body, challenge_url: OTHER_URL })
    expect(calls).toEqual([`comment bob ${OTHER_URL}`])
    expect(created).toEqual([])
  })

  test('reading a thread hosted elsewhere goes to the remote branch, one hosted here does not', async () => {
    const { branch, calls } = remoteBranch()
    const { deps } = fakeDeps({ remote: branch })
    expect(await readChallengeThread(deps, 'bob', OTHER_URL)).toMatchObject({ ok: false, status: 502 })
    expect(await readChallengeThread(deps, 'bob', `${WEB}/u/alice/abc`)).toMatchObject({ ok: true })
    expect(calls).toEqual([`read bob ${OTHER_URL}`])
  })

  test('hiding is refused for a challenge hosted on another server', async () => {
    const { deps } = fakeDeps()
    expect(await setChallengeThreadEntryHidden(deps, 'bob', true, OTHER_URL, 'e1', true)).toMatchObject({
      error: "Only on the host's own server",
      ok: false,
      status: 403,
    })
  })

  test('an edited comment here is re-admitted and the Update pushed to verified members', async () => {
    const { deps, pushes, upserts } = fakeDeps({
      existing: entry({ audience: 'participants' }),
      members: remoteMembers,
    })
    await followPostEditInThread(deps, 'bob', reply())
    expect(upserts).toHaveLength(1)
    expect(pushes).toEqual([{ change: 'update', recipients: [OLA], user: 'bob' }])
  })

  test('a deleted comment here leaves the thread and the Delete is pushed to verified members', async () => {
    const { deps, pushes } = fakeDeps({ members: remoteMembers })
    await followPostDeleteInThread(deps, 'bob', reply())
    expect(pushes).toEqual([{ change: 'delete', recipients: [OLA], user: 'bob' }])
  })

  test('an edit or delete of a comment in a thread hosted elsewhere goes to the remote branch', async () => {
    const { branch, calls } = remoteBranch()
    const { deps, pushes } = fakeDeps({ remote: branch })
    const elsewhere = reply({ challenge_uri: 'https://host.example/users/freja/challenges/nov' })
    await followPostEditInThread(deps, 'bob', elsewhere)
    await followPostDeleteInThread(deps, 'bob', elsewhere)
    expect(calls).toEqual([`edit bob ${POST_ID}`, `delete bob ${POST_ID}`])
    expect(pushes).toEqual([])
  })

  test('hiding sends Remove, unhiding Add, to the verified members on other servers only', async () => {
    const { deps, pushes, signals } = fakeDeps({ hidden: entry(), members: remoteMembers })
    const url = `${WEB}/u/alice/abc`
    expect(await setChallengeThreadEntryHidden(deps, 'alice', false, url, 'e1', true)).toMatchObject({
      entry: { hidden: true },
      ok: true,
    })
    await setChallengeThreadEntryHidden(deps, 'carol', true, url, 'e1', false)
    expect(signals).toEqual([
      { host: 'alice', kind: 'remove', object: entry().object_uri, recipients: [OLA], target: CHALLENGE_URI },
      { host: 'alice', kind: 'add', object: entry().object_uri, recipients: [OLA], target: CHALLENGE_URI },
    ])
    expect(pushes).toEqual([])
  })

  test('a refused or missing hide signals nothing, nor does one with no member on another server', async () => {
    const url = `${WEB}/u/alice/abc`
    const refused = fakeDeps({ hidden: entry(), members: remoteMembers })
    await setChallengeThreadEntryHidden(refused.deps, 'bob', false, url, 'e1', true)
    const missing = fakeDeps({ members: remoteMembers })
    await setChallengeThreadEntryHidden(missing.deps, 'alice', false, url, 'e1', true)
    const local = fakeDeps({ hidden: entry() })
    await setChallengeThreadEntryHidden(local.deps, 'alice', false, url, 'e1', true)
    expect([...refused.signals, ...missing.signals, ...local.signals]).toEqual([])
  })

  const sharePost = (): FeedPostRecord => ({
    ...reply({ in_reply_to_actor_uri: null, in_reply_to_uri: null, kind: 'challenge', visibility: 'public' }),
    message: 'Day one done',
  })

  test('a share taken into the thread sends Add; an edited comment, already pushed, does not', async () => {
    const shared = fakeDeps({ members: remoteMembers })
    await syncThreadEntryForPost(shared.deps, 'bob', sharePost())
    expect(shared.signals).toEqual([
      {
        host: 'alice',
        kind: 'add',
        object: `${WEB}/users/bob/feed/${POST_ID}`,
        recipients: [OLA],
        target: CHALLENGE_URI,
      },
    ])
    const edited = fakeDeps({ existing: entry({ audience: 'participants' }), members: remoteMembers })
    await followPostEditInThread(edited.deps, 'bob', reply())
    expect(edited.signals).toEqual([])
  })

  describe('a share that leaves the thread sends Remove to the verified members on other servers', () => {
    const shareEntry = (over: Partial<ChallengeThreadEntryRecord> = {}) =>
      entry({ in_reply_to_uri: null, kind: 'share', ...over })
    const removeOf = (object: string) => ({
      host: 'alice',
      kind: 'remove',
      object,
      recipients: [OLA],
      target: CHALLENGE_URI,
    })

    test.each([
      ['deleted', (deps: ChallengeThreadDeps) => followPostDeleteInThread(deps, 'bob', sharePost())],
      [
        'narrowed to followers',
        (deps: ChallengeThreadDeps) =>
          followPostEditInThread(deps, 'bob', { ...sharePost(), visibility: 'followers' }),
      ],
      [
        'edited to no note',
        (deps: ChallengeThreadDeps) => followPostEditInThread(deps, 'bob', { ...sharePost(), message: ' ' }),
      ],
    ])('%s', async (_label, leave) => {
      const { deps, pushes, signals, upserts } = fakeDeps({ members: remoteMembers, removed: shareEntry() })
      await leave(deps)
      expect(signals).toEqual([removeOf(shareEntry().object_uri)])
      expect(pushes).toEqual([])
      expect(upserts).toEqual([])
    })

    test('the result post deleted sends Remove too', async () => {
      const { deps, signals } = fakeDeps({ members: remoteMembers, removed: shareEntry({ kind: 'result' }) })
      await followPostDeleteInThread(deps, 'bob', sharePost())
      expect(signals).toEqual([removeOf(shareEntry().object_uri)])
    })

    test('nothing when no entry left, it was hidden (already removed), or it was a comment', async () => {
      const none = fakeDeps({ members: remoteMembers })
      await followPostDeleteInThread(none.deps, 'bob', sharePost())
      const hidden = fakeDeps({ members: remoteMembers, removed: shareEntry({ hidden_at: new Date() }) })
      await followPostDeleteInThread(hidden.deps, 'bob', sharePost())
      const comment = fakeDeps({ members: remoteMembers, removed: entry() })
      await followPostDeleteInThread(comment.deps, 'bob', reply())
      expect([...none.signals, ...hidden.signals, ...comment.signals]).toEqual([])
      expect(comment.pushes).toEqual([{ change: 'delete', recipients: [OLA], user: 'bob' }])
    })
  })

  test('an admin who is not the host reads hidden entries as the host does; a member does not', async () => {
    const tops = [
      entry({ hidden_at: new Date(), id: 'h1', object_uri: `${WEB}/users/bob/feed/h1` }),
      entry({ id: 'e2', object_uri: `${WEB}/users/bob/feed/e2` }),
    ]
    const { asked, deps } = fakeDeps({ tops })
    const url = `${WEB}/u/alice/abc`
    const ids = (result: Awaited<ReturnType<typeof readChallengeThread>>) =>
      result.ok ? result.entries.map((e) => [e.id, e.hidden]) : result
    expect(ids(await readChallengeThread(deps, 'carol', url, undefined, true))).toEqual([
      ['h1', true],
      ['e2', false],
    ])
    expect(ids(await readChallengeThread(deps, 'bob', url))).toEqual([['e2', false]])
    expect(asked).toEqual([
      { include_hidden: true, perRoot: MAX_REPLIES_PER_ENTRY },
      { include_hidden: true, perRoot: MAX_THREAD_ENTRIES },
    ])
  })
  describe('replies notify the followers of their root post', () => {
    const CAROL = `${WEB}/users/carol`
    const DAN = `${WEB}/users/dan`
    const URL = `${WEB}/u/alice/abc`
    const root = entry({
      actor_uri: CAROL,
      display_name: 'Carol',
      id: '33333333-3333-4333-8333-333333333333',
      object_uri: `${WEB}/users/carol/feed/t1`,
    })
    const earlier = entry({
      actor_uri: DAN,
      display_name: 'Dan',
      id: '44444444-4444-4444-8444-444444444444',
      in_reply_to_uri: root.object_uri,
      object_uri: `${WEB}/users/dan/feed/r1`,
      root_entry_id: root.id,
    })
    const members = [
      ...MEMBERS,
      member({ id: 'm3', local_user: 'carol' }),
      member({ id: 'm4', local_user: 'dan' }),
    ]
    const replyBody = { ...body, in_reply_to_id: root.id }

    test('the root author and an earlier replier get challenge_reply; the host does not', async () => {
      const { deps, notes } = fakeDeps({ byId: [root, earlier], members, replies: [earlier] })
      expect(await addChallengeComment(deps, 'bob', replyBody)).toMatchObject({ ok: true })
      expect(notes).toEqual([
        {
          title: '@bob@aurboda.test replied to your post in Push-ups',
          type: 'challenge_reply',
          user: 'carol',
        },
        {
          title: "@bob@aurboda.test replied to Carol's post in Push-ups",
          type: 'challenge_reply',
          user: 'dan',
        },
      ])
    })

    test('an explicit follower who never wrote is told; an explicit unfollower is not', async () => {
      const { deps, notified } = fakeDeps({
        byId: [root, earlier],
        follows: { alice: { [root.object_uri]: true }, dan: { [root.object_uri]: false } },
        members,
        replies: [earlier],
      })
      await addChallengeComment(deps, 'bob', replyBody)
      expect(notified.sort()).toEqual(['alice', 'carol'])
    })

    test('a top-level post still tells the host and every member but the author', async () => {
      const { deps, notes } = fakeDeps({ members })
      await addChallengeComment(deps, 'bob', body)
      expect(notes.map((n) => [n.user, n.type])).toEqual([
        ['alice', 'challenge_comment'],
        ['carol', 'challenge_comment'],
        ['dan', 'challenge_comment'],
      ])
    })

    test('setChallengePostFollowing: a member follows a top-level post by its Note id', async () => {
      const { deps, followSets } = fakeDeps({ byId: [root, earlier], members })
      expect(await setChallengePostFollowing(deps, 'bob', URL, root.id, true)).toEqual({
        following: true,
        ok: true,
      })
      expect(followSets).toEqual([{ following: true, uri: root.object_uri, user: 'bob' }])
    })

    test('setChallengePostFollowing refuses a visitor, a reply and an unknown entry', async () => {
      const { deps, followSets } = fakeDeps({ byId: [root, earlier], members })
      expect(await setChallengePostFollowing(deps, 'zed', URL, root.id, true)).toMatchObject({ status: 403 })
      expect(await setChallengePostFollowing(deps, 'bob', URL, earlier.id, true)).toMatchObject({
        status: 400,
      })
      expect(await setChallengePostFollowing(deps, 'bob', URL, POST_ID, true)).toMatchObject({ status: 404 })
      expect(followSets).toEqual([])
    })

    test('setChallengePostFollowing for a thread hosted elsewhere goes to the remote branch', async () => {
      const { branch, calls } = remoteBranch()
      const { deps } = fakeDeps({ remote: branch })
      await setChallengePostFollowing(deps, 'bob', OTHER_URL, 'e1', false)
      expect(calls).toEqual([`follow bob ${OTHER_URL} e1 false`])
    })

    test('the thread read carries following on top-level entries for participants only', async () => {
      const { deps } = fakeDeps({ members, replies: [earlier], tops: [root] })
      const following = async (viewer: string) => {
        const result = await readChallengeThread(deps, viewer, URL)
        return result.ok
          ? result.entries.map((e) => [e.following, e.replies.map((r) => 'following' in r)])
          : result
      }
      expect(await following('dan')).toEqual([[true, [false]]])
      expect(await following('bob')).toEqual([[false, [false]]])
      expect(await following('zed')).toEqual([[undefined, [false]]])
    })
  })
})

describe('reading a hosted thread', () => {
  const top = entry({ id: 't1', object_uri: `${WEB}/users/bob/feed/t1` })
  const replyTo = (n: number, hidden = false) =>
    entry({
      hidden_at: hidden ? new Date() : null,
      id: `r${n}`,
      in_reply_to_uri: top.object_uri,
      object_uri: `${WEB}/users/bob/feed/r${n}`,
      published_at: new Date(Date.UTC(2026, 9, 6, 0, 0, n)),
      root_entry_id: 't1',
    })

  test('hidden replies do not use up the reply cap of a member', async () => {
    const replies = [
      ...Array.from({ length: 5 }, (_, i) => replyTo(i, true)),
      ...Array.from({ length: MAX_REPLIES_PER_ENTRY + 5 }, (_, i) => replyTo(100 + i)),
    ]
    const shown = assembleThread([top], replies, () => null, false)[0]?.replies ?? []
    expect(shown).toHaveLength(MAX_REPLIES_PER_ENTRY)
    expect(shown[0]?.id).toBe('r100')
    expect(assembleThread([top], replies, () => null, true)[0]?.replies).toHaveLength(MAX_REPLIES_PER_ENTRY)
  })
})
