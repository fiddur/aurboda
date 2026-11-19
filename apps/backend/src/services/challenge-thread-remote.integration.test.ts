import type { Note } from '@fedify/fedify/vocab'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { FeedPostRecord } from '../db/index.ts'

import { listThreadCopy, updateParticipationThreadState } from '../db/challenge-thread-copy.ts'
import { getChallengeThreadEntryByObjectUri, upsertChallengeThreadEntry } from '../db/challenge-thread.ts'
import {
  createChallenge,
  createChallengeParticipation,
  listChallengeMembers,
  upsertChallengeMember,
} from '../db/challenges.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { buildReplyNote, toDeliverableReply } from './activitypub/deliver.ts'
import { createFeedFederation } from './activitypub/federation.ts'
import { admitInboundThreadNote, createInboundThreadDeps } from './challenge-thread-inbound.ts'
import {
  buildThreadDocument,
  createRemoteThreadBranch,
  createRemoteThreadDeps,
  createThreadDocumentDeps,
} from './challenge-thread-remote.ts'
import { createChallengeThreadDeps, type ThreadPushChange } from './challenge-thread.ts'

const CONTAINER_TIMEOUT = 120_000
const HOST = 'https://host.example'
const HOME = 'https://home.example'

/**
 * A host server and a member's server, each with its own origin. Both run on this test's one
 * database under the one test user, which is the host's username on the host and the member's on
 * the member's server; the thread document and the pushed Note travel between them in-process.
 */
describe('A challenge thread between a host and a member on another server', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('join, pull, read the host’s comment, then comment back into the host’s thread', async () => {
    const user = getTestUser()
    const hostActor = `${HOST}/users/${user}`
    const memberActor = `${HOME}/users/${user}`

    const challenge = await createChallenge(user, {
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
    const objectUri = `${HOST}/users/${user}/challenges/${challenge.slug}`
    const threadUrl = `${objectUri}/thread`
    const challengeUrl = `${HOST}/u/${user}/${challenge.slug}`
    const hostComment = `${HOST}/users/${user}/feed/00000000-0000-4000-8000-000000000001`

    await upsertChallengeMember(user, challenge.id, {
      actor: memberActor,
      display_name: 'Member',
      identity_base_url: `${HOME}/u/${user}`,
      kind: 'remote',
    })
    await upsertChallengeThreadEntry(user, {
      actor_uri: hostActor,
      audience: 'participants',
      avatar_url: null,
      challenge_id: challenge.id,
      content: '<p>Welcome, members</p>',
      display_name: 'Host',
      edited_at: null,
      handle: `@${user}@host.example`,
      images: [],
      in_reply_to_uri: objectUri,
      kind: 'comment',
      object_uri: hostComment,
      published_at: new Date('2026-11-02T00:00:00Z'),
      root_entry_id: null,
      url: null,
    })

    const joined = await createChallengeParticipation(user, {
      challenge_url: challengeUrl,
      end_ts: challenge.end_ts,
      host_identity: `${HOST}/u/${user}`,
      name: challenge.name,
      protocol: 'quantpub',
      spec: challenge.spec,
      start_ts: challenge.start_ts,
      timezone: challenge.timezone,
    })
    const participation = await updateParticipationThreadState(user, joined.id, {
      challenge_object_uri: objectUri,
      host_actor_uri: hostActor,
      thread_url: threadUrl,
    })
    if (participation == null) throw new Error('participation missing')

    const fetchedUrls: string[] = []
    const fetchThread = async (_user: string, url: string): Promise<unknown> => {
      fetchedUrls.push(url)
      const document = await buildThreadDocument(createThreadDocumentDeps(HOST), user, challenge, memberActor)
      return JSON.parse(JSON.stringify(document)) as unknown
    }
    const pushes: { change: ThreadPushChange; post: FeedPostRecord; recipients: string[] }[] = []
    const branch = createRemoteThreadBranch(
      createRemoteThreadDeps(
        {
          ...createChallengeThreadDeps({ webHost: HOME }),
          push: (_user, post, change, recipients) => pushes.push({ change, post, recipients }),
        },
        fetchThread,
      ),
    )

    await branch.afterJoin(user, participation)
    expect(fetchedUrls).toEqual([threadUrl])
    const [member] = await listChallengeMembers(user, challenge.id)
    expect(member?.actor_verified_at).toBeInstanceOf(Date)
    expect(await listThreadCopy(user, joined.id)).toMatchObject([
      {
        actor_uri: hostActor,
        audience: 'participants',
        content: '<p>Welcome, members</p>',
        object_uri: hostComment,
      },
    ])

    const read = await branch.read(user, challengeUrl)
    expect(read).toMatchObject({
      entries: [{ content: '<p>Welcome, members</p>' }],
      ok: true,
      viewer: { audiences: ['public', 'participants'], can_comment: true, role: 'member' },
    })

    const commented = await branch.comment(user, {
      audience: 'participants',
      challenge_url: challengeUrl,
      message: 'Day one done',
    })
    expect(commented).toMatchObject({ ok: true })
    expect(pushes).toHaveLength(1)
    const [push] = pushes
    if (push == null) throw new Error('nothing pushed')
    expect(push.change).toBe('create')
    expect(push.recipients).toContain(hostActor)

    const reply = toDeliverableReply(push.post)
    if (reply == null) throw new Error('not a deliverable reply')
    const ctx = createFeedFederation(HOME, `${HOME}/api`).createContext(new URL(HOME))
    const note: Note = buildReplyNote(ctx, user, { ...reply, thread_recipients: push.recipients })
    const noteId = note.id?.href ?? ''
    expect(note.toIds.map((id) => id.href)).toContain(hostActor)

    const admitted = await admitInboundThreadNote(createInboundThreadDeps(HOST), {
      actor_uri: memberActor,
      me: user,
      note,
      origin: HOST,
      presentation: async () => ({
        avatar_url: null,
        display_name: 'Member',
        handle: `@${user}@home.example`,
      }),
    })
    expect(admitted).not.toBeNull()
    expect(await getChallengeThreadEntryByObjectUri(user, noteId)).toMatchObject({
      actor_uri: memberActor,
      audience: 'participants',
      challenge_id: challenge.id,
      in_reply_to_uri: objectUri,
      kind: 'comment',
    })
    expect((await listThreadCopy(user, joined.id)).map((row) => row.object_uri)).toContain(noteId)
  })
})
