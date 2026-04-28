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
    expect(job.started_by).toBe('fredrik')

    const started = await startImportJob(user, job.id, 2575)
    expect(started?.status).toBe('running')
    expect(started?.total_items).toBe(2575)

    await updateImportJobProgress(user, job.id, 100)
    const mid = await getImportJobById(user, job.id)
    expect(mid?.processed_items).toBe(100)

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

  test('reapStaleImportJobs only fails jobs older than cutoff', async () => {
    const user = getTestUser()

    const oldJob = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, oldJob.id, 100)
    // Pretend the old job started 2 hours ago.
    await query(user, `UPDATE import_jobs SET started_at = NOW() - INTERVAL '2 hours' WHERE id = $1`, [
      oldJob.id,
    ])

    const recentJob = await insertImportJob(user, 'livsmedelsverket')
    await startImportJob(user, recentJob.id, 100)

    const reaped = await reapStaleImportJobs(user, 60)
    expect(reaped).toBe(1)

    const oldAfter = await getImportJobById(user, oldJob.id)
    const recentAfter = await getImportJobById(user, recentJob.id)
    expect(oldAfter?.status).toBe('failed')
    expect(oldAfter?.error).toMatch(/restarted/i)
    expect(recentAfter?.status).toBe('running')
  })
})
