import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Activity } from '../db/types.ts'

vi.mock('./audit-log', () => ({
  auditError: vi.fn(),
  auditInfo: vi.fn(),
  auditWarn: vi.fn(),
}))
vi.mock('./run-category-rules', () => ({
  ensureDefaultRunCategoryRules: vi.fn(),
}))

import { auditError, auditInfo } from './audit-log.ts'
import {
  analyseTrack,
  backfillActivityFeatures,
  notifyWindows,
  reanalyseActivities,
  reanalyseOverrideTargets,
} from './track-analyse.ts'

const start = new Date('2026-05-01T08:00:00Z')
const end = new Date('2026-05-01T09:00:00Z')
const analysed = { activity_type: 'running', end, start }
const day = (n: number, hour = 8) => new Date(Date.UTC(2026, 4, n, hour))

const makeDeps = () => ({
  computeFeatures: vi.fn(async () => analysed),
  deleteAllFeatures: vi.fn(async () => 0),
  ensureDefaultRules: vi.fn(async () => undefined),
  listActivitiesWithoutFeatures: vi.fn(async (): Promise<{ activity_id: string }[]> => []),
  matchRoute: vi.fn(async () => undefined),
  notify: vi.fn(),
})

describe('analyseTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('matches the route, computes features, seeds the rules for the type and notifies the span', async () => {
    const order: string[] = []
    const deps = {
      computeFeatures: vi.fn(async () => {
        order.push('features')
        return analysed
      }),
      ensureDefaultRules: vi.fn(async () => {
        order.push('rules')
      }),
      matchRoute: vi.fn(async () => {
        order.push('route')
      }),
      notify: vi.fn(() => {
        order.push('notify')
      }),
    }

    await analyseTrack('alice', 'a1', deps)

    expect(order).toEqual(['route', 'features', 'rules', 'notify'])
    expect(deps.ensureDefaultRules).toHaveBeenCalledWith('alice', 'running')
    expect(deps.notify).toHaveBeenCalledWith('alice', 'running', start, end)
  })

  test('does not notify or seed rules when no features were stored', async () => {
    const deps = { ...makeDeps(), computeFeatures: vi.fn(async () => null) }

    await analyseTrack('alice', 'a1', deps)

    expect(deps.ensureDefaultRules).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  test('a failed route match is audited, the other steps still run, and the job is failed for a retry', async () => {
    const deps = {
      ...makeDeps(),
      matchRoute: vi.fn(async () => Promise.reject(new Error('boom'))),
    }

    await expect(analyseTrack('alice', 'a1', deps)).rejects.toThrow(/Route matching failed: Error: boom/)

    expect(auditError).toHaveBeenCalledWith('alice', 'data', expect.any(String), {
      activity_id: 'a1',
      error: 'Error: boom',
    })
    expect(deps.computeFeatures).toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalled()
  })

  test('a failed feature computation fails the job and nothing is notified', async () => {
    const deps = {
      ...makeDeps(),
      computeFeatures: vi.fn(async () => Promise.reject(new Error('bad'))),
    }

    await expect(analyseTrack('alice', 'a1', deps)).rejects.toThrow(/bad/)

    expect(auditError).toHaveBeenCalledTimes(1)
    expect(deps.notify).not.toHaveBeenCalled()
  })

  test('a failed rule seeding still notifies, then fails the job', async () => {
    const deps = {
      ...makeDeps(),
      ensureDefaultRules: vi.fn(async () => Promise.reject(new Error('seed'))),
    }

    await expect(analyseTrack('alice', 'a1', deps)).rejects.toThrow(/seed/)

    expect(deps.notify).toHaveBeenCalledWith('alice', 'running', start, end)
  })

  test('a throwing notifier is collected like any step', async () => {
    const deps = {
      ...makeDeps(),
      notify: vi.fn(() => {
        throw new Error('queue down')
      }),
    }

    await expect(analyseTrack('alice', 'a1', deps)).rejects.toThrow(/queue down/)
    expect(auditError).toHaveBeenCalledTimes(1)
  })

  test('every failure ends up in the one error', async () => {
    const deps = {
      ...makeDeps(),
      ensureDefaultRules: vi.fn(async () => Promise.reject(new Error('seed'))),
      matchRoute: vi.fn(async () => Promise.reject(new Error('route'))),
    }

    await expect(analyseTrack('alice', 'a1', deps)).rejects.toThrow(/route.*seed/)
  })
})

describe('notifyWindows', () => {
  test('groups sorted spans into windows of at most 30 days', () => {
    const spans = [
      { end: day(20, 9), start: day(20) },
      { end: day(1, 9), start: day(1) },
      { end: day(29, 9), start: day(29) },
      {
        end: new Date(Date.UTC(2026, 5, 2, 9)),
        start: new Date(Date.UTC(2026, 5, 2)),
      },
    ]

    expect(notifyWindows(spans)).toEqual([
      { end: day(29, 9), start: day(1) },
      {
        end: new Date(Date.UTC(2026, 5, 2, 9)),
        start: new Date(Date.UTC(2026, 5, 2)),
      },
    ])
  })

  test('nothing for no spans', () => {
    expect(notifyWindows([])).toEqual([])
  })
})

