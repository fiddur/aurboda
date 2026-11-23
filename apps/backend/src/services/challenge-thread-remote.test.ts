import type { QuantChallengeThread, QuantChallengeThreadItem } from '@aurboda/api-spec'

import { Note } from '@fedify/fedify/vocab'
import { describe, expect, test } from 'vitest'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeThreadEntryRecord,
  FeedPostRecord,
  ParticipationThreadState,
  ReplyPostInput,
  ThreadCopyEntryInput,
  ThreadCopyEntryRecord,
} from '../db/index.ts'
import type { RaiseNotificationInput } from './notifications.ts'

import { AS_PUBLIC } from './activitypub/object.ts'
import { dateToTemporalInstant } from './activitypub/temporal-interop.ts'
import {
  addRemoteChallengeComment,
  admitPushedThreadNote,
  applyHostThreadSignal,
  buildThreadDocument,
  copyRowFromItem,
  followRemoteCommentDelete,
  followRemoteCommentEdit,
  FORCED_PULL_MIN_INTERVAL_MS,
  HOST_UNREACHABLE_MESSAGE,
  memberRecipients,
  NO_REMOTE_THREAD_MESSAGE,
  NOT_JOINED_MESSAGE,
  OWN_PENDING_KEEP_MS,
  type PushedThreadDeps,
  readRemoteThread,
  setRemotePostFollowing,
  type RemoteThreadDeps,
  syncRemoteThread,
  THREAD_COPY_MAX_AGE_MS,
  THREAD_DOCUMENT_LIMIT,
  threadAttendees,
  type ThreadDocumentDeps,
} from './challenge-thread-remote.ts'

const HOST_WEB = 'https://host.example'
const HOME = 'https://home.example'
const HOST_ACTOR = `${HOST_WEB}/users/freja`
const OBJECT_URI = `${HOST_WEB}/users/freja/challenges/nov`
const THREAD_URL = `${OBJECT_URI}/thread`
const CHALLENGE_URL = `${HOST_WEB}/u/freja/nov`
const OLA = `${HOME}/users/ola`
const ZED = 'https://far.example/users/zed'
const NOW = Date.parse('2026-11-10T12:00:00Z')
const POST_ID = '11111111-1111-4111-8111-111111111111'

const challenge = (over: Partial<ChallengeRecord> = {}): ChallengeRecord => ({
  announce_winner: false,
  banner_updated_at: null,
  created_at: new Date('2026-10-01T00:00:00Z'),
  end_ts: new Date('2026-12-01T00:00:00Z'),
  id: 'c1',
  is_public: true,
  join_token: 'jt',
  name: 'November',
  result_published_at: null,
  slug: 'nov',
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
  start_ts: new Date('2026-11-01T00:00:00Z'),
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
  identity_base_url: `${HOST_WEB}/u/bob`,
  joined_at: new Date('2026-10-02T00:00:00Z'),
  kind: 'local',
  last_error: null,
  last_fetched_at: null,
  local_user: 'bob',
  status: 'active',
  ...over,
})

const hostEntry = (over: Partial<ChallengeThreadEntryRecord> = {}): ChallengeThreadEntryRecord => ({
  actor_uri: `${HOST_WEB}/users/bob`,
  audience: 'public',
  avatar_url: 'https://host.example/u/bob/avatar.png',
  challenge_id: 'c1',
  content: '<p>hi</p>',
  created_at: new Date('2026-11-05T00:00:00Z'),
  display_name: 'Bob',
  edited_at: null,
  handle: '@bob@host.example',
  hidden_at: null,
  id: 'e1',
  images: [],
  in_reply_to_uri: OBJECT_URI,
  kind: 'comment',
  object_uri: `${HOST_WEB}/users/bob/feed/1`,
  published_at: new Date('2026-11-05T00:00:00Z'),
  root_entry_id: null,
  url: null,
  ...over,
})

const ENTRIES = [
  hostEntry({ audience: 'participants', id: 'e2', object_uri: `${HOST_WEB}/users/bob/feed/2` }),
  hostEntry({
    id: 'e1',
    images: [{ height: 10, media_type: 'image/png', url: 'https://host.example/a.png', width: 20 }],
  }),
]

const documentDeps = (members: ChallengeMemberRecord[]) => {
  const verified: [string, string, string][] = []
  const asked: { audiences: readonly string[]; limit: number }[] = []
  const deps: ThreadDocumentDeps = {
    listDocumentEntries: async (_host, _id, audiences, limit) => {
      asked.push({ audiences, limit })
      return ENTRIES.filter((entry) => audiences.includes(entry.audience)).slice(0, limit)
    },
    listMembers: async () => members,
    markVerified: async (host, memberId, actor) => {
      verified.push([host, memberId, actor])
    },
    webHost: HOST_WEB,
  }
  return { asked, deps, verified }
}

const REMOTE_OLA = member({
  actor: OLA,
  id: 'm-ola',
  identity_base_url: `${HOME}/u/ola`,
  kind: 'remote',
  local_user: null,
})

