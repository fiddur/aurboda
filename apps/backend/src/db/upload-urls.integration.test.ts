import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestDbClient, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { findLiveUploadUrl, insertUploadUrl, spendUploadUrl } from './upload-urls.ts'

const CONTAINER_TIMEOUT = 120_000

const NOTE_ID = '1b4e28ba-2fa1-41d2-883f-0016d3cca427'
const inMinutes = (minutes: number) => new Date(Date.now() + minutes * 60_000)

describe('upload URLs', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('stores a URL and finds it while it is live', async () => {
    const user = getTestUser()
    const expires_at = inMinutes(15)
    const inserted = await insertUploadUrl(user, {
      expires_at,
      target: 'note_attachment',
      target_id: NOTE_ID,
      token_hash: 'a'.repeat(64),
    })
    expect(inserted).toMatchObject({
      target: 'note_attachment',
      target_id: NOTE_ID,
      token_hash: 'a'.repeat(64),
      used_at: null,
    })
    expect(inserted.expires_at.getTime()).toBe(expires_at.getTime())
    expect(inserted.created_at).toBeInstanceOf(Date)

    const found = await findLiveUploadUrl(user, 'a'.repeat(64))
    expect(found).toEqual(inserted)
    expect(await findLiveUploadUrl(user, 'a'.repeat(64))).toEqual(inserted)
  })

  test('keeps a missing target id as null', async () => {
    const user = getTestUser()
    await insertUploadUrl(user, {
      expires_at: inMinutes(15),
      target: 'feed_image',
      target_id: null,
      token_hash: 'b'.repeat(64),
    })
    expect((await findLiveUploadUrl(user, 'b'.repeat(64)))?.target_id).toBeNull()
  })

  test('an unknown hash is not found and not spendable', async () => {
    const user = getTestUser()
    expect(await findLiveUploadUrl(user, 'c'.repeat(64))).toBeUndefined()
    expect(await spendUploadUrl(user, 'c'.repeat(64))).toBeUndefined()
  })

  test('spends a URL once', async () => {
    const user = getTestUser()
    await insertUploadUrl(user, {
      expires_at: inMinutes(15),
      target: 'profile_avatar',
      target_id: null,
      token_hash: 'd'.repeat(64),
    })
    const spent = await spendUploadUrl(user, 'd'.repeat(64))
    expect(spent?.used_at).toBeInstanceOf(Date)
    expect(await spendUploadUrl(user, 'd'.repeat(64))).toBeUndefined()
    expect(await findLiveUploadUrl(user, 'd'.repeat(64))).toBeUndefined()
  })

  test('two spends at once: exactly one wins', async () => {
    const user = getTestUser()
    await insertUploadUrl(user, {
      expires_at: inMinutes(15),
      target: 'feed_image',
      target_id: null,
      token_hash: 'e'.repeat(64),
    })
    const results = await Promise.all([
      spendUploadUrl(user, 'e'.repeat(64)),
      spendUploadUrl(user, 'e'.repeat(64)),
    ])
    expect(results.filter(Boolean)).toHaveLength(1)
  })

  test('an expired URL is neither found nor spendable', async () => {
    const user = getTestUser()
    await insertUploadUrl(user, {
      expires_at: inMinutes(-1),
      target: 'feed_image',
      target_id: null,
      token_hash: 'f'.repeat(64),
    })
    expect(await findLiveUploadUrl(user, 'f'.repeat(64))).toBeUndefined()
    expect(await spendUploadUrl(user, 'f'.repeat(64))).toBeUndefined()
  })

  test('minting sweeps the rows that expired over a day ago', async () => {
    const user = getTestUser()
    await insertUploadUrl(user, {
      expires_at: inMinutes(-25 * 60),
      target: 'feed_image',
      target_id: null,
      token_hash: '1'.repeat(64),
    })
    await insertUploadUrl(user, {
      expires_at: inMinutes(-60),
      target: 'feed_image',
      target_id: null,
      token_hash: '2'.repeat(64),
    })
    await insertUploadUrl(user, {
      expires_at: inMinutes(15),
      target: 'feed_image',
      target_id: null,
      token_hash: '3'.repeat(64),
    })
    const { rows } = await getTestDbClient().query<{ token_hash: string }>(
      'SELECT token_hash FROM upload_urls ORDER BY token_hash',
    )
    expect(rows.map((row) => row.token_hash)).toEqual(['2'.repeat(64), '3'.repeat(64)])
  })
})
