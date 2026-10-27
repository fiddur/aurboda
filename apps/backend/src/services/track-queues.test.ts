import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))
vi.mock('./run-category-rules', () => ({ ensureDefaultRunCategoryRules: vi.fn() }))

import { auditInfo } from './audit-log.ts'
import { runTrackBackfillJob } from './track-queues.ts'

const emptyDeps = {
  computeFeatures: vi.fn(async () => null),
  deleteAllFeatures: vi.fn(async () => 0),
  ensureDefaultRules: vi.fn(async () => undefined),
  getGarminCandidates: vi.fn(async () => []),
  getStravaCandidates: vi.fn(async () => []),
  listActivitiesWithoutFeatures: vi.fn(async (): Promise<{ activity_id: string }[]> => []),
  matchRoutes: vi.fn(async () => ({ created: 0, matched: 0 })),
  notify: vi.fn(),
  upsertActivityTrack: vi.fn(async () => undefined),
}

describe('runTrackBackfillJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('runs the backfill for the job user and stays quiet when there was nothing to do', async () => {
    const result = await runTrackBackfillJob({ user: 'alice' }, emptyDeps)

    expect(result).toEqual({
      features: { computed: 0 },
      garmin: 0,
      routes: { created: 0, matched: 0 },
      skipped: 0,
      strava: 0,
    })
    expect(emptyDeps.getGarminCandidates).toHaveBeenCalledWith('alice', { after: undefined, limit: 50 })
    expect(emptyDeps.matchRoutes).toHaveBeenCalledWith('alice')
    expect(auditInfo).not.toHaveBeenCalled()
  })

  test('audits the counts when it wrote or skipped something', async () => {
    const deps = {
      ...emptyDeps,
      getStravaCandidates: vi.fn(async () => [
        { activity_id: 's1', elapsed_seconds: 60, polyline: '_p~iF~ps|U_ulLnnqC', start_time: new Date() },
      ]),
    }

    const result = await runTrackBackfillJob({ user: 'alice' }, deps)

    expect(result).toEqual({
      features: { computed: 0 },
      garmin: 0,
      routes: { created: 0, matched: 0 },
      skipped: 0,
      strava: 1,
    })
    expect(auditInfo).toHaveBeenCalledWith('alice', 'data', expect.any(String), {
      garmin: 0,
      skipped: 0,
      strava: 1,
    })
  })

  test('matches routes after the backfill and audits what it matched', async () => {
    const order: string[] = []
    const deps = {
      ...emptyDeps,
      getStravaCandidates: vi.fn(async () => {
        order.push('backfill')
        return []
      }),
      matchRoutes: vi.fn(async () => {
        order.push('routes')
        return { created: 1, matched: 2 }
      }),
    }

    const result = await runTrackBackfillJob({ user: 'alice' }, deps)

    expect(order).toEqual(['backfill', 'routes'])
    expect(result.routes).toEqual({ created: 1, matched: 2 })
    expect(auditInfo).toHaveBeenCalledWith('alice', 'data', expect.any(String), { created: 1, matched: 2 })
  })

  test('computes missing features after route matching and notifies their span', async () => {
    const start = new Date('2026-05-01T08:00:00Z')
    const end = new Date('2026-05-01T09:00:00Z')
    const order: string[] = []
    const deps = {
      ...emptyDeps,
      computeFeatures: vi.fn(async () => {
        order.push('features')
        return { activity_type: 'running', end, start }
      }),
      listActivitiesWithoutFeatures: vi.fn(async () => [{ activity_id: 'a1' }]),
      matchRoutes: vi.fn(async () => {
        order.push('routes')
        return { created: 0, matched: 0 }
      }),
    }

    const result = await runTrackBackfillJob({ user: 'alice' }, deps)

    expect(order).toEqual(['routes', 'features'])
    expect(result.features).toEqual({ computed: 1 })
    expect(deps.computeFeatures).toHaveBeenCalledWith('alice', 'a1')
    expect(deps.ensureDefaultRules).toHaveBeenCalledWith('alice', 'running')
    expect(deps.notify).toHaveBeenCalledWith('alice', '*', start, end)
  })

  test('a recompute job deletes the stored features first', async () => {
    await runTrackBackfillJob({ recompute_features: true, user: 'alice' }, emptyDeps)
    expect(emptyDeps.deleteAllFeatures).toHaveBeenCalledWith('alice')

    vi.clearAllMocks()
    await runTrackBackfillJob({ user: 'alice' }, emptyDeps)
    expect(emptyDeps.deleteAllFeatures).not.toHaveBeenCalled()
  })
})
