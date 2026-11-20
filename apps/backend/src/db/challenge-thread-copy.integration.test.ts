import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ThreadCopyEntryInput } from './challenge-thread-copy.ts'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteParticipationThreadCopyEntry,
  deleteThreadCopyEntry,
  getThreadCopyEntryById,
  getThreadCopyEntryByObjectUri,
  listThreadCopy,
  replaceThreadCopy,
  upsertThreadCopyEntry,
} from './challenge-thread-copy.ts'
import { createChallengeParticipation, deleteChallengeParticipation } from './challenges.ts'

const CONTAINER_TIMEOUT = 120_000
const HOST = 'https://host.example/users/freja'
const OLA = 'https://far.example/users/ola'

const participation = (user: string, slug = 'nov') =>
  createChallengeParticipation(user, {
    challenge_url: `https://host.example/u/freja/${slug}`,
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

const row = (n: number, over: Partial<ThreadCopyEntryInput> = {}): ThreadCopyEntryInput => ({
  actor_uri: HOST,
  audience: 'participants',
  avatar_url: null,
  content: `<p>${n}</p>`,
  display_name: 'Freja',
  edited_at: null,
  handle: '@freja@host.example',
  images: [],
  in_reply_to_uri: 'https://host.example/users/freja/challenges/nov',
  kind: 'comment',
  object_uri: `https://host.example/users/freja/feed/${n}`,
  published_at: new Date(Date.UTC(2026, 10, 2, 0, n)),
  url: null,
  ...over,
})

describe('challenge thread copies (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('replace keeps the ids of rows still there, updates them and drops the rest', async () => {
    const user = getTestUser()
    const p = await participation(user)
    const other = await participation(user, 'dec')
    await replaceThreadCopy(user, other.id, [row(9)])
    await replaceThreadCopy(user, p.id, [row(1), row(2), row(3)])
    const before = await getThreadCopyEntryByObjectUri(user, p.id, row(2).object_uri)

    await replaceThreadCopy(user, p.id, [
      row(2, { content: '<p>edited</p>', images: [{ url: 'https://host.example/a.png' }] }),
      row(4),
    ])
    const after = await listThreadCopy(user, p.id)
    expect(after.map((r) => r.object_uri)).toEqual([row(4).object_uri, row(2).object_uri])
    expect(after[1]).toMatchObject({
      content: '<p>edited</p>',
      id: before?.id,
      images: [{ url: 'https://host.example/a.png' }],
      participation_id: p.id,
    })
    expect(await listThreadCopy(user, other.id)).toHaveLength(1)

    await replaceThreadCopy(user, p.id, [])
    expect(await listThreadCopy(user, p.id)).toEqual([])
  })

  test('upsert says whether it inserted; lookups by id and by object id', async () => {
    const user = getTestUser()
    const p = await participation(user)
    const first = await upsertThreadCopyEntry(user, p.id, row(1))
    expect(first.inserted).toBe(true)
    const again = await upsertThreadCopyEntry(user, p.id, row(1, { content: '<p>again</p>' }))
    expect(again).toMatchObject({ entry: { content: '<p>again</p>', id: first.entry.id }, inserted: false })
    expect((await getThreadCopyEntryById(user, first.entry.id))?.object_uri).toBe(row(1).object_uri)
    expect(await getThreadCopyEntryById(user, 'not-a-uuid')).toBeNull()
    expect(await getThreadCopyEntryByObjectUri(user, p.id, 'https://nowhere.example/x')).toBeNull()
  })

  test('delete is scoped to the author, in every participation', async () => {
    const user = getTestUser()
    const p = await participation(user)
    const q = await participation(user, 'dec')
    const ola = row(1, { actor_uri: OLA, object_uri: 'https://far.example/users/ola/feed/1' })
    await upsertThreadCopyEntry(user, p.id, ola)
    await upsertThreadCopyEntry(user, q.id, ola)
    expect(await deleteThreadCopyEntry(user, ola.object_uri, HOST)).toBe(0)
    expect(await deleteThreadCopyEntry(user, ola.object_uri, OLA)).toBe(2)
  })

  test('a participation-scoped delete takes any author, in that participation only', async () => {
    const user = getTestUser()
    const p = await participation(user)
    const q = await participation(user, 'dec')
    const ola = row(1, { actor_uri: OLA, object_uri: 'https://far.example/users/ola/feed/1' })
    await upsertThreadCopyEntry(user, p.id, ola)
    await upsertThreadCopyEntry(user, q.id, ola)
    expect(await deleteParticipationThreadCopyEntry(user, p.id, ola.object_uri)).toBe(1)
    expect(await getThreadCopyEntryByObjectUri(user, p.id, ola.object_uri)).toBeNull()
    expect(await getThreadCopyEntryByObjectUri(user, q.id, ola.object_uri)).not.toBeNull()
    expect(await deleteParticipationThreadCopyEntry(user, p.id, ola.object_uri)).toBe(0)
  })

  test('leaving a challenge drops its copy', async () => {
    const user = getTestUser()
    const p = await participation(user)
    const { entry } = await upsertThreadCopyEntry(user, p.id, row(1))
    await deleteChallengeParticipation(user, p.id)
    expect(await getThreadCopyEntryById(user, entry.id)).toBeNull()
  })
})