describe('buildThreadDocument', () => {
  test('a verified member gets every visible entry, the member audiences and the attendees', async () => {
    const members = [member({ local_user: 'bob' }), { ...REMOTE_OLA, actor_verified_at: new Date() }]
    const { asked, deps, verified } = documentDeps(members)
    const document = await buildThreadDocument(deps, 'freja', challenge(), OLA)
    expect(verified).toEqual([['freja', 'm-ola', OLA]])
    expect(asked).toEqual([{ audiences: ['public', 'participants'], limit: THREAD_DOCUMENT_LIMIT }])
    expect(document).toMatchObject({
      attendees: [HOST_ACTOR, `${HOST_WEB}/users/bob`, OLA],
      audiences: ['public', 'participants'],
      challenge: OBJECT_URI,
      host: HOST_ACTOR,
      kind: 'challengeThread',
    })
    expect(document.items.map((item) => item.id)).toEqual(ENTRIES.map((entry) => entry.object_uri))
    expect(document.items[1]).toEqual({
      attachment: [{ height: 10, mediaType: 'image/png', url: 'https://host.example/a.png', width: 20 }],
      attributedTo: {
        handle: '@bob@host.example',
        icon: 'https://host.example/u/bob/avatar.png',
        id: `${HOST_WEB}/users/bob`,
        name: 'Bob',
      },
      audience: 'public',
      content: '<p>hi</p>',
      id: `${HOST_WEB}/users/bob/feed/1`,
      inReplyTo: OBJECT_URI,
      published: '2026-11-05T00:00:00.000Z',
      type: 'comment',
      updated: null,
      url: null,
    })
  })

  test('an unverified member is verified by the signed request, by actor or by identity', async () => {
    const byIdentity = member({ actor: null, id: 'm-id', identity_base_url: `${HOME}/u/ola`, kind: 'remote' })
    const { deps, verified } = documentDeps([byIdentity])
    const document = await buildThreadDocument(deps, 'freja', challenge({ is_public: false }), OLA)
    expect(verified).toEqual([['freja', 'm-id', OLA]])
    expect(document.audiences).toEqual(['participants'])
    expect(document.attendees).toEqual([HOST_ACTOR, OLA])
  })

  test('a stranger reads the public entries of a public challenge, with no attendees', async () => {
    const { deps, verified } = documentDeps([REMOTE_OLA])
    const document = await buildThreadDocument(deps, 'freja', challenge(), ZED)
    expect(verified).toEqual([])
    expect(document.audiences).toEqual(['public'])
    expect(document.attendees).toBeUndefined()
    expect(document.items.map((item) => item.audience)).toEqual(['public'])
    const unsigned = await buildThreadDocument(deps, 'freja', challenge(), null)
    expect(unsigned.items).toHaveLength(1)
  })

  test('a stranger on an unlisted challenge reads nothing and may post nothing', async () => {
    const { deps } = documentDeps([])
    const document = await buildThreadDocument(deps, 'freja', challenge({ is_public: false }), ZED)
    expect(document).toMatchObject({ audiences: [], items: [] })
  })

  test('a withdrawn member is a stranger', async () => {
    const { deps, verified } = documentDeps([{ ...REMOTE_OLA, status: 'withdrawn' }])
    expect((await buildThreadDocument(deps, 'freja', challenge(), OLA)).attendees).toBeUndefined()
    expect(verified).toEqual([])
  })
})

describe('threadAttendees', () => {
  test('the host, active local members and verified remote ones, once each', () => {
    expect(
      threadAttendees(HOST_WEB, 'freja', [
        member({ local_user: 'freja' }),
        member({ local_user: 'bob' }),
        member({ local_user: 'gone', status: 'withdrawn' }),
        { ...REMOTE_OLA, actor_verified_at: new Date() },
        member({
          actor: ZED,
          identity_base_url: 'https://far.example/u/zed',
          kind: 'remote',
          local_user: null,
        }),
        member({
          actor: null,
          actor_verified_at: new Date(),
          identity_base_url: 'https://third.example/u/kim',
          kind: 'remote',
          local_user: null,
        }),
      ]),
    ).toEqual([HOST_ACTOR, `${HOST_WEB}/users/bob`, OLA, 'https://third.example/users/kim'])
  })
})

const participation = (over: Partial<ChallengeParticipationRecord> = {}): ChallengeParticipationRecord => ({
  challenge_object_uri: OBJECT_URI,
  challenge_url: CHALLENGE_URL,
  created_at: new Date('2026-11-01T00:00:00Z'),
  data_token: 'dtok',
  end_ts: new Date('2026-12-01T00:00:00Z'),
  host_actor_uri: HOST_ACTOR,
  host_checked_at: null,
  host_identity: `${HOST_WEB}/u/freja`,
  id: 'p1',
  name: 'November',
  protocol: 'quantpub',
  spec: challenge().spec,
  start_ts: new Date('2026-11-01T00:00:00Z'),
  status: 'active',
  thread_attendees: [HOST_ACTOR, OLA, ZED],
  thread_audiences: ['public', 'participants'],
  thread_synced_at: new Date(NOW - 60_000),
  thread_url: THREAD_URL,
  timezone: 'UTC',
  ...over,
})

let ids = 0
const copyRow = (over: Partial<ThreadCopyEntryRecord> = {}): ThreadCopyEntryRecord => ({
  actor_uri: HOST_ACTOR,
  audience: 'participants',
  avatar_url: null,
  content: '<p>hi</p>',
  created_at: new Date(NOW),
  display_name: 'Freja',
  edited_at: null,
  handle: '@freja@host.example',
  id: `00000000-0000-4000-8000-${String(++ids).padStart(12, '0')}`,
  images: [],
  in_reply_to_uri: OBJECT_URI,
  kind: 'comment',
  object_uri: `${HOST_WEB}/users/freja/feed/${ids}`,
  participation_id: 'p1',
  published_at: new Date(NOW - ids * 60_000),
  url: null,
  ...over,
})

const item = (over: Partial<QuantChallengeThreadItem> = {}): QuantChallengeThreadItem => ({
  attributedTo: { handle: '@freja@host.example', icon: null, id: HOST_ACTOR, name: 'Freja' },
  audience: 'participants',
  content: '<p>Go <script>x</script>team</p>',
  id: `${HOST_WEB}/users/freja/feed/a`,
  inReplyTo: OBJECT_URI,
  published: '2026-11-09T10:00:00.000Z',
  type: 'comment',
  ...over,
})

