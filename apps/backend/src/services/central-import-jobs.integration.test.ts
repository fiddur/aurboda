import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  createCentralImportJobsApi,
  CREATE_IMPORT_JOBS_INDEXES,
  CREATE_IMPORT_JOBS_TABLE,
} from './central-import-jobs.ts'

const CONTAINER_TIMEOUT = 120_000

describe('central import_jobs', () => {
  beforeAll(async () => {
    await startTestDb()
    const client = getTestDbClient()
    await client.query(CREATE_IMPORT_JOBS_TABLE)
    for (const stmt of CREATE_IMPORT_JOBS_INDEXES) await client.query(stmt)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await getTestDbClient().query('TRUNCATE TABLE import_jobs')
  })

  const api = () => createCentralImportJobsApi(async () => getTestDbClient())

  test('full lifecycle: insert → start → tick → complete', async () => {
    const a = api()
    const job = await a.insertImportJob('livsmedelsverket', 'fredrik')
    expect(job.status).toBe('pending')
    expect(job.skipped_items).toBe(0)
    expect(job.started_by).toBe('fredrik')

    const started = await a.startImportJob(job.id, 2575)
    expect(started?.status).toBe('running')
    expect(started?.total_items).toBe(2575)

    await a.updateImportJobProgress(job.id, 100, 3)
    const mid = await a.getImportJobById(job.id)
    expect(mid?.processed_items).toBe(100)
    expect(mid?.skipped_items).toBe(3)

    const done = await a.completeImportJob(job.id)
    expect(done?.status).toBe('completed')
    expect(done?.completed_at).toBeDefined()
    expect(done?.error).toBeUndefined()
  })

  test('failImportJob persists the error', async () => {
    const a = api()
    const job = await a.insertImportJob('livsmedelsverket')
    await a.startImportJob(job.id, 100)

    const failed = await a.failImportJob(job.id, 'Connection refused')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('Connection refused')
  })

  test('getActiveImportJob skips completed/failed', async () => {
    const a = api()
    expect(await a.getActiveImportJob('livsmedelsverket')).toBeNull()

    const j1 = await a.insertImportJob('livsmedelsverket')
    expect((await a.getActiveImportJob('livsmedelsverket'))?.id).toBe(j1.id)

    await a.completeImportJob(j1.id)
    expect(await a.getActiveImportJob('livsmedelsverket')).toBeNull()
  })

  test('listImportJobs newest first; getLatestImportJob picks the right one', async () => {
    const a = api()
    const a1 = await a.insertImportJob('livsmedelsverket')
    await new Promise((r) => setTimeout(r, 5))
    const a2 = await a.insertImportJob('livsmedelsverket')

    const list = await a.listImportJobs('livsmedelsverket', 5)
    expect(list.map((j) => j.id)).toEqual([a2.id, a1.id])

    const latest = await a.getLatestImportJob('livsmedelsverket')
    expect(latest?.id).toBe(a2.id)
  })

  test('reapStaleImportJobs uses heartbeat, not start time', async () => {
    const a = api()
    const stalled = await a.insertImportJob('livsmedelsverket')
    await a.startImportJob(stalled.id, 100)
    await getTestDbClient().query(
      `UPDATE import_jobs
         SET last_progress_at = NOW() - INTERVAL '30 minutes',
             started_at = NOW() - INTERVAL '2 hours'
       WHERE id = $1`,
      [stalled.id],
    )

    const slow = await a.insertImportJob('livsmedelsverket')
    await a.startImportJob(slow.id, 100)
    await getTestDbClient().query(
      `UPDATE import_jobs SET started_at = NOW() - INTERVAL '2 hours' WHERE id = $1`,
      [slow.id],
    )

    const reaped = await a.reapStaleImportJobs(10)
    expect(reaped).toBe(1)

    const stalledAfter = await a.getImportJobById(stalled.id)
    const slowAfter = await a.getImportJobById(slow.id)
    expect(stalledAfter?.status).toBe('failed')
    expect(slowAfter?.status).toBe('running')
  })
})
