import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import {
  createTestDatabase,
  getTestConnectionUri,
  getTestUser,
  startTestDb,
  stopTestDb,
  type TestDatabase,
} from '../test/db-test-helper.ts'
import { _setDbForUser } from './index.ts'
import { emitLiveNotify, type LiveEventKind, openLiveChannel } from './live-notify.ts'
import { createRolePool, type UserDb } from './pool.ts'

const listenClient = () => new Client({ connectionString: getTestConnectionUri() })

const CONTAINER_TIMEOUT = 120_000
const OTHER_USER = 'otheruser'

const settle = () => new Promise((r) => setTimeout(r, 200))

/** Resolve with the next event's kind (or reject after `ms`), so async NOTIFY delivery is awaitable. */
const nextEvent = (
  ms: number,
): { promise: Promise<LiveEventKind>; onEvent: (kind: LiveEventKind) => void } => {
  let resolve!: (kind: LiveEventKind) => void
  let reject!: (e: Error) => void
  const promise = new Promise<LiveEventKind>((res, rej) => {
    resolve = res
    reject = rej
  })
  const timer = setTimeout(() => reject(new Error('no event within timeout')), ms)
  return {
    onEvent: (kind) => {
      clearTimeout(timer)
      resolve(kind)
    },
    promise,
  }
}

describe('Live LISTEN/NOTIFY integration', () => {
  let other: TestDatabase
  let otherPool: UserDb

  beforeAll(async () => {
    await startTestDb()
    other = await createTestDatabase()
    otherPool = createRolePool({ connectionString: other.uri, max: 1 })
    _setDbForUser(OTHER_USER, otherPool)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await otherPool.end()
    await other.drop()
    await stopTestDb()
  })

  test.each<LiveEventKind>(['timeline', 'notification'])(
    'a %s ping emitted through the user pool arrives as its own kind',
    async (kind) => {
      const user = getTestUser()
      const event = nextEvent(5000)
      const close = await openLiveChannel(user, event.onEvent, listenClient)
      try {
        await emitLiveNotify(user, kind)
        await expect(event.promise).resolves.toBe(kind)
      } finally {
        await close()
      }
    },
  )

  test("a ping in another user's database does not arrive", async () => {
    const user = getTestUser()
    const seen: LiveEventKind[] = []
    const close = await openLiveChannel(user, (kind) => seen.push(kind), listenClient)
    try {
      await emitLiveNotify(OTHER_USER, 'notification')
      await settle()
      expect(seen).toEqual([])
    } finally {
      await close()
    }
  })

  test('after teardown, further pings are not delivered', async () => {
    const user = getTestUser()
    const seen: LiveEventKind[] = []
    const close = await openLiveChannel(user, (kind) => seen.push(kind), listenClient)
    await emitLiveNotify(user, 'timeline')
    await settle()
    expect(seen).toEqual(['timeline'])

    await close()
    await emitLiveNotify(user, 'notification')
    await settle()
    expect(seen).toEqual(['timeline'])
  })
})
