import { Add, Create, Delete, Mention, Note, Remove, Tombstone, Update } from '@fedify/fedify/vocab'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { RaiseNotificationInput } from '../notifications.ts'

import {
  getThreadCopyEntryByObjectUri,
  listThreadCopy,
  updateParticipationThreadState,
  upsertThreadCopyEntry,
} from '../../db/challenge-thread-copy.ts'
import { getChallengeThreadEntryByObjectUri, upsertChallengeThreadEntry } from '../../db/challenge-thread.ts'
import {
  createChallenge,
  createChallengeParticipation,
  getParticipationById,
  upsertChallengeMember,
} from '../../db/challenges.ts'
import { createReplyPost } from '../../db/feed.ts'
import { listNotifications } from '../../db/notifications.ts'
import { listTimelineEntries } from '../../db/timeline.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { actorDocument, inboxContext } from '../../test/inbox-context.ts'
import { createInboundThreadDeps, type InboundThreadDeps } from '../challenge-thread-inbound.ts'
import {
  createFeedFederation,
  handleInboundAdd,
  handleInboundCreate,
  handleInboundDelete,
  handleInboundRemove,
  handleInboundUpdate,
} from './federation.ts'
import { AS_PUBLIC } from './object.ts'
import { dateToTemporalInstant } from './temporal-interop.ts'

const CONTAINER_TIMEOUT = 120_000
const ORIGIN = 'https://aurboda.example'
const CAROL = 'https://third.example/users/carol'
const DAVE = 'https://third.example/users/dave'
const CAROL_NOTE = 'https://third.example/notes/1'

const fed = createFeedFederation(ORIGIN, `${ORIGIN}/api`)

const fediverse = () => ({
  [CAROL]: actorDocument(CAROL, 'carol', 'Carol'),
  [DAVE]: actorDocument(DAVE, 'dave', 'Dave'),
})

const inboxCtx = (user: string) => inboxContext(fed, ORIGIN, user, fediverse())

const newChallenge = (user: string) =>
  createChallenge(user, {
    announce_winner: false,
    end_ts: new Date('2026-12-01T00:00:00Z'),
    is_public: true,
    name: 'Steps',
    spec: {
      activity_type_id: null,
      aggregation: 'sum',
      bucket_size: '1d',
      filter_field: null,
      filter_value: null,
      measure: null,
      pattern: 'steps',
      source_type: 'metric',
      unit: 'steps',
    },
    start_ts: new Date('2026-11-01T00:00:00Z'),
    timezone: 'UTC',
  })

const carolsNote = (target: string, mentioned: string, content: string, updated?: Date) =>
  new Note({
    attribution: new URL(CAROL),
    ccs: [new URL(mentioned)],
    content,
    id: new URL(CAROL_NOTE),
    published: dateToTemporalInstant(new Date('2026-11-10T10:00:00Z')),
    replyTarget: new URL(target),
    tags: [new Mention({ href: new URL(mentioned), name: '@someone@aurboda.example' })],
    tos: [new URL(AS_PUBLIC)],
    ...(updated == null ? {} : { updated: dateToTemporalInstant(updated) }),
  })

const createOf = (note: Note) =>
  new Create({ actor: new URL(CAROL), id: new URL(`${CAROL_NOTE}#create`), object: note })

const deleteBy = (actor: string) =>
  new Delete({
    actor: new URL(actor),
    id: new URL(`${CAROL_NOTE}#delete`),
    object: new Tombstone({ id: new URL(CAROL_NOTE) }),
  })

const notificationTypes = async (user: string) =>
  (await listNotifications(user, { limit: 50 })).map((n) => n.type)

