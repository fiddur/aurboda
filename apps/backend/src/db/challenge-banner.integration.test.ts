import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteChallengeBanner, getChallengeBanner, upsertChallengeBanner } from './challenge-banner.ts'
import { createChallenge, deleteChallenge } from './challenges.ts'

const CONTAINER_TIMEOUT = 120_000

const newChallenge = (user: string) =>
  createChallenge(user, {
    announce_winner: false,
    end_ts: new Date('2026-06-08T00:00:00Z'),
    is_public: true,
    name: 'Banner test',
    spec: {
      activity_type_id: null,
      aggregation: 'sum',
      bucket_size: '1d',
      pattern: 'steps',
      source_type: 'metric',
      unit: 'steps',
    },
    start_ts: new Date('2026-06-01T00:00:00Z'),
    timezone: 'Europe/Stockholm',
  })

describe('Challenge banner integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('returns undefined when no banner is set', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    expect(await getChallengeBanner(user, challenge.id)).toBeUndefined()
  })

  test('stores and round-trips a banner', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    const bytes = Buffer.from([1, 2, 3, 4, 5])
    await upsertChallengeBanner(user, challenge.id, 'image/webp', bytes)

    const stored = await getChallengeBanner(user, challenge.id)
    expect(stored?.content_type).toBe('image/webp')
    expect(stored?.data.equals(bytes)).toBe(true)
    expect(stored?.updated_at).toBeInstanceOf(Date)
  })

  test('replaces the existing banner and bumps updated_at', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    await upsertChallengeBanner(user, challenge.id, 'image/webp', Buffer.from([1]))
    const first = await getChallengeBanner(user, challenge.id)
    await new Promise((resolve) => setTimeout(resolve, 5))
    await upsertChallengeBanner(user, challenge.id, 'image/png', Buffer.from([9, 9]))

    const stored = await getChallengeBanner(user, challenge.id)
    expect(stored?.content_type).toBe('image/png')
    expect(stored?.data.equals(Buffer.from([9, 9]))).toBe(true)
    expect(stored?.updated_at.getTime()).toBeGreaterThan(first?.updated_at.getTime() ?? Infinity)
  })

  test('deletes the banner and reports whether a row was removed', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    expect(await deleteChallengeBanner(user, challenge.id)).toBe(false)

    await upsertChallengeBanner(user, challenge.id, 'image/webp', Buffer.from([1]))
    expect(await deleteChallengeBanner(user, challenge.id)).toBe(true)
    expect(await getChallengeBanner(user, challenge.id)).toBeUndefined()
  })

  test('deleting the challenge cascades to its banner', async () => {
    const user = getTestUser()
    const challenge = await newChallenge(user)
    await upsertChallengeBanner(user, challenge.id, 'image/webp', Buffer.from([1]))

    expect(await deleteChallenge(user, challenge.id)).toBe(true)
    expect(await getChallengeBanner(user, challenge.id)).toBeUndefined()
  })
})
