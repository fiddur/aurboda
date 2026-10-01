import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import * as PgBossModule from 'pg-boss'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import type { PgBoss } from './pg-boss.ts'

import {
  createSourceEnrichQueue,
  type SourceEnrichDeps,
  type SourceEnrichQueue,
  SOURCE_ENRICH_QUEUE,
} from './source-enrich-queue.ts'

const CONTAINER_TIMEOUT = 120_000

const deps: SourceEnrichDeps = {
  enrichGravl: null,
  isGarminConnected: async () => false,
  isGravlConnected: async () => false,
  syncGarmin: null,
}

describe('source enrichment queue', () => {
  let container: StartedPostgreSqlContainer
  let boss: PgBoss
  let queue: SourceEnrichQueue

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine').start()
    boss = new PgBossModule.PgBoss(container.getConnectionUri())
    await boss.start()

    await boss.createQueue('source-enrich')
    await boss.send('source-enrich', { user: 'u' })

    queue = await createSourceEnrichQueue(boss, deps)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await boss?.stop({ graceful: false })
    await container?.stop()
  })

  test('drops the legacy standard-policy queue', async () => {
    expect(await boss.getQueue('source-enrich')).toBeNull()
  })

  test('collapses repeated arrivals for one target into one queued job', async () => {
    const arrival = { key: 'w1', kind: 'activity' as const, provider: 'gravl' as const }

    await queue.enqueue('alice', [arrival])
    await queue.enqueue('alice', [arrival])
    await queue.enqueue('alice', [{ ...arrival, key: 'w2' }])

    const jobs = await boss.findJobs(SOURCE_ENRICH_QUEUE)
    expect(jobs.map((job) => job.singletonKey).sort()).toEqual([
      'alice:gravl:activity:w1',
      'alice:gravl:activity:w2',
    ])
  })
})