const threadDocument = (over: Partial<QuantChallengeThread> = {}): QuantChallengeThread => ({
  attendees: [HOST_ACTOR, OLA, ZED, ZED],
  audiences: ['participants'],
  challenge: OBJECT_URI,
  host: HOST_ACTOR,
  items: [item()],
  kind: 'challengeThread',
  ...over,
})

const replyPost = (input: ReplyPostInput): FeedPostRecord => ({
  activity_id: null,
  article: null,
  autoshare_rule_id: null,
  challenge: null,
  challenge_uri: input.challenge_uri ?? null,
  created_at: new Date(NOW),
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
  updated_at: new Date(NOW),
  visibility: input.visibility,
})

const toRecord = (
  participationId: string,
  input: ThreadCopyEntryInput,
  id: string,
): ThreadCopyEntryRecord => ({
  ...input,
  created_at: new Date(NOW),
  id,
  participation_id: participationId,
})

const remoteDeps = (
  over: {
    participation?: ChallengeParticipationRecord | null
    copy?: ThreadCopyEntryRecord[]
    fetchThread?: RemoteThreadDeps['fetchThread'] | null
    document?: Awaited<ReturnType<RemoteThreadDeps['fetchDocument']>>
    follows?: Record<string, boolean>
  } = {},
) => {
  const follows = new Map(Object.entries(over.follows ?? {}))
  let current = over.participation === undefined ? participation() : over.participation
  let copy = [...(over.copy ?? [])]
  const fetched: string[] = []
  const states: ParticipationThreadState[] = []
  const created: ReplyPostInput[] = []
  const delivered: string[] = []
  const pushes: { change: string; recipients: string[] }[] = []
  const deleted: [string, string][] = []
  const posts = new Map<string, FeedPostRecord>()
  const deps: RemoteThreadDeps = {
    createReplyPost: async (_user, input) => {
      created.push(input)
      const post = replyPost(input)
      posts.set(post.id, post)
      return post
    },
    deleteCopy: async (_user, objectUri, actorUri) => {
      deleted.push([objectUri, actorUri])
      copy = copy.filter((row) => !(row.object_uri === objectUri && row.actor_uri === actorUri))
    },
    deliver: { createdReply: (_user, post) => delivered.push(post.id) },
    fetchDocument: async () => over.document ?? null,
    followChoices: async (_user, uris) =>
      new Map(uris.flatMap((uri) => (follows.has(uri) ? [[uri, follows.get(uri) === true] as const] : []))),
    ...(over.fetchThread === null
      ? {}
      : {
          fetchThread:
            over.fetchThread ??
            (async (_user, url) => {
              fetched.push(url)
              return threadDocument()
            }),
        }),
    getCopyById: async (_user, id) => copy.find((row) => row.id === id) ?? null,
    getCopyByObjectUri: async (_user, pid, objectUri) =>
      copy.find((row) => row.participation_id === pid && row.object_uri === objectUri) ?? null,
    getOwnPost: async (_user, id) => posts.get(id) ?? null,
    getParticipationByObjectUri: async (_user, objectUri) =>
      current?.challenge_object_uri === objectUri ? current : null,
    getParticipationByUrl: async (_user, url) => (current?.challenge_url === url ? current : null),
    listCopy: async () => copy,
    now: () => NOW,
    presentation: async (user) => ({
      avatar_url: null,
      display_name: 'Ola',
      handle: `@${user}@home.example`,
    }),
    push: (_user, _post, change, recipients) => pushes.push({ change, recipients }),
    replaceCopy: async (_user, pid, rows) => {
      copy = rows.map((row, i) =>
        toRecord(pid, row, `00000000-0000-4000-9000-${String(i).padStart(12, '0')}`),
      )
    },
    resolveTags: async () => [],
    setFollow: async (_user, uri, following) => {
      follows.set(uri, following)
    },
    updateThreadState: async (_user, _id, state) => {
      states.push(state)
      if (current == null) return null
      current = { ...current, ...(state as Partial<ChallengeParticipationRecord>) }
      return current
    },
    upsertCopy: async (_user, pid, input) => {
      const existing = copy.find((row) => row.participation_id === pid && row.object_uri === input.object_uri)
      const entry = toRecord(pid, input, existing?.id ?? '22222222-2222-4222-8222-222222222222')
      copy = [...copy.filter((row) => row !== existing), entry]
      return { entry, inserted: existing == null }
    },
    webHost: HOME,
  }
  const removeCopy = async (_user: string, pid: string, objectUri: string) => {
    copy = copy.filter((row) => !(row.participation_id === pid && row.object_uri === objectUri))
  }
  return {
    copy: () => copy,
    created,
    current: () => current,
    delivered,
    deleted,
    deps,
    fetched,
    follows,
    posts,
    pushes,
    removeCopy,
    states,
  }
}

describe('copyRowFromItem', () => {
  test('sanitises, keeps https images and http(s) links, clamps times', () => {
    const row = copyRowFromItem(
      item({
        attachment: [
          { url: 'http://host.example/insecure.png' },
          { mediaType: 'image/png', name: 'chart', url: 'https://host.example/chart.png', width: 10 },
        ],
        published: '2030-01-01T00:00:00Z',
        updated: '2031-01-01T00:00:00Z',
        url: 'javascript:alert(1)',
      }),
      NOW,
    )
    expect(row).toMatchObject({
      content: '<p>Go team</p>',
      edited_at: new Date(NOW),
      images: [{ media_type: 'image/png', name: 'chart', url: 'https://host.example/chart.png', width: 10 }],
      published_at: new Date(NOW),
      url: null,
    })
    expect(copyRowFromItem(item({ url: 'https://host.example/p/1' }), NOW)?.url).toBe(
      'https://host.example/p/1',
    )
    expect(copyRowFromItem(item({ published: 'yesterday' }), NOW)).toBeNull()
  })
})

