import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest'

import type { CentralDb } from '../central-db.ts'
import type { CentralImportJobEntity } from '../central-import-jobs.ts'

import { _setRunnerForTests, startImport } from './runner.ts'

const job = (overrides: Partial<CentralImportJobEntity> = {}): CentralImportJobEntity => ({
  error: undefined,
  id: 'job-1',
  last_progress_at: new Date(),
  processed_items: 0,
  skipped_items: 0,
  source: 'livsmedelsverket',
  started_at: new Date(),
  started_by: undefined,
  status: 'pending',
  total_items: undefined,
  ...overrides,
})

const fakeCentral = (): CentralDb =>
  ({
    completeImportJob: vi.fn().mockResolvedValue(job({ status: 'completed' })),
    failImportJob: vi.fn().mockResolvedValue(job({ status: 'failed' })),
    getActiveImportJob: vi.fn().mockResolvedValue(null),
    insertImportJob: vi.fn().mockResolvedValue(job()),
    startImportJob: vi.fn(),
    updateImportJobProgress: vi.fn(),
  }) as unknown as CentralDb

const flushMicrotasks = () => new Promise<void>((resolve) => setImmediate(resolve))

describe('startImport', () => {
  let originalRunner: ((centralDb: CentralDb, jobId: string) => Promise<void>) | undefined

  beforeEach(() => {
    originalRunner = undefined
  })

  afterEach(() => {
    // Restore — leaves a trivial passthrough so other suites don't see a stale stub.
    _setRunnerForTests('livsmedelsverket', async () => {})
  })

  test('happy path: inserts pending job, runs runner, marks completed', async () => {
    const central = fakeCentral()
    const runner = vi.fn().mockResolvedValue(undefined)
    _setRunnerForTests('livsmedelsverket', runner)

    const result = await startImport(central, 'livsmedelsverket', 'fredrik')
    expect(result.status).toBe('pending')
    expect(central.insertImportJob).toHaveBeenCalledWith('livsmedelsverket', 'fredrik')

    // The actual import work runs as a fire-and-forget promise — wait for it.
    await flushMicrotasks()
    await flushMicrotasks()

    expect(runner).toHaveBeenCalledWith(central, 'job-1')
    expect(central.completeImportJob).toHaveBeenCalledWith('job-1')
    expect(central.failImportJob).not.toHaveBeenCalled()
  })

  test('failure path: persists the error message via failImportJob', async () => {
    const central = fakeCentral()
    _setRunnerForTests('livsmedelsverket', async () => {
      throw new Error('upstream 503')
    })
    // Suppress the expected console.error.
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

    await startImport(central, 'livsmedelsverket')
    await flushMicrotasks()
    await flushMicrotasks()

    expect(central.failImportJob).toHaveBeenCalledWith('job-1', 'upstream 503')
    expect(central.completeImportJob).not.toHaveBeenCalled()
    errSpy.mockRestore()
  })

  test('single-flight: returns existing pending/running job without insert or run', async () => {
    const central = fakeCentral()
    const existing = job({ id: 'existing-job', status: 'running' })
    vi.mocked(central.getActiveImportJob).mockResolvedValue(existing)
    const runner = vi.fn()
    _setRunnerForTests('livsmedelsverket', runner)

    const result = await startImport(central, 'livsmedelsverket')
    expect(result.id).toBe('existing-job')
    expect(central.insertImportJob).not.toHaveBeenCalled()

    await flushMicrotasks()
    expect(runner).not.toHaveBeenCalled()
  })
})
