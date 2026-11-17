import { describe, expect, test, vi } from 'vitest'

import type { Activity } from '../db/types.ts'

// Stub db helpers that the service touches directly (independent of injected deps)
// — keeps these unit tests off the network without expanding the deps interface.
vi.mock('../db', () => ({
  activityTypeExists: vi.fn().mockResolvedValue(true),
  ensureActivityType: vi.fn().mockResolvedValue(true),
  enqueueOutboundSync: vi.fn().mockResolvedValue(undefined),
  reanchorNotes: vi.fn().mockResolvedValue(undefined),
  replaceUserNotes: vi.fn().mockResolvedValue(undefined),
}))

import { buildMergedActivityData, mergeActivities } from './mutations.ts'

const makeActivity = (overrides: Partial<Activity> & { id: string }): Activity => ({
  activity_type: 'exercise',
  source: 'garmin',
  start_time: new Date('2026-04-02T10:00:00Z'),
  ...overrides,
})

describe('buildMergedActivityData', () => {
  test('uses earliest start_time and latest end_time', () => {
    const activities = [
      makeActivity({
        id: 'a1',
        start_time: new Date('2026-04-02T10:00:00Z'),
        end_time: new Date('2026-04-02T10:30:00Z'),
      }),
      makeActivity({
        id: 'a2',
        start_time: new Date('2026-04-02T10:40:00Z'),
        end_time: new Date('2026-04-02T11:00:00Z'),
      }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.start_time).toEqual(new Date('2026-04-02T10:00:00Z'))
    expect(result.end_time).toEqual(new Date('2026-04-02T11:00:00Z'))
  })

  test('uses first non-empty title', () => {
    const activities = [
      makeActivity({ id: 'a1', title: undefined }),
      makeActivity({ id: 'a2', title: 'Treadmill Run' }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.title).toBe('Treadmill Run')
  })

  test('title override wins over source titles', () => {
    const activities = [
      makeActivity({ id: 'a1', title: 'Run 1' }),
      makeActivity({ id: 'a2', title: 'Run 2' }),
    ]
    const result = buildMergedActivityData(activities, { title: 'Combined Run' })
    expect(result.title).toBe('Combined Run')
  })

  test('merges data objects with later overriding earlier', () => {
    const activities = [
      makeActivity({ id: 'a1', data: { exerciseType: 57, garmin_activity_id: '111' } }),
      makeActivity({ id: 'a2', data: { exerciseType: 57, garmin_activity_id: '222' } }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.data.exerciseType).toBe(57)
    expect(result.data.garmin_activity_id).toBe('222')
  })

  test('stores merged_from provenance', () => {
    const activities = [
      makeActivity({
        id: 'a1',
        source: 'garmin',
        start_time: new Date('2026-04-02T10:00:00Z'),
        end_time: new Date('2026-04-02T10:30:00Z'),
      }),
      makeActivity({
        id: 'a2',
        source: 'garmin',
        start_time: new Date('2026-04-02T10:40:00Z'),
        end_time: new Date('2026-04-02T11:00:00Z'),
      }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.data.merged_from).toEqual([
      {
        end_time: '2026-04-02T10:30:00.000Z',
        id: 'a1',
        source: 'garmin',
        start_time: '2026-04-02T10:00:00.000Z',
      },
      {
        end_time: '2026-04-02T11:00:00.000Z',
        id: 'a2',
        source: 'garmin',
        start_time: '2026-04-02T10:40:00.000Z',
      },
    ])
  })

  test.each([
    ['logged first', '2026-04-02T10:00:00Z', '2026-04-02T10:00:04Z'],
    ['watch first', '2026-04-02T10:00:04Z', '2026-04-02T10:00:00Z'],
  ])('%s: keeps the sets logged in Aurboda over the watch sets (#1777)', (_, loggedStart, watchStart) => {
    const loggedSets = [
      { exercise: 'Bench Press', reps: 8, weight: 60 },
      { exercise: 'Squat', reps: 5, weight: 100 },
    ]
    const logged = makeActivity({
      activity_type: 'strength_training',
      data: { in_progress: false, sets: loggedSets },
      id: 'logged',
      source: 'aurboda',
      start_time: new Date(loggedStart),
    })
    const watch = makeActivity({
      activity_type: 'strength_training',
      data: {
        average_hr: 100,
        garmin_activity_id: 1,
        sets: [{ exercise: 'Unknown exercise', reps: 24 }],
        sets_source: 'garmin',
      },
      id: 'watch',
      source: 'garmin',
      start_time: new Date(watchStart),
    })
    const sorted = [logged, watch].toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())

    const result = buildMergedActivityData(sorted)

    expect(result.data.sets).toEqual(loggedSets)
    expect(result.data).not.toHaveProperty('sets_source')
    expect(result.data).toMatchObject({ average_hr: 100, garmin_activity_id: 1 })
  })

  test('handles activities without end_time', () => {
    const activities = [
      makeActivity({ id: 'a1', start_time: new Date('2026-04-02T10:00:00Z') }),
      makeActivity({
        id: 'a2',
        start_time: new Date('2026-04-02T10:40:00Z'),
        end_time: new Date('2026-04-02T11:00:00Z'),
      }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.end_time).toEqual(new Date('2026-04-02T11:00:00Z'))
  })
})

describe('mergeActivities', () => {
  const makeDeps = (activitiesMap: Record<string, Activity>) => ({
    getActivityById: vi
      .fn()
      .mockImplementation((_user: string, id: string) => Promise.resolve(activitiesMap[id] ?? null)),
    insertMergedActivity: vi
      .fn()
      .mockImplementation((_user: string, activity: Activity) =>
        Promise.resolve(activity.id ?? 'generated-id'),
      ),
    materializeSuperseded: vi.fn().mockResolvedValue(undefined),
  })

  test('merges two same-type activities', async () => {
    const deps = makeDeps({
      a1: makeActivity({
        id: 'a1',
        start_time: new Date('2026-04-02T10:00:00Z'),
        end_time: new Date('2026-04-02T10:30:00Z'),
      }),
      a2: makeActivity({
        id: 'a2',
        start_time: new Date('2026-04-02T10:40:00Z'),
        end_time: new Date('2026-04-02T11:00:00Z'),
      }),
    })

    const result = await mergeActivities('user1', { activity_ids: ['a1', 'a2'] }, deps)

    expect(result.success).toBe(true)
    expect(result.activity_type).toBe('exercise')
    expect(result.start_time).toBe('2026-04-02T10:00:00.000Z')
    expect(result.end_time).toBe('2026-04-02T11:00:00.000Z')
    expect(result.id).toBeDefined()

    expect(deps.insertMergedActivity).toHaveBeenCalledOnce()
    const [, inserted, sourceIds] = deps.insertMergedActivity.mock.calls[0]
    expect(inserted.source).toBe('aurboda')
    expect(inserted.data.merged_from).toHaveLength(2)
    expect(sourceIds).toEqual(['a1', 'a2'])
  })

  test('errors on different activity types', async () => {
    const deps = makeDeps({
      a1: makeActivity({ id: 'a1', activity_type: 'exercise' }),
      a2: makeActivity({ id: 'a2', activity_type: 'sleep' }),
    })

    const result = await mergeActivities('user1', { activity_ids: ['a1', 'a2'] }, deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('different types')
  })

  test('errors on fewer than 2 IDs', async () => {
    const deps = makeDeps({})
    const result = await mergeActivities('user1', { activity_ids: ['a1'] }, deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('At least 2')
  })

  test('errors on missing activity', async () => {
    const deps = makeDeps({
      a1: makeActivity({ id: 'a1' }),
    })

    const result = await mergeActivities('user1', { activity_ids: ['a1', 'missing'] }, deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('not found')
  })

  test('errors on deleted activity', async () => {
    const deps = makeDeps({
      a1: makeActivity({ id: 'a1' }),
      a2: makeActivity({ id: 'a2', deleted_at: new Date() }),
    })

    const result = await mergeActivities('user1', { activity_ids: ['a1', 'a2'] }, deps)
    expect(result.success).toBe(false)
    expect(result.error).toContain('deleted')
  })

  test('applies title and notes overrides', async () => {
    const deps = makeDeps({
      a1: makeActivity({ id: 'a1', title: 'Run 1', end_time: new Date('2026-04-02T10:30:00Z') }),
      a2: makeActivity({
        id: 'a2',
        title: 'Run 2',
        start_time: new Date('2026-04-02T10:40:00Z'),
        end_time: new Date('2026-04-02T11:00:00Z'),
      }),
    })

    const result = await mergeActivities('user1', { activity_ids: ['a1', 'a2'], title: 'Combined Run' }, deps)

    expect(result.success).toBe(true)
    expect(result.title).toBe('Combined Run')
  })
})