describe('syncRemoteThread', () => {
  test('replaces the copy with the sanitised items and remembers audiences, attendees and the host', async () => {
    const fake = remoteDeps({ copy: [copyRow({ object_uri: 'https://host.example/gone' })] })
    const updated = await syncRemoteThread(fake.deps, 'ola', participation({ thread_synced_at: null }))
    expect(fake.fetched).toEqual([THREAD_URL])
    expect(fake.copy().map((row) => [row.object_uri, row.content])).toEqual([
      [`${HOST_WEB}/users/freja/feed/a`, '<p>Go team</p>'],
    ])
    expect(fake.states).toEqual([
      {
        host_actor_uri: HOST_ACTOR,
        thread_attendees: [HOST_ACTOR, OLA, ZED],
        thread_audiences: ['participants'],
        thread_synced_at: new Date(NOW),
      },
    ])
    expect(updated.thread_synced_at).toEqual(new Date(NOW))
  })

  test('refuses a document for another challenge or one that does not parse', async () => {
    const other = remoteDeps({ fetchThread: async () => threadDocument({ challenge: `${OBJECT_URI}x` }) })
    await expect(syncRemoteThread(other.deps, 'ola', participation())).rejects.toThrow('another challenge')
    expect(other.states).toEqual([])
    const junk = remoteDeps({ fetchThread: async () => ({ kind: 'nope' }) })
    await expect(syncRemoteThread(junk.deps, 'ola', participation())).rejects.toThrow()
  })

  test("the member's own comment the host has not taken in yet survives a pull while fresh", async () => {
    const own = (minutesAgo: number) =>
      copyRow({
        actor_uri: OLA,
        object_uri: `${HOME}/users/ola/feed/${minutesAgo}`,
        published_at: new Date(NOW - minutesAgo * 60_000),
      })
    const fresh = own(2)
    const stale = own(OWN_PENDING_KEEP_MS / 60_000 + 1)
    const others = copyRow({ object_uri: `${HOST_WEB}/users/freja/feed/gone`, published_at: new Date(NOW) })
    const fake = remoteDeps({ copy: [fresh, stale, others] })
    await syncRemoteThread(fake.deps, 'ola', participation())
    expect(fake.copy().map((row) => row.object_uri)).toEqual([
      `${HOST_WEB}/users/freja/feed/a`,
      fresh.object_uri,
    ])
    expect(fake.copy()[1]).toMatchObject({ actor_uri: OLA, content: fresh.content })
  })

  test('without a thread URL or a way to sign there is nothing to pull', async () => {
    const fake = remoteDeps()
    await expect(syncRemoteThread(fake.deps, 'ola', participation({ thread_url: null }))).rejects.toThrow()
    const unsigned = remoteDeps({ fetchThread: null })
    await expect(syncRemoteThread(unsigned.deps, 'ola', participation())).rejects.toThrow()
  })
})

