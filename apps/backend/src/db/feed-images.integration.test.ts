import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  countFeedImages,
  deleteFeedImage,
  getFeedImage,
  insertFeedImage,
  listFeedImages,
} from './feed-images.ts'

const CONTAINER_TIMEOUT = 120_000

const picture = (byte: number) => ({
  content_type: 'image/webp',
  data: Buffer.from([byte, byte, byte, byte, byte]),
  height: 300,
  width: 400,
})

describe('Feed image integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('insertFeedImage stores the picture and answers the row without its bytes', async () => {
    const user = getTestUser()
    const stored = await insertFeedImage(user, picture(1))
    expect(stored).toEqual({
      byte_size: 5,
      content_type: 'image/webp',
      created_at: expect.any(Date),
      height: 300,
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      width: 400,
    })
    expect(stored).not.toHaveProperty('data')
  })

  test('getFeedImage round-trips the bytes', async () => {
    const user = getTestUser()
    const { id } = await insertFeedImage(user, picture(7))
    expect(await getFeedImage(user, id)).toEqual({
      content_type: 'image/webp',
      data: Buffer.from([7, 7, 7, 7, 7]),
    })
  })

  test('getFeedImage answers undefined for a missing row and for an id that is not a UUID', async () => {
    const user = getTestUser()
    expect(await getFeedImage(user, '00000000-0000-4000-8000-000000000001')).toBeUndefined()
    expect(await getFeedImage(user, 'not-a-uuid')).toBeUndefined()
  })

  test('listFeedImages answers rows without bytes, newest first', async () => {
    const user = getTestUser()
    const first = await insertFeedImage(user, picture(1))
    const second = await insertFeedImage(user, picture(2))
    const listed = await listFeedImages(user)
    expect(listed.map((row) => row.id)).toEqual([second.id, first.id])
    expect(listed[0]).not.toHaveProperty('data')
  })

  test('countFeedImages counts the stored pictures', async () => {
    const user = getTestUser()
    expect(await countFeedImages(user)).toBe(0)
    await insertFeedImage(user, picture(1))
    await insertFeedImage(user, picture(2))
    expect(await countFeedImages(user)).toBe(2)
  })

  test('deleteFeedImage removes the row and answers whether it did', async () => {
    const user = getTestUser()
    const { id } = await insertFeedImage(user, picture(1))
    expect(await deleteFeedImage(user, id)).toBe(true)
    expect(await deleteFeedImage(user, id)).toBe(false)
    expect(await deleteFeedImage(user, 'not-a-uuid')).toBe(false)
    expect(await getFeedImage(user, id)).toBeUndefined()
  })
})
