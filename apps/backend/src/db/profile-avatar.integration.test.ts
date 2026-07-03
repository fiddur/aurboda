/**
 * Integration tests for profile avatar storage — insert/replace (upsert),
 * fetch, and delete of the per-user singleton row against a real PostgreSQL
 * instance via testcontainers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { deleteProfileAvatar, getProfileAvatar, upsertProfileAvatar } from './profile-avatar.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Profile avatar integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('returns undefined when no avatar is set', async () => {
    expect(await getProfileAvatar(getTestUser())).toBeUndefined()
  })

  test('stores and round-trips an avatar', async () => {
    const user = getTestUser()
    const bytes = Buffer.from([1, 2, 3, 4, 5])
    await upsertProfileAvatar(user, 'image/webp', bytes)

    const stored = await getProfileAvatar(user)
    expect(stored?.content_type).toBe('image/webp')
    expect(stored?.data.equals(bytes)).toBe(true)
    expect(stored?.updated_at).toBeInstanceOf(Date)
  })

  test('replaces the existing avatar (singleton, no duplicate rows)', async () => {
    const user = getTestUser()
    await upsertProfileAvatar(user, 'image/webp', Buffer.from([1]))
    await upsertProfileAvatar(user, 'image/png', Buffer.from([9, 9]))

    const stored = await getProfileAvatar(user)
    expect(stored?.content_type).toBe('image/png')
    expect(stored?.data.equals(Buffer.from([9, 9]))).toBe(true)
  })

  test('deletes the avatar and reports whether a row was removed', async () => {
    const user = getTestUser()
    expect(await deleteProfileAvatar(user)).toBe(false)

    await upsertProfileAvatar(user, 'image/webp', Buffer.from([1]))
    expect(await deleteProfileAvatar(user)).toBe(true)
    expect(await getProfileAvatar(user)).toBeUndefined()
  })
})
