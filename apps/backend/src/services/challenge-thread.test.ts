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
  isThreadParticipant,
  MAX_THREAD_ENTRIES,
  OTHER_SERVER_MESSAGE,
  ownPostIdOf,
  parseChallengeObjectUrl,
  parseChallengePageUrl,
  readableAudiences,
  resolveHostedChallenge,
  type ThreadCandidate,
  threadVisibilityLocked,
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
      title: 'Bob commented in Push-ups',
      type: 'challenge_comment',
    })
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
    over: { count?: number; members?: ChallengeMemberRecord[]; upsertFails?: boolean } = {},
  ) => {
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
      deleteEntry: async () => null,
      deletePost: async (_user, id) => {
        deleted.push(id)
      },
      deliver: { createdReply: (_user, record) => delivered.push(record.id) },
      getEntryById: async () => null,
      getEntryByObjectUri: async () => null,
      getOwnPost: async () => null,
      listMembers: async () => over.members ?? MEMBERS,
      listReplies: async () => [],
      listTopLevel: async () => [],
      loadChallenge: async () => challenge(),
      notify: async (user) => {
        notified.push(user)
      },
      presentation: async (user) => ({
        avatar_url: null,
        display_name: null,
        handle: `@${user}@aurboda.test`,
      }),
      resolveTags: async () => [],
      setHidden: async () => null,
      upsert: async (_host, input) => {
        upserts.push(input)
        return over.upsertFails ? null : { entry: entry({ ...input, id: 'new' }), inserted: true }
      },
      webHost: WEB,
    }
    return { created, deleted, delivered, deps, notified, upserts }
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
})
