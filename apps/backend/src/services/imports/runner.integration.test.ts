import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { getImportJobById } from '../../db/import-jobs.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { _setRunnerForTests, startImport } from './runner.ts'

const CONTAINER_TIMEOUT = 60_000

/**
 * Wait until the predicate returns truthy or the deadline passes. Used to
 * observe the fire-and-forget runner without polling forever.
 */
const waitFor = async (
  predicate: () => Promise<boolean> | boolean,
  { timeoutMs = 2000, intervalMs = 25 } = {},
): Promise<void> => {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error('waitFor: timed out')
}

describe('startImport runner', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('happy path marks the job completed', async () => {
    const user = getTestUser()
    let invoked = false
    _setRunnerForTests('livsmedelsverket', async () => {
      invoked = true
    })

    const job = await startImport(user, 'livsmedelsverket')
    expect(job.status).toBe('pending')

    await waitFor(async () => {
      const fresh = await getImportJobById(user, job.id)
      return fresh?.status === 'completed'
    })

    expect(invoked).toBe(true)
    const final = await getImportJobById(user, job.id)
    expect(final?.status).toBe('completed')
    expect(final?.error).toBeUndefined()
  })

  test('failure path persists the error message and marks failed', async () => {
    const user = getTestUser()
    _setRunnerForTests('livsmedelsverket', async () => {
      throw new Error('upstream 503')
    })

    const job = await startImport(user, 'livsmedelsverket')

    await waitFor(async () => {
      const fresh = await getImportJobById(user, job.id)
      return fresh?.status === 'failed'
    })

    const final = await getImportJobById(user, job.id)
    expect(final?.status).toBe('failed')
    expect(final?.error).toBe('upstream 503')
  })

  test('single-flight: a second start returns the existing pending/running job', async () => {
    const user = getTestUser()
    let resolveRunner: (() => void) | undefined
    const runnerStarted = new Promise<void>((startResolve) => {
      _setRunnerForTests('livsmedelsverket', async () => {
        startResolve()
        await new Promise<void>((r) => {
          resolveRunner = r
        })
      })
    })

    const first = await startImport(user, 'livsmedelsverket')
    await runnerStarted // ensure background runner is in-flight

    const second = await startImport(user, 'livsmedelsverket')
    expect(second.id).toBe(first.id)

    // Let the first runner finish so cleanup is clean.
    resolveRunner?.()
    await waitFor(async () => {
      const fresh = await getImportJobById(user, first.id)
      return fresh?.status === 'completed'
    })
  })
})
