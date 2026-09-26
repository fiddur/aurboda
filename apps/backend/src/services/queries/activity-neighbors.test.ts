import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { Activity } from '../../db/types.ts'

import * as db from '../../db/index.ts'
import { getActivityNeighbors } from './activity-neighbors.ts'

vi.mock('../../db', () => ({
  findAdjacentActivity: vi.fn(),
  getActivityById: vi.fn(),
  getOverlappingActivities: vi.fn(),
}))

const row = (id: string, startIso: string, minutes: number, extra: Partial<Activity> = {}): Activity => {
  const start_time = new Date(startIso)
  return {
    activity_type: 'yoga',
    end_time: new Date(start_time.getTime() + minutes * 60_000),
    id,
    source: 'garmin',
    start_time,
    ...extra,
  }
}

// The current session, merged from a Garmin and a Strava row that starts a little later
const current = row('cur-garmin', '2026-09-20T07:00:00Z', 26, { data: { session_name: 'Flow' } })
const currentStrava = row('cur-strava', '2026-09-20T07:00:05Z', 26, {
  source: 'strava',
  title: 'Morning Yoga',
})

const prev = row('prev', '2026-09-18T07:00:00Z', 40, { title: 'Yin' })
const nextStrava = row('next-strava', '2026-09-22T07:00:03Z', 30, { source: 'strava' })
const nextGarmin = row('next-garmin', '2026-09-22T07:00:00Z', 31, { title: 'Flow again' })

const groups = new Map<string, Activity[]>([
  ['cur-garmin', [current, currentStrava]],
  ['cur-strava', [current, currentStrava]],
  ['prev', [prev]],
  ['next-strava', [nextGarmin, nextStrava]],
])

describe('getActivityNeighbors', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(db.getOverlappingActivities).mockImplementation((_u, a) =>
      Promise.resolve(groups.get(a.id!) ?? []),
    )
    vi.mocked(db.findAdjacentActivity).mockImplementation((_u, _t, direction) =>
      Promise.resolve(direction === 'previous' ? prev : nextStrava),
    )
  })

  test('steps over the merge group from its earliest start, and links merged neighbors by their anchor', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(currentStrava)

    const result = await getActivityNeighbors('u', 'merged:cur-strava')

    expect(vi.mocked(db.getActivityById)).toHaveBeenCalledWith('u', 'cur-strava', true)
    for (const direction of ['previous', 'next']) {
      expect(vi.mocked(db.findAdjacentActivity)).toHaveBeenCalledWith(
        'u',
        'yoga',
        direction,
        current.start_time,
        ['cur-garmin', 'cur-strava'],
        undefined,
      )
    }
    expect(result).toEqual({
      activity_type: 'yoga',
      next: {
        end_time: '2026-09-22T07:31:00.000Z',
        id: 'merged:next-garmin',
        start_time: '2026-09-22T07:00:00.000Z',
        title: 'Flow again',
      },
      previous: {
        end_time: '2026-09-18T07:40:00.000Z',
        id: 'prev',
        start_time: '2026-09-18T07:00:00.000Z',
        title: 'Yin',
      },
    })
  })

  test('same_field filters on the merged value of that field', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(currentStrava)

    await getActivityNeighbors('u', 'cur-strava', 'session_name')

    expect(vi.mocked(db.findAdjacentActivity).mock.calls.map((c) => c[5])).toEqual([
      [{ field: 'session_name', value: 'Flow' }],
      [{ field: 'session_name', value: 'Flow' }],
    ])
  })

  test('same_field without a value on this activity → no neighbors, no lookups', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(prev)

    expect(await getActivityNeighbors('u', 'prev', 'session_name')).toEqual({ activity_type: 'yoga' })
    expect(db.findAdjacentActivity).not.toHaveBeenCalled()
  })

  test('none on either side, and null for a missing activity', async () => {
    vi.mocked(db.getActivityById).mockResolvedValueOnce(prev)
    vi.mocked(db.findAdjacentActivity).mockResolvedValue(null)
    expect(await getActivityNeighbors('u', 'prev')).toEqual({
      activity_type: 'yoga',
      next: undefined,
      previous: undefined,
    })

    vi.mocked(db.getActivityById).mockResolvedValueOnce(null)
    expect(await getActivityNeighbors('u', 'missing')).toBeNull()
  })

  test('a deleted activity is its own group', async () => {
    vi.mocked(db.getActivityById).mockResolvedValue(
      row('del', '2026-09-20T07:00:00Z', 20, { deleted_at: new Date() }),
    )

    await getActivityNeighbors('u', 'del')

    expect(vi.mocked(db.findAdjacentActivity).mock.calls[0]![4]).toEqual(['del'])
    expect(vi.mocked(db.getOverlappingActivities).mock.calls.map((c) => c[1].id)).not.toContain('del')
  })
})
