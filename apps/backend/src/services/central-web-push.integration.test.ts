import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { CREATE_SERVER_SETTINGS_TABLE } from './central-db.ts'
import { createWebPushKeysApi } from './central-web-push.ts'

const CONTAINER_TIMEOUT = 120_000

describe('central Web Push keys', () => {
  beforeAll(async () => {
    await startTestDb()
    await getTestDbClient().query(CREATE_SERVER_SETTINGS_TABLE)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query("DELETE FROM server_settings WHERE key = 'web_push_vapid_keys'")
  })

  test('the key pair is generated once, and a concurrent first call reads the stored pair', async () => {
    let generated = 0
    const api = createWebPushKeysApi(
      async () => getTestDbClient(),
      () => {
        generated += 1
        return { private_key: `private-${generated}`, public_key: `public-${generated}` }
      },
    )
    const [first, concurrent] = await Promise.all([api.getOrCreateVapidKeys(), api.getOrCreateVapidKeys()])
    expect(concurrent).toEqual(first)
    expect(await api.getOrCreateVapidKeys()).toEqual(first)
  })

  test('generates a real P-256 pair by default', async () => {
    const keys = await createWebPushKeysApi(async () => getTestDbClient()).getOrCreateVapidKeys()
    expect(Buffer.from(keys.public_key, 'base64url')).toHaveLength(65)
    expect(Buffer.from(keys.private_key, 'base64url')).toHaveLength(32)
  })
})