describe('Inbound challenge thread comments', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const hostedThread = async () => {
    const host = getTestUser()
    const challenge = await newChallenge(host)
    const objectUri = `${ORIGIN}/users/${host}/challenges/${challenge.slug}`
    const hostActor = `${ORIGIN}/users/${host}`
    await handleInboundCreate(
      inboxCtx(host),
      createOf(carolsNote(objectUri, hostActor, '<p>Go team!</p>')),
      ORIGIN,
    )
    return { challenge, host, hostActor, objectUri }
  }

  test('a Create answering the challenge enters the host thread with one notification', async () => {
    const { challenge, host, objectUri } = await hostedThread()
    const entry = await getChallengeThreadEntryByObjectUri(host, CAROL_NOTE)
    expect(entry).toMatchObject({
      actor_uri: CAROL,
      audience: 'public',
      challenge_id: challenge.id,
      content: '<p>Go team!</p>',
      display_name: 'Carol',
      in_reply_to_uri: objectUri,
      kind: 'comment',
      root_entry_id: null,
    })
    expect(await notificationTypes(host)).toEqual(['challenge_comment'])
    expect((await listTimelineEntries(host, 10)).map((e) => e.object_uri)).toEqual([CAROL_NOTE])
  })

  test('an Update rewrites the entry without another notification', async () => {
    const { host, hostActor, objectUri } = await hostedThread()
    const edited = new Date('2026-11-10T11:00:00Z')
    await handleInboundUpdate(
      inboxCtx(host),
      new Update({
        actor: new URL(CAROL),
        id: new URL(`${CAROL_NOTE}#update`),
        object: carolsNote(objectUri, hostActor, '<p>Go team, go!</p>', edited),
      }),
      ORIGIN,
    )
    expect(await getChallengeThreadEntryByObjectUri(host, CAROL_NOTE)).toMatchObject({
      content: '<p>Go team, go!</p>',
      edited_at: edited,
    })
    expect(await notificationTypes(host)).toEqual(['challenge_comment'])
  })

  test('a Delete from the author removes the entry', async () => {
    const { host } = await hostedThread()
    await handleInboundDelete(inboxCtx(host), deleteBy(CAROL), ORIGIN)
    expect(await getChallengeThreadEntryByObjectUri(host, CAROL_NOTE)).toBeNull()
  })

  test('a failing copy delete does not skip the later steps, and still surfaces', async () => {
    const { host } = await hostedThread()
    const failing = {
      deleteCopy: async () => {
        throw new Error('copy delete failed')
      },
    }
    await expect(
      handleInboundDelete(inboxCtx(host), deleteBy(CAROL), ORIGIN, createInboundThreadDeps(ORIGIN), failing),
    ).rejects.toThrow('copy delete failed')
    expect(await getChallengeThreadEntryByObjectUri(host, CAROL_NOTE)).toBeNull()
    expect(await listTimelineEntries(host, 10)).toEqual([])
  })

  test('a Delete from another actor leaves the entry', async () => {
    const { host } = await hostedThread()
    await handleInboundDelete(inboxCtx(host), deleteBy(DAVE), ORIGIN)
    expect(await getChallengeThreadEntryByObjectUri(host, CAROL_NOTE)).not.toBeNull()
  })

  test('a reply to a local member’s comment, in the member’s inbox, enters the host thread', async () => {
    const member = getTestUser()
    const host = 'hostess'
    const challenge = await newChallenge(member)
    const objectUri = `${ORIGIN}/users/${host}/challenges/${challenge.slug}`
    await upsertChallengeMember(member, challenge.id, {
      display_name: 'Member',
      identity_base_url: `${ORIGIN}/u/${member}`,
      kind: 'local',
      local_user: member,
    })
    const post = await createReplyPost(member, {
      challenge_uri: objectUri,
      in_reply_to_actor_uri: `${ORIGIN}/users/${host}`,
      in_reply_to_uri: objectUri,
      message: 'Day one done',
      visibility: 'unlisted',
    })
    const memberComment = `${ORIGIN}/users/${member}/feed/${post.id}`
    const parent = (await upsertChallengeThreadEntry(member, {
      actor_uri: `${ORIGIN}/users/${member}`,
      audience: 'public',
      avatar_url: null,
      challenge_id: challenge.id,
      content: '<p>Day one done</p>',
      display_name: null,
      edited_at: null,
      handle: null,
      images: [],
      in_reply_to_uri: objectUri,
      kind: 'comment',
      object_uri: memberComment,
      published_at: post.created_at,
      root_entry_id: null,
      url: null,
    }))!.entry

    // Host and member share this test's one database: every per-user lookup is routed to it.
    const real = createInboundThreadDeps(ORIGIN)
    const notified: { user: string; input: RaiseNotificationInput }[] = []
    const oneDb =
      <A extends unknown[], R>(fn: (user: string, ...args: A) => R) =>
      (_user: string, ...args: A): R =>
        fn(member, ...args)
    const deps: InboundThreadDeps = {
      ...real,
      countByActorSince: oneDb(real.countByActorSince),
      countEntries: oneDb(real.countEntries),
      deleteEntriesByActor: oneDb(real.deleteEntriesByActor),
      deleteEntry: oneDb(real.deleteEntry),
      getChallengeById: oneDb(real.getChallengeById),
      getEntryByObjectUri: oneDb(real.getEntryByObjectUri),
      getFeedPost: oneDb(real.getFeedPost),
      getTimelineEntry: oneDb(real.getTimelineEntry),
      listMembers: oneDb(real.listMembers),
      loadChallenge: oneDb(real.loadChallenge),
      notify: async (user, input) => {
        notified.push({ input, user })
      },
      upsert: oneDb(real.upsert),
    }

    await handleInboundCreate(
      inboxCtx(member),
      createOf(carolsNote(memberComment, `${ORIGIN}/users/${member}`, '<p>Nice!</p>')),
      ORIGIN,
      undefined,
      undefined,
      deps,
    )
    expect(await getChallengeThreadEntryByObjectUri(member, CAROL_NOTE)).toMatchObject({
      actor_uri: CAROL,
      in_reply_to_uri: memberComment,
      root_entry_id: parent.id,
    })
    expect(notified.map((n) => n.user).sort()).toEqual([host, member].sort())
    expect(await notificationTypes(member)).toEqual([])
    expect((await listTimelineEntries(member, 10)).map((e) => e.object_uri)).toEqual([CAROL_NOTE])
  })
})