describe('readRemoteThread', () => {
  test('not joined is a 403', async () => {
    const fake = remoteDeps({ participation: null })
    expect(await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)).toEqual({
      error: NOT_JOINED_MESSAGE,
      ok: false,
      status: 403,
    })
    const withdrawn = remoteDeps({ participation: participation({ status: 'withdrawn' }) })
    expect(await readRemoteThread(withdrawn.deps, 'ola', CHALLENGE_URL)).toMatchObject({ status: 403 })
  })

  test('a host that offers no thread is a 400', async () => {
    const fake = remoteDeps({
      participation: participation({ challenge_object_uri: null, host_actor_uri: null, thread_url: null }),
    })
    expect(await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)).toEqual({
      error: NO_REMOTE_THREAD_MESSAGE,
      ok: false,
      status: 400,
    })
  })

  test('a participation from before is filled in from the challenge document, then pulled', async () => {
    const fake = remoteDeps({
      document: {
        endTime: '2026-12-01T00:00:00Z',
        host: { actor: HOST_ACTOR, name: 'freja', url: `${HOST_WEB}/u/freja` },
        id: OBJECT_URI,
        kind: 'challenge',
        metric: 'steps',
        name: 'November',
        scoring: 'sum',
        startTime: '2026-11-01T00:00:00Z',
        threadUrl: THREAD_URL,
        timezone: 'UTC',
        url: CHALLENGE_URL,
      },
      participation: participation({
        challenge_object_uri: null,
        host_actor_uri: null,
        thread_synced_at: null,
        thread_url: null,
      }),
    })
    const result = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)
    expect(fake.states[0]).toEqual({
      challenge_object_uri: OBJECT_URI,
      host_actor_uri: HOST_ACTOR,
      thread_url: THREAD_URL,
    })
    expect(fake.fetched).toEqual([THREAD_URL])
    expect(result).toMatchObject({ ok: true, total: 1 })
  })

  test('a fresh copy is read as is; a stale one is pulled first', async () => {
    const fresh = remoteDeps({ copy: [copyRow()] })
    expect(await readRemoteThread(fresh.deps, 'ola', `${CHALLENGE_URL}?embed=1`)).toMatchObject({
      ok: true,
      total: 1,
      viewer: { audiences: ['public', 'participants'], can_comment: true, role: 'member' },
    })
    expect(fresh.fetched).toEqual([])

    const stale = remoteDeps({
      participation: participation({ thread_synced_at: new Date(NOW - THREAD_COPY_MAX_AGE_MS - 1) }),
    })
    expect(await readRemoteThread(stale.deps, 'ola', CHALLENGE_URL)).toMatchObject({
      ok: true,
      viewer: { audiences: ['participants'], can_comment: true },
    })
    expect(stale.fetched).toEqual([THREAD_URL])
  })

  test('a failed pull serves the copy there is, and with none at all is a 502', async () => {
    const failing = async () => {
      throw new Error('ECONNREFUSED')
    }
    const withCopy = remoteDeps({
      copy: [copyRow()],
      fetchThread: failing,
      participation: participation({ thread_synced_at: new Date(NOW - THREAD_COPY_MAX_AGE_MS - 1) }),
    })
    expect(await readRemoteThread(withCopy.deps, 'ola', CHALLENGE_URL)).toMatchObject({ ok: true, total: 1 })
    const never = remoteDeps({
      fetchThread: failing,
      participation: participation({ thread_synced_at: null }),
    })
    expect(await readRemoteThread(never.deps, 'ola', CHALLENGE_URL)).toEqual({
      error: HOST_UNREACHABLE_MESSAGE,
      ok: false,
      status: 502,
    })
  })

  test('nests replies two levels under the entry their chain leads to; an unknown parent is top-level', async () => {
    const top = copyRow({ published_at: new Date(NOW - 10 * 60_000) })
    const reply = copyRow({ in_reply_to_uri: top.object_uri, published_at: new Date(NOW - 9 * 60_000) })
    const deeper = copyRow({ in_reply_to_uri: reply.object_uri, published_at: new Date(NOW - 8 * 60_000) })
    const orphan = copyRow({
      in_reply_to_uri: 'https://elsewhere.example/n/1',
      published_at: new Date(NOW - 60_000),
    })
    const share = copyRow({ in_reply_to_uri: null, kind: 'share', published_at: new Date(NOW - 30_000) })
    const fake = remoteDeps({ copy: [deeper, reply, top, orphan, share] })
    const result = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)
    if (!result.ok) throw new Error(result.error)
    expect(result.total).toBe(5)
    expect(result.entries.map((entry) => entry.id)).toEqual([share.id, orphan.id, top.id])
    expect(result.entries[2].replies.map((r) => [r.id, r.in_reply_to_id])).toEqual([
      [reply.id, top.id],
      [deeper.id, reply.id],
    ])
    expect(result.entries.every((entry) => !entry.hidden && entry.in_reply_to_id == null)).toBe(true)
  })

  test('pages the top-level entries twenty at a time', async () => {
    const rows = Array.from({ length: 25 }, () => copyRow())
    const fake = remoteDeps({ copy: rows })
    const first = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)
    if (!first.ok) throw new Error(first.error)
    expect(first.entries).toHaveLength(20)
    expect(first.next_cursor).not.toBeNull()
    const second = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL, first.next_cursor ?? undefined)
    if (!second.ok) throw new Error(second.error)
    expect(second.entries).toHaveLength(5)
    expect(second.next_cursor).toBeNull()
    expect(new Set([...first.entries, ...second.entries].map((entry) => entry.id)).size).toBe(25)
  })

  test("the reader's own entries carry the post id and its message", async () => {
    const own = copyRow({ actor_uri: OLA, object_uri: `${HOME}/users/ola/feed/${POST_ID}` })
    const fake = remoteDeps({ copy: [own, copyRow()] })
    fake.posts.set(
      POST_ID,
      replyPost({
        in_reply_to_actor_uri: HOST_ACTOR,
        in_reply_to_uri: OBJECT_URI,
        message: 'Go!',
        visibility: 'participants',
      }),
    )
    const result = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)
    if (!result.ok) throw new Error(result.error)
    const mine = result.entries.find((entry) => entry.id === own.id)
    expect(mine).toMatchObject({ message: 'Go!', own_post_id: POST_ID })
    expect(result.entries.find((entry) => entry.id !== own.id)?.own_post_id).toBeUndefined()
  })
})

describe('following a post in a joined thread', () => {
  const top = copyRow({ actor_uri: HOST_ACTOR })
  const mine = copyRow({ actor_uri: OLA, in_reply_to_uri: top.object_uri })
  const orphan = copyRow({ actor_uri: ZED, in_reply_to_uri: 'https://gone.example/notes/1' })

  test('the read marks each top-level entry with whether I follow it', async () => {
    const fake = remoteDeps({ copy: [top, mine, orphan], follows: { [orphan.object_uri]: true } })
    const result = await readRemoteThread(fake.deps, 'ola', CHALLENGE_URL)
    expect(result.ok ? result.entries.map((e) => [e.id, e.following]) : result).toEqual([
      [top.id, true],
      [orphan.id, true],
    ])
    const quiet = remoteDeps({ copy: [top, mine], follows: { [top.object_uri]: false } })
    const unfollowed = await readRemoteThread(quiet.deps, 'ola', CHALLENGE_URL)
    expect(unfollowed.ok ? unfollowed.entries.map((e) => e.following) : unfollowed).toEqual([false])
  })

  test('setting a top-level entry stores the choice by its Note id', async () => {
    const fake = remoteDeps({ copy: [top, mine, orphan] })
    expect(await setRemotePostFollowing(fake.deps, 'ola', CHALLENGE_URL, top.id, false)).toEqual({
      following: false,
      ok: true,
    })
    expect(await setRemotePostFollowing(fake.deps, 'ola', CHALLENGE_URL, orphan.id, true)).toMatchObject({
      ok: true,
    })
    expect(fake.follows).toEqual(
      new Map([
        [top.object_uri, false],
        [orphan.object_uri, true],
      ]),
    )
  })

  test('a reply is a 400, an unknown entry a 404, a challenge not joined a 403', async () => {
    const fake = remoteDeps({ copy: [top, mine] })
    expect(await setRemotePostFollowing(fake.deps, 'ola', CHALLENGE_URL, mine.id, true)).toMatchObject({
      status: 400,
    })
    expect(await setRemotePostFollowing(fake.deps, 'ola', CHALLENGE_URL, POST_ID, true)).toMatchObject({
      status: 404,
    })
    const left = remoteDeps({ copy: [top], participation: participation({ status: 'withdrawn' }) })
    expect(await setRemotePostFollowing(left.deps, 'ola', CHALLENGE_URL, top.id, true)).toMatchObject({
      status: 403,
    })
    expect(fake.follows.size).toBe(0)
  })
})

