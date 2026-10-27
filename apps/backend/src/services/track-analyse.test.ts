import { beforeEach, describe, expect, test, vi } from 'vitest'

vi.mock('./audit-log', () => ({ auditError: vi.fn(), auditInfo: vi.fn(), auditWarn: vi.fn() }))
vi.mock('./run-category-rules', () => ({ ensureDefaultRunCategoryRules: vi.fn() }))

import { auditError, auditInfo } from './audit-log.ts'
import { analyseTrack, backfillActivityFeatures } from './track-analyse.ts'

const start = new Date('2026-05-01T08:00:00Z')
const end = new Date('2026-05-01T09:00:00Z')
const analysed = { activity_type: 'running', end, start }

const makeDeps = () => ({
  computeFeatures: vi.fn(async () => analysed),
  ensureDefaultRules: vi.fn(async () => undefined),
  matchRoute: vi.fn(async () => undefined),
  notify: vi.fn(),
})

describe('analyseTrack', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('matches the route, computes features, seeds the rules and notifies over the activity span', async () => {
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
    expect(deps.matchRoute).toHaveBeenCalledWith('alice', 'a1')
    expect(deps.computeFeatures).toHaveBeenCalledWith('alice', 'a1')
    expect(deps.ensureDefaultRules).toHaveBeenCalledWith('alice')
    expect(deps.notify).toHaveBeenCalledWith('alice', 'running', start, end)
  })

  test('does not notify or seed rules when no features were stored', async () => {
    const deps = { ...makeDeps(), computeFeatures: vi.fn(async () => null) }

    await analyseTrack('alice', 'a1', deps)

    expect(deps.ensureDefaultRules).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
  })

  test('a failed route match is audited and features are still computed', async () => {
    const deps = { ...makeDeps(), matchRoute: vi.fn(async () => Promise.reject(new Error('boom'))) }

    await analyseTrack('alice', 'a1', deps)

    expect(auditError).toHaveBeenCalledWith('alice', 'data', expect.any(String), {
      activity_id: 'a1',
      error: 'Error: boom',
    })
    expect(deps.computeFeatures).toHaveBeenCalled()
    expect(deps.notify).toHaveBeenCalled()
  })

  test('a failed feature computation is audited and nothing is notified', async () => {
    const deps = { ...makeDeps(), computeFeatures: vi.fn(async () => Promise.reject(new Error('bad'))) }

    await analyseTrack('alice', 'a1', deps)

    expect(auditError).toHaveBeenCalledTimes(1)
    expect(deps.notify).not.toHaveBeenCalled()
  })

  test('a failed rule seeding is audited and the span is still notified', async () => {
    const deps = { ...makeDeps(), ensureDefaultRules: vi.fn(async () => Promise.reject(new Error('seed'))) }

    await analyseTrack('alice', 'a1', deps)

    expect(auditError).toHaveBeenCalledTimes(1)
    expect(deps.notify).toHaveBeenCalledWith('alice', 'running', start, end)
  })
})

describe('backfillActivityFeatures', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('does nothing when every tracked activity already has features', async () => {
    const deps = { ...makeDeps(), listActivitiesWithoutFeatures: vi.fn(async () => []) }

    expect(await backfillActivityFeatures('alice', deps)).toEqual({ computed: 0 })
    expect(deps.ensureDefaultRules).not.toHaveBeenCalled()
    expect(deps.notify).not.toHaveBeenCalled()
    expect(auditInfo).not.toHaveBeenCalled()
  })

  test('computes each pending activity and notifies once over their whole span', async () => {
    const later = {
      activity_type: 'running',
      end: new Date('2026-06-01T09:00:00Z'),
      start: new Date('2026-06-01T08:00:00Z'),
    }
    const deps = {
      ...makeDeps(),
      computeFeatures: vi.fn(async (_user: string, id: string) =>
        id === 'a2' ? later : id === 'a3' ? Promise.reject(new Error('x')) : id === 'a4' ? null : analysed,
      ),
      listActivitiesWithoutFeatures: vi.fn(async () => [
        { activity_id: 'a2' },
        { activity_id: 'a1' },
        { activity_id: 'a3' },
        { activity_id: 'a4' },
      ]),
    }

    const result = await backfillActivityFeatures('alice', deps)

    expect(result).toEqual({ computed: 2 })
    expect(deps.computeFeatures).toHaveBeenCalledTimes(4)
    expect(auditError).toHaveBeenCalledTimes(1)
    expect(deps.ensureDefaultRules).toHaveBeenCalledTimes(1)
    expect(deps.notify).toHaveBeenCalledTimes(1)
    expect(deps.notify).toHaveBeenCalledWith('alice', '*', start, later.end)
    expect(auditInfo).toHaveBeenCalledWith('alice', 'data', expect.any(String), { computed: 2 })
  })
})
