import { describe, expect, test, vi } from 'vitest'

import type { Activity } from '../db/types.ts'

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

  test('concatenates notes from all sources', () => {
    const activities = [
      makeActivity({ id: 'a1', notes: 'First part' }),
      makeActivity({ id: 'a2', notes: 'Second part' }),
    ]
    const result = buildMergedActivityData(activities)
    expect(result.notes).toBe('First part\nSecond part')
  })

  test('notes override wins over concatenation', () => {
    const activities = [
      makeActivity({ id: 'a1', notes: 'First part' }),
      makeActivity({ id: 'a2', notes: 'Second part' }),
    ]
    const result = buildMergedActivityData(activities, { notes: 'Merged notes' })
    expect(result.notes).toBe('Merged notes')
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
    deleteActivity: vi.fn().mockResolvedValue(true),
    getActivityById: vi
      .fn()
      .mockImplementation((_user: string, id: string) => Promise.resolve(activitiesMap[id] ?? null)),
    insertActivity: vi.fn().mockResolvedValue(undefined),
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

    // Should insert one new activity
    expect(deps.insertActivity).toHaveBeenCalledOnce()
    const inserted = deps.insertActivity.mock.calls[0][1]
    expect(inserted.source).toBe('aurboda')
    expect(inserted.data.merged_from).toHaveLength(2)

    // Should delete both originals
    expect(deps.deleteActivity).toHaveBeenCalledTimes(2)
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

    const result = await mergeActivities(
      'user1',
      { activity_ids: ['a1', 'a2'], title: 'Combined Run', notes: 'Merged' },
      deps,
    )

    expect(result.success).toBe(true)
    expect(result.title).toBe('Combined Run')
    expect(result.notes).toBe('Merged')
  })
})