describe('addRemoteChallengeComment', () => {
  const body = { audience: 'participants' as const, challenge_url: CHALLENGE_URL, message: ' Go! ' }

  test('a participants comment: a participants post, a copy row, pushed to the host and attendees only', async () => {
    const fake = remoteDeps()
    const result = await addRemoteChallengeComment(fake.deps, 'ola', body)
    expect(result).toMatchObject({
      entry: { audience: 'participants', message: 'Go!', own_post_id: POST_ID, replies: [] },
      ok: true,
    })
    expect(fake.created[0]).toEqual({
      challenge_uri: OBJECT_URI,
      in_reply_to_actor_uri: HOST_ACTOR,
      in_reply_to_handle: '@freja@host.example',
      in_reply_to_uri: OBJECT_URI,
      message: 'Go!',
      tags: [],
      visibility: 'participants',
    })
    expect(fake.copy()[0]).toMatchObject({
      actor_uri: OLA,
      content: expect.stringContaining('<p>Go!</p>'),
      object_uri: `${HOME}/users/ola/feed/${POST_ID}`,
      url: null,
    })
    expect(fake.delivered).toEqual([])
    expect(fake.pushes).toEqual([{ change: 'create', recipients: [HOST_ACTOR, ZED] }])
  })

  test('a public comment also federates as an ordinary reply', async () => {
    const fake = remoteDeps()
    await addRemoteChallengeComment(fake.deps, 'ola', { ...body, audience: 'public' })
    expect(fake.created[0]?.visibility).toBe('unlisted')
    expect(fake.delivered).toEqual([POST_ID])
    expect(fake.pushes).toHaveLength(1)
    expect(fake.copy()[0]?.url).toBe(`${HOME}/u/ola/posts/${POST_ID}`)
  })

  test('only an audience the host offers', async () => {
    const fake = remoteDeps({ participation: participation({ thread_audiences: ['participants'] }) })
    expect(await addRemoteChallengeComment(fake.deps, 'ola', { ...body, audience: 'public' })).toMatchObject({
      ok: false,
      status: 403,
    })
    expect(fake.created).toEqual([])
  })

  test('a reply answers its copy row, never wider than it', async () => {
    const parent = copyRow({
      actor_uri: ZED,
      handle: '@zed@far.example',
      object_uri: 'https://far.example/n/1',
    })
    const fake = remoteDeps({ copy: [parent] })
    await addRemoteChallengeComment(fake.deps, 'ola', { ...body, in_reply_to_id: parent.id })
    expect(fake.created[0]).toMatchObject({
      in_reply_to_actor_uri: ZED,
      in_reply_to_handle: '@zed@far.example',
      in_reply_to_uri: 'https://far.example/n/1',
    })
    expect(
      await addRemoteChallengeComment(fake.deps, 'ola', {
        ...body,
        audience: 'public',
        in_reply_to_id: parent.id,
      }),
    ).toMatchObject({ ok: false, status: 400 })
    expect(
      await addRemoteChallengeComment(fake.deps, 'ola', {
        ...body,
        in_reply_to_id: '33333333-3333-4333-8333-333333333333',
      }),
    ).toMatchObject({ ok: false, status: 404 })
    const elsewhere = remoteDeps({ copy: [copyRow({ participation_id: 'p2' })] })
    expect(
      await addRemoteChallengeComment(elsewhere.deps, 'ola', {
        ...body,
        in_reply_to_id: elsewhere.copy()[0].id,
      }),
    ).toMatchObject({ ok: false, status: 404 })
  })

  test('not joined is a 403 and posts nothing', async () => {
    const fake = remoteDeps({ participation: null })
    expect(await addRemoteChallengeComment(fake.deps, 'ola', body)).toMatchObject({ ok: false, status: 403 })
    expect(fake.created).toEqual([])
  })
})

describe('edit and delete of a member comment', () => {
  const ownPost = (): FeedPostRecord => ({
    ...replyPost({
      challenge_uri: OBJECT_URI,
      in_reply_to_actor_uri: HOST_ACTOR,
      in_reply_to_uri: OBJECT_URI,
      message: 'Edited',
      visibility: 'participants',
    }),
    updated_at: new Date(NOW + 1000),
  })

  test('an edit re-renders the copy row and pushes the Update', async () => {
    const row = copyRow({
      actor_uri: OLA,
      content: '<p>Go!</p>',
      object_uri: `${HOME}/users/ola/feed/${POST_ID}`,
    })
    const fake = remoteDeps({ copy: [row] })
    await followRemoteCommentEdit(fake.deps, 'ola', ownPost())
    expect(fake.copy()[0]).toMatchObject({
      content: expect.stringContaining('<p>Edited</p>'),
      edited_at: new Date(NOW + 1000),
      id: row.id,
    })
    expect(fake.pushes).toEqual([{ change: 'update', recipients: [HOST_ACTOR, ZED] }])
  })

  test('a delete drops the copy row and pushes the Delete', async () => {
    const fake = remoteDeps({
      copy: [copyRow({ actor_uri: OLA, object_uri: `${HOME}/users/ola/feed/${POST_ID}` })],
    })
    await followRemoteCommentDelete(fake.deps, 'ola', ownPost())
    expect(fake.copy()).toEqual([])
    expect(fake.pushes).toEqual([{ change: 'delete', recipients: [HOST_ACTOR, ZED] }])
  })

  test('a post in no joined thread is left alone', async () => {
    const fake = remoteDeps()
    await followRemoteCommentEdit(fake.deps, 'ola', { ...ownPost(), challenge_uri: 'https://x.example/c' })
    await followRemoteCommentDelete(fake.deps, 'ola', { ...ownPost(), kind: 'activity' })
    expect(fake.pushes).toEqual([])
  })

  test('the recipients never include the author', () => {
    expect(memberRecipients(participation({ thread_attendees: [OLA, ZED, HOST_ACTOR] }), OLA)).toEqual([
      HOST_ACTOR,
      ZED,
    ])
  })
})

