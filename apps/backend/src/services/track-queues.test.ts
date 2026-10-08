import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))

import { auditInfo } from './audit-log.ts'
import { runTrackBackfillJob } from './track-queues.ts'

const emptyDeps = {
  getGarminCandidates: vi.fn(async () => []),
  getStravaCandidates: vi.fn(async () => []),
  matchRoutes: vi.fn(async () => ({ created: 0, matched: 0 })),
  upsertActivityTrack: vi.fn(async () => undefined),
}

describe('runTrackBackfillJob', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('runs the backfill for the job user and stays quiet when there was nothing to do', async () => {
    const result = await runTrackBackfillJob({ user: 'alice' }, emptyDeps)

    expect(result).toEqual({ garmin: 0, routes: { created: 0, matched: 0 }, skipped: 0, strava: 0 })
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

    expect(result).toEqual({ garmin: 0, routes: { created: 0, matched: 0 }, skipped: 0, strava: 1 })
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
})
