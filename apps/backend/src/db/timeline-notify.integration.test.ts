import { afterAll, beforeAll, describe, expect, test } from 'vitest'

/**
 * Integration tests for the home-timeline LISTEN/NOTIFY transport against a real
 * Postgres. The user's single per-user connection both LISTENs and NOTIFYs, so it
 * receives its own ping (exactly how ingest → open SSE stream works in one process).
 */
import { getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { emitTimelineNotify, openTimelineChannel } from './timeline-notify.ts'

const CONTAINER_TIMEOUT = 120_000

/** Resolve on the next ping (or reject after `ms`), so async NOTIFY delivery is awaitable. */
const nextPing = (ms: number): { promise: Promise<void>; onNotify: () => void } => {
  let resolve!: () => void
  let reject!: (e: Error) => void
  const promise = new Promise<void>((res, rej) => {
    resolve = res
    reject = rej
  })
  const timer = setTimeout(() => reject(new Error('no ping within timeout')), ms)
  return {
    onNotify: () => {
      clearTimeout(timer)
      resolve()
    },
    promise,
  }
}

describe('Timeline LISTEN/NOTIFY integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  test('a subscriber receives a ping emitted on the same user DB', async () => {
    const user = getTestUser()
    const ping = nextPing(5000)
    const close = await openTimelineChannel(user, ping.onNotify)
    try {
      await emitTimelineNotify(user)
      await expect(ping.promise).resolves.toBeUndefined()
    } finally {
      await close()
    }
  })

  test('after teardown, further pings are not delivered', async () => {
    const user = getTestUser()
    let count = 0
    const close = await openTimelineChannel(user, () => {
      count++
    })
    await emitTimelineNotify(user)
    // Give the first notification time to arrive, then tear down.
    await new Promise((r) => setTimeout(r, 200))
    expect(count).toBe(1)

    await close()
    await emitTimelineNotify(user)
    await new Promise((r) => setTimeout(r, 200))
    expect(count).toBe(1)
  })
})
