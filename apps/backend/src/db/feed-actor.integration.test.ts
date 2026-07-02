import { createPublicKey } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * Integration tests for the singleton actor keypair store.
 */
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getOrCreateActorKeyPair } from './feed-actor.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Feed actor keypair integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('generates a valid RSA keypair on first use', async () => {
    const user = getTestUser()
    const kp = await getOrCreateActorKeyPair(user)

    expect(kp.private_key_pem).toContain('BEGIN PRIVATE KEY')
    expect(kp.public_key_pem).toContain('BEGIN PUBLIC KEY')
    expect(kp.created_at).toBeInstanceOf(Date)

    // The stored public key parses as an RSA key.
    const pub = createPublicKey(kp.public_key_pem)
    expect(pub.asymmetricKeyType).toBe('rsa')
  })

  test('is idempotent — the second call returns the same stored pair', async () => {
    const user = getTestUser()
    const first = await getOrCreateActorKeyPair(user)
    const second = await getOrCreateActorKeyPair(user)

    expect(second.private_key_pem).toBe(first.private_key_pem)
    expect(second.public_key_pem).toBe(first.public_key_pem)
    expect(second.created_at.toISOString()).toBe(first.created_at.toISOString())
  })

  test('keeps a single keypair under concurrent first-use', async () => {
    const user = getTestUser()
    const [a, b, c] = await Promise.all([
      getOrCreateActorKeyPair(user),
      getOrCreateActorKeyPair(user),
      getOrCreateActorKeyPair(user),
    ])
    // All callers observe the one keypair that won the singleton insert.
    expect(a.public_key_pem).toBe(b.public_key_pem)
    expect(b.public_key_pem).toBe(c.public_key_pem)
  })
})