describe('admitPushedThreadNote', () => {
  const pushed = (
    over: { actor?: string; id?: string; context?: string | null; public?: boolean; target?: string } = {},
  ): Note => {
    const actor = over.actor ?? HOST_ACTOR
    return new Note({
      attribution: new URL(actor),
      ccs: over.public === true ? [new URL(AS_PUBLIC)] : [],
      content: '<p>Welcome <script>x</script>all</p>',
      ...(over.context === null ? {} : { contexts: [new URL(over.context ?? OBJECT_URI)] }),
      id: new URL(over.id ?? `${new URL(actor).origin}/notes/1`),
      published: dateToTemporalInstant(new Date('2026-11-09T10:00:00Z')),
      replyTarget: new URL(over.target ?? OBJECT_URI),
      tos: [new URL(OLA)],
    })
  }

  const pushedDeps = (
    current: ChallengeParticipationRecord | null = participation(),
    over: { copy?: ThreadCopyEntryRecord[]; follows?: Record<string, boolean> } = {},
  ) => {
    const fake = remoteDeps({ participation: current, ...over })
    const notified: RaiseNotificationInput[] = []
    const deps: PushedThreadDeps = {
      deleteCopy: fake.deps.deleteCopy,
      followChoices: fake.deps.followChoices,
      getCopyByObjectUri: fake.deps.getCopyByObjectUri,
      getParticipationByObjectUri: fake.deps.getParticipationByObjectUri,
      listCopy: fake.deps.listCopy,
      notify: async (_user, input) => {
        notified.push(input)
      },
      now: () => NOW,
      removeCopy: fake.removeCopy,
      updateThreadState: fake.deps.updateThreadState,
      upsertCopy: fake.deps.upsertCopy,
    }
    return { ...fake, deps, notified }
  }

  const admit = (fake: ReturnType<typeof pushedDeps>, note: Note, actor = HOST_ACTOR) =>
    admitPushedThreadNote(fake.deps, {
      actor_uri: actor,
      me: 'ola',
      note,
      origin: HOME,
      presentation: async () => ({ avatar_url: null, display_name: 'Freja', handle: '@freja@host.example' }),
    })

  test("the host's comment enters the copy and notifies once", async () => {
    const fake = pushedDeps()
    expect(await admit(fake, pushed())).toEqual({ quiet: true })
    expect(fake.copy()[0]).toMatchObject({
      actor_uri: HOST_ACTOR,
      audience: 'participants',
      content: '<p>Welcome all</p>',
      object_uri: `${HOST_WEB}/notes/1`,
    })
    expect(fake.notified).toEqual([
      {
        body: 'Welcome all',
        data: { actor_uri: HOST_ACTOR, challenge_url: CHALLENGE_URL },
        dedupe_key: `challenge_comment:${HOST_WEB}/notes/1`,
        link: '/challenges/joined/p1#comments',
        title: 'Freja posted in November',
        type: 'challenge_comment',
      },
    ])
    await admit(fake, pushed())
    expect(fake.notified).toHaveLength(1)
  })

  describe('a pushed reply notifies me only when I follow its root post', () => {
    const myPost = copyRow({
      actor_uri: OLA,
      display_name: 'Ola',
      object_uri: `${HOME}/users/ola/feed/${POST_ID}`,
    })
    const hostPost = copyRow({ actor_uri: HOST_ACTOR, object_uri: `${HOST_WEB}/notes/1` })
    const replyUnder = (root: ThreadCopyEntryRecord) =>
      pushed({ actor: ZED, id: 'https://far.example/notes/7', public: true, target: root.object_uri })

    test('a reply to my post: challenge_reply, worded "your post"', async () => {
      const fake = pushedDeps(participation(), { copy: [myPost] })
      await admit(fake, replyUnder(myPost), ZED)
      expect(fake.copy().find((r) => r.actor_uri === ZED)).toMatchObject({ audience: 'public' })
      expect(fake.notified).toEqual([
        expect.objectContaining({
          dedupe_key: 'challenge_reply:https://far.example/notes/7',
          link: '/challenges/joined/p1#comments',
          title: 'Freja replied to your post in November',
          type: 'challenge_reply',
        }),
      ])
    })

    test("a reply under someone else's post I replied to, deeper in the chain", async () => {
      const mine = copyRow({ actor_uri: OLA, in_reply_to_uri: hostPost.object_uri })
      const zeds = copyRow({ actor_uri: ZED, in_reply_to_uri: mine.object_uri })
      const fake = pushedDeps(participation(), { copy: [hostPost, mine, zeds] })
      await admit(
        fake,
        pushed({ actor: ZED, id: 'https://far.example/notes/8', target: zeds.object_uri }),
        ZED,
      )
      expect(fake.notified.map((n) => [n.type, n.title])).toEqual([
        ['challenge_reply', "Freja replied to Freja's post in November"],
      ])
    })

    test('a post I neither wrote nor replied under: nothing, unless I follow it', async () => {
      const quiet = pushedDeps(participation(), { copy: [hostPost] })
      await admit(quiet, replyUnder(hostPost), ZED)
      expect(quiet.notified).toEqual([])
      const followed = pushedDeps(participation(), {
        copy: [hostPost],
        follows: { [hostPost.object_uri]: true },
      })
      await admit(followed, replyUnder(hostPost), ZED)
      expect(followed.notified.map((n) => n.type)).toEqual(['challenge_reply'])
    })

    test('my own post I unfollowed: nothing', async () => {
      const fake = pushedDeps(participation(), { copy: [myPost], follows: { [myPost.object_uri]: false } })
      await admit(fake, replyUnder(myPost), ZED)
      expect(fake.notified).toEqual([])
    })

    test('the root is not in the copy: the direct parent decides', async () => {
      const missingMine = pushedDeps()
      await admit(missingMine, replyUnder(myPost), ZED)
      expect(missingMine.notified.map((n) => n.title)).toEqual(['Freja replied to your post in November'])
      const missingOther = pushedDeps()
      await admit(missingOther, replyUnder(hostPost), ZED)
      expect(missingOther.notified).toEqual([])
      const followedParent = pushedDeps(participation(), { follows: { [hostPost.object_uri]: true } })
      await admit(followedParent, replyUnder(hostPost), ZED)
      expect(followedParent.notified.map((n) => n.title)).toEqual(['Freja replied to a post in November'])
    })
  })

  test('an unknown sender is not stored and marks the copy stale', async () => {
    const fake = pushedDeps(participation({ thread_synced_at: new Date(NOW - 2 * 60_000) }))
    const stranger = 'https://new.example/users/kim'
    expect(await admit(fake, pushed({ actor: stranger }), stranger)).toBeNull()
    expect(fake.copy()).toEqual([])
    expect(fake.states).toEqual([{ thread_synced_at: null }])
  })

  test('an unknown sender forces at most one pull a minute', async () => {
    const stranger = 'https://new.example/users/kim'
    const recent = pushedDeps(
      participation({ thread_synced_at: new Date(NOW - FORCED_PULL_MIN_INTERVAL_MS) }),
    )
    expect(await admit(recent, pushed({ actor: stranger }), stranger)).toBeNull()
    expect(recent.states).toEqual([])
    const due = pushedDeps(
      participation({ thread_synced_at: new Date(NOW - FORCED_PULL_MIN_INTERVAL_MS - 1) }),
    )
    await admit(due, pushed({ actor: stranger }), stranger)
    expect(due.states).toEqual([{ thread_synced_at: null }])
    const never = pushedDeps(participation({ thread_synced_at: null }))
    await admit(never, pushed({ actor: stranger }), stranger)
    expect(never.states).toEqual([{ thread_synced_at: null }])
  })

  test('authority: the Note lives on the sender host and names the sender', async () => {
    const fake = pushedDeps()
    expect(await admit(fake, pushed({ id: 'https://elsewhere.example/notes/1' }))).toBeNull()
    expect(await admit(fake, pushed({ actor: ZED }))).toBeNull()
    expect(fake.copy()).toEqual([])
  })

  test('a Note in no joined thread, or from me, is not for this path', async () => {
    const fake = pushedDeps()
    expect(await admit(fake, pushed({ context: null }))).toBeNull()
    expect(await admit(fake, pushed({ context: 'https://other.example/c' }))).toBeNull()
    expect(await admit(fake, pushed({ actor: OLA }), OLA)).toBeNull()
    expect(fake.states).toEqual([])
  })

  test("another author's entry is not overwritten", async () => {
    const fake = pushedDeps()
    await admit(fake, pushed({ actor: ZED, id: 'https://far.example/notes/1' }), ZED)
    const other = `${new URL(ZED).origin}/users/eve`
    const current = participation({ thread_attendees: [ZED, other] })
    const second = { ...fake, deps: { ...fake.deps, getParticipationByObjectUri: async () => current } }
    expect(await admit(second, pushed({ actor: other, id: 'https://far.example/notes/1' }), other)).toBeNull()
  })
})

