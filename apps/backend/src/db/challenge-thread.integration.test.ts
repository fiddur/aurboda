import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ChallengeThreadEntryInput } from './challenge-thread.ts'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  countChallengeThreadEntries,
  countChallengeThreadEntriesByActorSince,
  countVisibleChallengeThreadEntries,
  deleteChallengeThreadEntriesByActor,
  deleteChallengeThreadEntry,
  getChallengeThreadEntryById,
  getChallengeThreadEntryByObjectUri,
  listChallengeThreadReplies,
  listChallengeThreadTopLevel,
  setChallengeThreadEntryHidden,
  upsertChallengeThreadEntry,
} from './challenge-thread.ts'
import { createChallenge, deleteChallenge } from './challenges.ts'

const CONTAINER_TIMEOUT = 120_000
const BOB = 'https://aurboda.test/users/bob'
const ALICE = 'https://aurboda.test/users/alice'

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

const input = (challengeId: string, n: number, over: Partial<ChallengeThreadEntryInput> = {}) => ({
  actor_uri: BOB,
  audience: 'public' as const,
  avatar_url: null,
  challenge_id: challengeId,
  content: `<p>${n}</p>`,
  display_name: 'Bob',
  edited_at: null,
  handle: '@bob@aurboda.test',
  images: [],
  in_reply_to_uri: 'https://aurboda.test/users/alice/challenges/abc',
  kind: 'comment' as const,
  object_uri: `${BOB}/feed/${n}`,
  published_at: new Date(Date.UTC(2026, 10, 1, 0, n)),
  root_entry_id: null,
  url: null,
  ...over,
})

const ALL = { audiences: ['public', 'participants'] as const, include_hidden: true }
const PUBLIC_VISIBLE = { audiences: ['public'] as const, include_hidden: false }