describe('backfillActivityFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('does nothing when every tracked activity already has features', async () => {
    const deps = makeDeps()

    expect(await backfillActivityFeatures('alice', deps)).toEqual({
      computed: 0,
    })
    expect(deps.deleteAllFeatures).not.toHaveBeenCalled()
    expect(deps.ensureDefaultRules).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(auditInfo).not.toHaveBeenCalled()
  })

  test('a recompute deletes every feature before listing what is missing', async () => {
    const order: string[] = []
    const deps = {
      ...makeDeps(),
      deleteAllFeatures: vi.fn(async () => {
        order.push('delete')
        return 3
      }),
      listActivitiesWithoutFeatures: vi.fn(async () => {
        order.push('list')
        return []
      }),
    }

    await backfillActivityFeatures('alice', deps, { recompute: true })

    expect(order).toEqual(['delete', 'list'])
  })

  test('computes each pending activity, seeds once per type and notifies per 30-day window', async () => {
    const later = {
      activity_type: 'trail_running',
      end: day(31, 8),
      start: day(31, 7),
    }
    const muchLater = {
      activity_type: 'running',
      end: new Date('2026-09-01T09:00:00Z'),
      start: new Date('2026-09-01T08:00:00Z'),
    }
    const results: Record<string, unknown> = {
      a1: analysed,
      a2: later,
      a4: null,
      a5: muchLater,
    }
    const deps = {
      ...makeDeps(),
      computeFeatures: vi.fn(async (_user: string, id: string) =>
        id === 'a3' ? Promise.reject(new Error('x')) : (results[id] as typeof analysed | null),
      ),
      listActivitiesWithoutFeatures: vi.fn(async () =>
        ['a2', 'a1', 'a3', 'a4', 'a5'].map((activity_id) => ({ activity_id })),
      ),
    }

    const result = await backfillActivityFeatures('alice', deps)

    expect(result).toEqual({ computed: 3 })
    expect(auditError).toHaveBeenCalledTimes(1)
    expect(deps.ensureDefaultRules.mock.calls).toEqual([
      ['alice', 'trail_running'],
      ['alice', 'running'],
    ])
    expect(deps.notify.mock.calls).toEqual([
      ['alice', '*', start, later.end],
      ['alice', '*', muchLater.start, muchLater.end],
    ])
    expect(auditInfo).toHaveBeenCalledWith('alice', 'data', expect.any(String), { computed: 3 })
  })
})

const reanalyseDeps = () => ({
  getActivity: vi.fn(
    async (_user: string, id: string): Promise<Activity | null> => ({
      activity_type: id === 'strava-1' ? 'running' : 'walking',
      id,
      source: 'garmin',
      start_time: start,
    }),
  ),
  recomputeFeatures: vi.fn(async (_user: string, _id: string): Promise<unknown> => undefined),
  rematchRoutes: vi.fn(async (_user: string, _ids: string[]): Promise<unknown> => []),
})

describe('reanalyseActivities', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('re-matches routes, then recomputes features for each row, auditing failures without throwing', async () => {
    const deps = {
      ...reanalyseDeps(),
      recomputeFeatures: vi.fn(async (_user: string, id: string) =>
        id === 'b' ? Promise.reject(new Error('no db')) : undefined,
      ),
      rematchRoutes: vi.fn(async () => Promise.reject(new Error('locked'))),
    }

    await reanalyseActivities('alice', ['a', 'b', 'c'], deps)

    expect(deps.rematchRoutes).toHaveBeenCalledWith('alice', ['a', 'b', 'c'])
    expect(deps.recomputeFeatures.mock.calls.map((c) => c[1])).toEqual(['a', 'b', 'c'])
    expect(auditError).toHaveBeenCalledTimes(2)
  })
})

describe('reanalyseOverrideTargets', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('re-analyses the targets when one of them has another type than the override', async () => {
    const deps = reanalyseDeps()

    await reanalyseOverrideTargets(
      'alice',
      {
        activity_type: 'running',
        override_target_ids: ['garmin-1', 'strava-1'],
      },
      deps,
    )

    expect(deps.rematchRoutes).toHaveBeenCalledWith('alice', ['garmin-1', 'strava-1'])
  })

  test('leaves the targets alone when the override kept their type, or for a plain row', async () => {
    const deps = reanalyseDeps()

    await reanalyseOverrideTargets(
      'alice',
      { activity_type: 'running', override_target_ids: ['strava-1'] },
      deps,
    )
    await reanalyseOverrideTargets('alice', { activity_type: 'running' }, deps)

    expect(deps.getActivity).toHaveBeenCalledTimes(1)
    expect(deps.rematchRoutes).not.toHaveBeenCalled()
  })
})
