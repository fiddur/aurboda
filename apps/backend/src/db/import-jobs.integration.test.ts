import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  completeImportJob,
  failImportJob,
  getImportJobById,
  getLatestImportJob,
  insertImportJob,
  listImportJobs,
  reapStaleImportJobs,
  startImportJob,
  updateImportJobProgress,
} from './import-jobs.ts'

const CONTAINER_TIMEOUT = 60_000

describe('import_jobs integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), 'TRUNCATE TABLE import_jobs')
  })

  test('full lifecycle: insert → start → tick progress → complete', async () => {
    const user = getTestUser()

    const job = await insertImportJob(user, 'livsmedelsverket', 'fredrik')
    expect(job.status).toBe('pending')
    expect(job.processed_items).toBe(0)
    expect(job.skipped_items).toBe(0)
    expect(job.started_by).toBe('fredrik')

    const started = await startImportJob(user, job.id, 2575)
    expect(started?.status).toBe('running')
    expect(started?.total_items).toBe(2575)

    await updateImportJobProgress(user, job.id, 100, 3)
    const mid = await getImportJobById(user, job.id)
    expect(mid?.processed_items).toBe(100)
    expect(mid?.skipped_items).toBe(3)
    expect(mid?.last_progress_at.getTime()).toBeGreaterThanOrEqual(job.last_progress_at.getTime())

    const done = await completeImportJob(user, job.id)
    expect(done?.status).toBe('completed')
    expect(done?.completed_at).toBeDefined()
    expect(done?.error).toBeUndefined()
  })

  test('failure path stores error and stamps completed_at', async () => {
    const user = getTestUser()
    const job = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, job.id, 100)

    const failed = await failImportJob(user, job.id, 'Connection refused')
    expect(failed?.status).toBe('failed')
    expect(failed?.error).toBe('Connection refused')
    expect(failed?.completed_at).toBeDefined()
  })

  test('getActiveImportJob ignores completed/failed jobs', async () => {
    const { getActiveImportJob } = await import('./import-jobs.ts')
    const user = getTestUser()

    expect(await getActiveImportJob(user, 'livsmedelsverket')).toBeNull()

    const a = await insertImportJob(user, 'livsmedelsverket')
    const active1 = await getActiveImportJob(user, 'livsmedelsverket')
    expect(active1?.id).toBe(a.id)

    await completeImportJob(user, a.id)
    expect(await getActiveImportJob(user, 'livsmedelsverket')).toBeNull()

    const b = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, b.id, 5)
    const active2 = await getActiveImportJob(user, 'livsmedelsverket')
    expect(active2?.id).toBe(b.id)
    expect(active2?.status).toBe('running')
  })

  test('listImportJobs returns newest first; getLatestImportJob picks the right one', async () => {
    const user = getTestUser()

    const a = await insertImportJob(user, 'livsmedelsverket')
    await new Promise((r) => setTimeout(r, 5))
    const b = await insertImportJob(user, 'livsmedelsverket')

    const list = await listImportJobs(user, 'livsmedelsverket', 5)
    expect(list.map((j) => j.id)).toEqual([b.id, a.id])

    const latest = await getLatestImportJob(user, 'livsmedelsverket')
    expect(latest?.id).toBe(b.id)
  })

  test('reapStaleImportJobs uses heartbeat (last_progress_at), not start time', async () => {
    const user = getTestUser()

    // Stalled: started long ago AND no recent heartbeat.
    const stalled = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, stalled.id, 100)
    await query(
      user,
      `UPDATE import_jobs
         SET last_progress_at = NOW() - INTERVAL '30 minutes',
             started_at = NOW() - INTERVAL '2 hours'
       WHERE id = $1`,
      [stalled.id],
    )

    // Slow but live: started long ago, heartbeat is fresh.
    const slowAlive = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, slowAlive.id, 100)
    await query(user, `UPDATE import_jobs SET started_at = NOW() - INTERVAL '2 hours' WHERE id = $1`, [
      slowAlive.id,
    ])

    const reaped = await reapStaleImportJobs(user, 10)
    expect(reaped).toBe(1)

    const stalledAfter = await getImportJobById(user, stalled.id)
    const slowAfter = await getImportJobById(user, slowAlive.id)
    expect(stalledAfter?.status).toBe('failed')
    expect(stalledAfter?.error).toMatch(/stalled|restarted/i)
    expect(slowAfter?.status).toBe('running')
  })
})