describe('challenge thread entries (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('upsert inserts, then updates only for the same actor and challenge', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const first = await upsertChallengeThreadEntry(user, input(challenge.id, 1))
    expect(first).toMatchObject({ entry: { content: '<p>1</p>', images: [] }, inserted: true })

    const edited = await upsertChallengeThreadEntry(user, {
      ...input(challenge.id, 1),
      content: '<p>edited</p>',
      edited_at: new Date('2026-11-02T00:00:00Z'),
    })
    expect(edited).toMatchObject({
      entry: { content: '<p>edited</p>', id: first?.entry.id },
      inserted: false,
    })

    expect(await upsertChallengeThreadEntry(user, { ...input(challenge.id, 1), actor_uri: ALICE })).toBeNull()
    const other = await newChallenge(user)
    expect(await upsertChallengeThreadEntry(user, input(other.id, 1))).toBeNull()
    expect((await getChallengeThreadEntryByObjectUri(user, `${BOB}/feed/1`))?.content).toBe('<p>edited</p>')
  })

  test('get by id and by object uri', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const stored = await upsertChallengeThreadEntry(user, input(challenge.id, 1))
    expect((await getChallengeThreadEntryById(user, stored!.entry.id))?.object_uri).toBe(`${BOB}/feed/1`)
    expect(await getChallengeThreadEntryById(user, 'not-a-uuid')).toBeNull()
    expect(await getChallengeThreadEntryByObjectUri(user, 'https://nowhere.test/x')).toBeNull()
  })

  test('top-level pages newest first by audience, hidden only when asked, with a keyset cursor', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    for (let n = 1; n <= 4; n++) {
      await upsertChallengeThreadEntry(
        user,
        input(challenge.id, n, { audience: n === 3 ? 'participants' : 'public' }),
      )
    }
    const hidden = await getChallengeThreadEntryByObjectUri(user, `${BOB}/feed/4`)
    await setChallengeThreadEntryHidden(user, challenge.id, hidden!.id, true)

    const all = await listChallengeThreadTopLevel(user, challenge.id, ALL, 10)
    expect(all.map((e) => e.content)).toEqual(['<p>4</p>', '<p>3</p>', '<p>2</p>', '<p>1</p>'])
    const visible = await listChallengeThreadTopLevel(user, challenge.id, PUBLIC_VISIBLE, 10)
    expect(visible.map((e) => e.content)).toEqual(['<p>2</p>', '<p>1</p>'])

    const first = await listChallengeThreadTopLevel(user, challenge.id, ALL, 2)
    const last = first[1]!
    const second = await listChallengeThreadTopLevel(user, challenge.id, ALL, 2, {
      id: last.id,
      published_at: last.cursor_ts,
    })
    expect(second.map((e) => e.content)).toEqual(['<p>2</p>', '<p>1</p>'])
  })

  test('replies come oldest first per root, capped per root, and filtered like the top level', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const root = (await upsertChallengeThreadEntry(user, input(challenge.id, 1)))!.entry
    for (let n = 2; n <= 5; n++) {
      await upsertChallengeThreadEntry(
        user,
        input(challenge.id, n, {
          audience: n === 5 ? 'participants' : 'public',
          in_reply_to_uri: root.object_uri,
          root_entry_id: root.id,
        }),
      )
    }
    const replies = await listChallengeThreadReplies(user, [root.id], ALL, 3)
    expect(replies.map((e) => e.content)).toEqual(['<p>2</p>', '<p>3</p>', '<p>4</p>'])
    const publicOnly = await listChallengeThreadReplies(user, [root.id], PUBLIC_VISIBLE, 10)
    expect(publicOnly.map((e) => e.content)).toEqual(['<p>2</p>', '<p>3</p>', '<p>4</p>'])
    expect(await listChallengeThreadReplies(user, [], ALL, 10)).toEqual([])
  })

  test('counts every entry for the cap, and the visible ones for a viewer', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const root = (await upsertChallengeThreadEntry(user, input(challenge.id, 1)))!.entry
    await upsertChallengeThreadEntry(
      user,
      input(challenge.id, 2, { in_reply_to_uri: root.object_uri, root_entry_id: root.id }),
    )
    await upsertChallengeThreadEntry(user, input(challenge.id, 3, { audience: 'participants' }))
    expect(await countChallengeThreadEntries(user, challenge.id)).toBe(3)
    expect(await countVisibleChallengeThreadEntries(user, challenge.id, PUBLIC_VISIBLE)).toBe(2)

    await setChallengeThreadEntryHidden(user, challenge.id, root.id, true)
    expect(await countVisibleChallengeThreadEntries(user, challenge.id, PUBLIC_VISIBLE)).toBe(0)
    expect(await countVisibleChallengeThreadEntries(user, challenge.id, ALL)).toBe(3)
  })

  test('hide keeps its first stamp, unhide clears it, and another challenge is left alone', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const stored = (await upsertChallengeThreadEntry(user, input(challenge.id, 1)))!.entry
    const hidden = await setChallengeThreadEntryHidden(user, challenge.id, stored.id, true)
    expect(hidden?.hidden_at).toBeInstanceOf(Date)
    const again = await setChallengeThreadEntryHidden(user, challenge.id, stored.id, true)
    expect(again?.hidden_at).toEqual(hidden?.hidden_at)
    expect((await setChallengeThreadEntryHidden(user, challenge.id, stored.id, false))?.hidden_at).toBeNull()
    const other = await newChallenge(user)
    expect(await setChallengeThreadEntryHidden(user, other.id, stored.id, true)).toBeNull()
  })

  test('delete needs the author, and takes the replies with a top-level entry', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const root = (await upsertChallengeThreadEntry(user, input(challenge.id, 1)))!.entry
    await upsertChallengeThreadEntry(
      user,
      input(challenge.id, 2, { actor_uri: ALICE, in_reply_to_uri: root.object_uri, root_entry_id: root.id }),
    )
    expect(await deleteChallengeThreadEntry(user, root.object_uri, ALICE)).toBeNull()
    expect((await deleteChallengeThreadEntry(user, root.object_uri, BOB))?.id).toBe(root.id)
    expect(await countChallengeThreadEntries(user, challenge.id)).toBe(0)
  })

  test("counts an actor's entries in one challenge created since a moment", async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const other = await newChallenge(user)
    await upsertChallengeThreadEntry(user, input(challenge.id, 1))
    await upsertChallengeThreadEntry(user, input(challenge.id, 2))
    await upsertChallengeThreadEntry(user, input(challenge.id, 3, { actor_uri: ALICE }))
    await upsertChallengeThreadEntry(user, input(other.id, 4))
    const hourAgo = new Date(Date.now() - 3_600_000)
    expect(await countChallengeThreadEntriesByActorSince(user, challenge.id, BOB, hourAgo)).toBe(2)
    expect(await countChallengeThreadEntriesByActorSince(user, challenge.id, ALICE, hourAgo)).toBe(1)
    expect(await countChallengeThreadEntriesByActorSince(user, other.id, BOB, hourAgo)).toBe(1)
    const inAnHour = new Date(Date.now() + 3_600_000)
    expect(await countChallengeThreadEntriesByActorSince(user, challenge.id, BOB, inAnHour)).toBe(0)
  })

  test('deletes every entry of one actor across threads', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const other = await newChallenge(user)
    await upsertChallengeThreadEntry(user, input(challenge.id, 1))
    await upsertChallengeThreadEntry(user, input(other.id, 2))
    await upsertChallengeThreadEntry(user, input(challenge.id, 3, { actor_uri: ALICE }))
    expect(await deleteChallengeThreadEntriesByActor(user, BOB)).toBe(2)
    expect(await countChallengeThreadEntries(user, challenge.id)).toBe(1)
    expect(await countChallengeThreadEntries(user, other.id)).toBe(0)
    expect(await deleteChallengeThreadEntriesByActor(user, BOB)).toBe(0)
  })

  test('deleting the challenge deletes its thread', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    await upsertChallengeThreadEntry(user, input(challenge.id, 1))
    await deleteChallenge(user, challenge.id)
    expect(await getChallengeThreadEntryByObjectUri(user, `${BOB}/feed/1`)).toBeNull()
  })
})