describe('Host signals for a challenge joined on another server', () => {
  const HOST_ACTOR = 'https://host.example/users/freja'
  const OBJECT_URI = 'https://host.example/users/freja/challenges/nov'
  const HOST_NOTE = 'https://host.example/users/freja/feed/1'

  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const joined = async () => {
    const user = getTestUser()
    const participation = await createChallengeParticipation(user, {
      challenge_url: 'https://host.example/u/freja/nov',
      end_ts: new Date('2026-12-01T00:00:00Z'),
      host_identity: 'https://host.example/u/freja',
      name: 'Nov',
      spec: {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        filter_field: null,
        filter_value: null,
        measure: null,
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      start_ts: new Date('2026-11-01T00:00:00Z'),
      timezone: 'UTC',
    })
    await updateParticipationThreadState(user, participation.id, {
      challenge_object_uri: OBJECT_URI,
      host_actor_uri: HOST_ACTOR,
      thread_synced_at: new Date(),
    })
    await upsertThreadCopyEntry(user, participation.id, {
      actor_uri: CAROL,
      audience: 'participants',
      avatar_url: null,
      content: '<p>spam</p>',
      display_name: 'Carol',
      edited_at: null,
      handle: null,
      images: [],
      in_reply_to_uri: OBJECT_URI,
      kind: 'comment',
      object_uri: CAROL_NOTE,
      published_at: new Date('2026-11-10T10:00:00Z'),
      url: null,
    })
    return { participation, user }
  }

  const fromHost = { actor: new URL(HOST_ACTOR), object: new URL(CAROL_NOTE), target: new URL(OBJECT_URI) }
  const syncedAt = async (user: string, id: string) =>
    (await getParticipationById(user, id))?.thread_synced_at ?? null

  test("the host's Remove drops another author's row and marks the copy stale", async () => {
    const { participation, user } = await joined()
    await handleInboundRemove(
      inboxCtx(user),
      new Remove({ ...fromHost, id: new URL(`${HOST_ACTOR}#removes/1`) }),
    )
    expect(await getThreadCopyEntryByObjectUri(user, participation.id, CAROL_NOTE)).toBeNull()
    expect(await syncedAt(user, participation.id)).toBeNull()
  })

  test("the host's Add marks the copy stale and keeps the rows", async () => {
    const { participation, user } = await joined()
    await handleInboundAdd(inboxCtx(user), new Add({ ...fromHost, id: new URL(`${HOST_ACTOR}#adds/1`) }))
    expect(await listThreadCopy(user, participation.id)).toHaveLength(1)
    expect(await syncedAt(user, participation.id)).toBeNull()
  })

  test('a Remove or Add from anyone else, or of another target, is ignored', async () => {
    const { participation, user } = await joined()
    await handleInboundRemove(inboxCtx(user), new Remove({ ...fromHost, actor: new URL(CAROL) }))
    await handleInboundAdd(inboxCtx(user), new Add({ ...fromHost, actor: new URL(CAROL) }))
    await handleInboundRemove(
      inboxCtx(user),
      new Remove({ ...fromHost, object: new URL(HOST_NOTE), target: new URL(`${HOST_ACTOR}/featured`) }),
    )
    expect(await listThreadCopy(user, participation.id)).toHaveLength(1)
    expect(await syncedAt(user, participation.id)).not.toBeNull()
  })
})