describe('applyHostThreadSignal', () => {
  const zedRow = () => copyRow({ actor_uri: ZED, object_uri: 'https://far.example/notes/9' })

  const signalDeps = () => {
    const row = zedRow()
    const fake = remoteDeps({ copy: [row] })
    const deps = {
      getParticipationByObjectUri: fake.deps.getParticipationByObjectUri,
      removeCopy: fake.removeCopy,
      updateThreadState: fake.deps.updateThreadState,
    }
    return { ...fake, deps, row }
  }

  const signal = (kind: 'add' | 'remove', objectUri: string, actor = HOST_ACTOR, target = OBJECT_URI) => ({
    actor_uri: actor,
    kind,
    me: 'ola',
    object_uri: objectUri,
    target_uri: target,
  })

  test("the host's Remove drops the row whoever wrote it and marks the copy stale", async () => {
    const fake = signalDeps()
    expect(await applyHostThreadSignal(fake.deps, signal('remove', fake.row.object_uri))).toBe(true)
    expect(fake.copy()).toEqual([])
    expect(fake.states).toEqual([{ thread_synced_at: null }])
  })

  test("the host's Add marks the copy stale and keeps the rows", async () => {
    const fake = signalDeps()
    expect(await applyHostThreadSignal(fake.deps, signal('add', fake.row.object_uri))).toBe(true)
    expect(fake.copy()).toHaveLength(1)
    expect(fake.states).toEqual([{ thread_synced_at: null }])
  })

  test('anyone but the host, or an unknown challenge, changes nothing', async () => {
    const fake = signalDeps()
    expect(await applyHostThreadSignal(fake.deps, signal('remove', fake.row.object_uri, ZED))).toBe(false)
    expect(await applyHostThreadSignal(fake.deps, signal('add', fake.row.object_uri, ZED))).toBe(false)
    expect(
      await applyHostThreadSignal(
        fake.deps,
        signal('remove', fake.row.object_uri, HOST_ACTOR, 'https://host.example/users/freja/challenges/x'),
      ),
    ).toBe(false)
    expect(fake.copy()).toHaveLength(1)
    expect(fake.states).toEqual([])
  })

  test('a Remove of a row not in the copy still only marks it stale', async () => {
    const fake = signalDeps()
    expect(await applyHostThreadSignal(fake.deps, signal('remove', 'https://far.example/notes/none'))).toBe(
      true,
    )
    expect(fake.copy()).toHaveLength(1)
  })
})
