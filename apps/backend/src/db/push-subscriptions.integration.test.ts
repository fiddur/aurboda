import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  deletePushSubscription,
  listPushSubscriptions,
  recordPushFailure,
  recordPushSuccess,
  trimPushSubscriptions,
  upsertPushSubscription,
} from './push-subscriptions.ts'

const CONTAINER_TIMEOUT = 120_000

const input = (n: number) => ({
  auth: `auth-${n}`,
  endpoint: `https://push.example/send/${n}`,
  p256dh: `p256dh-${n}`,
  user_agent: `agent-${n}`,
})

describe('push subscriptions', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('upsert stores a subscription and returns it', async () => {
    const user = getTestUser()
    const row = await upsertPushSubscription(user, input(1))
    expect(row).toMatchObject({ ...input(1), failure_count: 0, last_success_at: null })
    expect(row.created_at).toBeInstanceOf(Date)
    expect(await listPushSubscriptions(user)).toEqual([row])
  })

  test('subscribing the same endpoint again replaces its keys and clears its failures', async () => {
    const user = getTestUser()
    const first = await upsertPushSubscription(user, input(1))
    await recordPushFailure(user, first.id)
    const again = await upsertPushSubscription(user, { ...input(1), auth: 'new-auth', user_agent: null })
    expect(again).toMatchObject({ auth: 'new-auth', failure_count: 0, id: first.id, user_agent: null })
    expect(again.created_at).toEqual(first.created_at)
    expect(await listPushSubscriptions(user)).toHaveLength(1)
  })

  test('list is oldest first', async () => {
    const user = getTestUser()
    const a = await upsertPushSubscription(user, input(1))
    const b = await upsertPushSubscription(user, input(2))
    await query(user, "UPDATE push_subscriptions SET created_at = NOW() - interval '1 day' WHERE id = $1", [
      b.id,
    ])
    expect((await listPushSubscriptions(user)).map((r) => r.id)).toEqual([b.id, a.id])
  })

  test('delete removes one and says whether it existed', async () => {
    const user = getTestUser()
    const row = await upsertPushSubscription(user, input(1))
    expect(await deletePushSubscription(user, row.id)).toBe(true)
    expect(await deletePushSubscription(user, row.id)).toBe(false)
    expect(await listPushSubscriptions(user)).toEqual([])
  })

  test('success stamps last_success_at and zeroes the failures; failure counts up', async () => {
    const user = getTestUser()
    const row = await upsertPushSubscription(user, input(1))
    expect(await recordPushFailure(user, row.id)).toBe(1)
    expect(await recordPushFailure(user, row.id)).toBe(2)
    await recordPushSuccess(user, row.id)
    const [stored] = await listPushSubscriptions(user)
    expect(stored?.failure_count).toBe(0)
    expect(stored?.last_success_at).toBeInstanceOf(Date)
    expect(await recordPushFailure(user, '11111111-1111-4111-8111-111111111111')).toBeNull()
  })

  test('trim keeps the given one and the most recently reached others up to the cap', async () => {
    const user = getTestUser()
    const rows = []
    for (const n of [1, 2, 3, 4]) rows.push(await upsertPushSubscription(user, input(n)))
    const [r1, r2, r3, r4] = rows
    await query(user, "UPDATE push_subscriptions SET created_at = NOW() - interval '10 days'")
    await query(
      user,
      "UPDATE push_subscriptions SET last_success_at = NOW() - interval '1 day' WHERE id = $1",
      [r2!.id],
    )
    await query(
      user,
      "UPDATE push_subscriptions SET last_success_at = NOW() - interval '2 days' WHERE id = $1",
      [r3!.id],
    )

    expect(await trimPushSubscriptions(user, r1!.id, 3)).toBe(1)
    expect((await listPushSubscriptions(user)).map((r) => r.id).sort()).toEqual(
      [r1!.id, r2!.id, r3!.id].sort(),
    )
    expect(r4).toBeDefined()
    expect(await trimPushSubscriptions(user, r1!.id, 3)).toBe(0)
  })
})
