import { describe, expect, it, vi } from 'vitest'

vi.mock('./audit-log.ts', () => ({ auditError: vi.fn(), auditInfo: vi.fn() }))

import { auditInfo } from './audit-log.ts'
import {
  enrichSingletonKey,
  runSourceEnrichment,
  type SourceEnrichDeps,
  type SourceEnrichJobData,
} from './source-enrich-queue.ts'

const job = (overrides: Partial<SourceEnrichJobData> = {}): SourceEnrichJobData => ({
  key: '97248067-7947-4715-8fc9-d0048369a0d0',
  kind: 'activity',
  provider: 'gravl',
  user: 'alice',
  ...overrides,
})

const makeDeps = (overrides: Partial<SourceEnrichDeps> = {}): SourceEnrichDeps => ({
  enrichGravl: vi.fn().mockResolvedValue('enriched'),
  isGarminConnected: vi.fn().mockResolvedValue(true),
  isGravlConnected: vi.fn().mockResolvedValue(true),
  onEnriched: vi.fn(),
  syncGarmin: vi.fn().mockResolvedValue(undefined),
  ...overrides,
})

describe('enrichSingletonKey', () => {
  it('collapses Garmin jobs per user and kind but keeps Gravl jobs per workout', () => {
    expect(enrichSingletonKey(job({ key: '1', kind: 'activity', provider: 'garmin' }))).toBe(
      'alice:garmin:activity',
    )
    expect(enrichSingletonKey(job({ key: '2', kind: 'activity', provider: 'garmin' }))).toBe(
      'alice:garmin:activity',
    )
    expect(enrichSingletonKey(job({ key: '2026-09-03', kind: 'sleep', provider: 'garmin' }))).toBe(
      'alice:garmin:sleep',
    )
    expect(enrichSingletonKey(job())).toBe('alice:gravl:activity:97248067-7947-4715-8fc9-d0048369a0d0')
  })
})

describe('runSourceEnrichment', () => {
  it('fetches the Gravl workout by id and notifies', async () => {
    const deps = makeDeps()
    expect(await runSourceEnrichment(job(), deps)).toBe('enriched')
    expect(deps.enrichGravl).toHaveBeenCalledWith('alice', '97248067-7947-4715-8fc9-d0048369a0d0')
    expect(deps.onEnriched).toHaveBeenCalledWith('alice')
    expect(auditInfo).toHaveBeenCalledWith(
      'alice',
      'sync',
      expect.stringContaining('enriched'),
      expect.anything(),
    )
  })

  it('skips Gravl jobs when the user has no Gravl connection or the integration is off', async () => {
    const unconnected = makeDeps({ isGravlConnected: vi.fn().mockResolvedValue(false) })
    expect(await runSourceEnrichment(job(), unconnected)).toBe('skipped')
    expect(unconnected.enrichGravl).not.toHaveBeenCalled()

    const off = makeDeps({ enrichGravl: null })
    expect(await runSourceEnrichment(job(), off)).toBe('skipped')
    expect(off.onEnriched).not.toHaveBeenCalled()
  })

  it('treats an external round-trip workout as skipped without notifying', async () => {
    const deps = makeDeps({ enrichGravl: vi.fn().mockResolvedValue('skipped') })
    expect(await runSourceEnrichment(job(), deps)).toBe('skipped')
    expect(deps.onEnriched).not.toHaveBeenCalled()
  })

  it('runs the Garmin activities sync for an activity and the sleep sync for a night', async () => {
    const deps = makeDeps()
    expect(await runSourceEnrichment(job({ key: '24218667980', provider: 'garmin' }), deps)).toBe('enriched')
    expect(deps.syncGarmin).toHaveBeenCalledWith('alice', 'activities')
    expect(
      await runSourceEnrichment(job({ key: '2026-09-03', kind: 'sleep', provider: 'garmin' }), deps),
    ).toBe('enriched')
    expect(deps.syncGarmin).toHaveBeenLastCalledWith('alice', 'sleep')
    expect(deps.onEnriched).toHaveBeenCalledTimes(2)
  })

  it('skips Garmin jobs for users without a Garmin session', async () => {
    const deps = makeDeps({ isGarminConnected: vi.fn().mockResolvedValue(false) })
    expect(await runSourceEnrichment(job({ provider: 'garmin' }), deps)).toBe('skipped')
    expect(deps.syncGarmin).not.toHaveBeenCalled()
  })

  it('lets provider failures propagate so pg-boss retries the job', async () => {
    const deps = makeDeps({ enrichGravl: vi.fn().mockRejectedValue(new Error('Gravl API 404')) })
    await expect(runSourceEnrichment(job(), deps)).rejects.toThrow('Gravl API 404')
    expect(deps.onEnriched).not.toHaveBeenCalled()
  })
})
