import * as PgBossModule from 'pg-boss'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import type { GarminPushJob } from '../integrations/garmin/push.ts'
import type { PgBoss } from './pg-boss.ts'

import { createTestDatabase, type TestDatabase } from '../test/db-test-helper.ts'
import { createGarminPushQueue, GARMIN_PUSH_QUEUE, type GarminPushQueue } from './garmin-push-queue.ts'

const SETUP_TIMEOUT = 120_000

describe('Garmin push queue', () => {
  let database: TestDatabase
  let boss: PgBoss
  let queue: GarminPushQueue
  const processed: GarminPushJob[] = []
  let release!: () => void
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })

  beforeAll(async () => {
    database = await createTestDatabase()
    boss = new PgBossModule.PgBoss(database.uri)
    await boss.start()
    queue = await createGarminPushQueue(boss, async (job) => {
      await gate
      processed.push(job)
    })
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    release()
    await boss?.stop({ graceful: false })
    await database?.drop()
  })

  test('keeps every job, even two alike for one user, and runs them all', async () => {
    const job = { records: [{ external_id: 'sd-1', type: 'dailies' }], user: 'alice' }
    await queue.enqueue(job)
    await queue.enqueue(job)
    await queue.enqueue({ records: [{ external_id: 'sl-1', type: 'sleeps' }], user: 'alice' })

    const jobs = await boss.findJobs(GARMIN_PUSH_QUEUE)
    expect(jobs).toHaveLength(3)

    release()
    await vi.waitFor(() => expect(processed).toHaveLength(3), { interval: 200, timeout: 30_000 })
    expect(processed.map((p) => p.records[0]?.external_id).sort()).toEqual(['sd-1', 'sd-1', 'sl-1'])
  }, 60_000)
})
