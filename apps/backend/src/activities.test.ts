import { describe, expect, test } from 'vitest'
import { mergeOverlappingActivities, type Activity, type MergedActivity } from './db'

describe('mergeOverlappingActivities', () => {
  const makeActivity = (overrides: Partial<Activity>): Activity => ({
    activity_type: 'exercise',
    source: 'health_connect',
    start_time: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  })

  test('returns empty array for empty input', () => {
    expect(mergeOverlappingActivities([])).toEqual([])
  })

  test('returns single activity unchanged', () => {
    const activity = makeActivity({
      end_time: new Date('2024-01-15T11:00:00Z'),
      title: 'Running',
    })
    const result = mergeOverlappingActivities([activity])
    expect(result).toHaveLength(1)
    expect(result[0]).toEqual(activity)
  })

  test('does not merge non-overlapping activities of same type', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Morning run',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T15:00:00Z'),
        start_time: new Date('2024-01-15T14:00:00Z'),
        title: 'Evening run',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(2)
  })

  test('merges overlapping activities of same type', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Strength training',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:05:00Z'),
        source: 'manual',
        start_time: new Date('2024-01-15T10:05:00Z'),
        title: 'Weight lifting',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T11:05:00Z'))
  })

  test('uses earliest start and latest end when merging', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T12:00:00Z'),
        start_time: new Date('2024-01-15T11:00:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T12:00:00Z'))
  })

  test('does not merge activities of different types', () => {
    const activities = [
      makeActivity({
        activity_type: 'exercise',
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'meditation',
        end_time: new Date('2024-01-15T10:30:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(2)
  })

  test('merges three overlapping activities into one', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T10:30:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Part 1',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:15:00Z'),
        title: 'Part 2',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:45:00Z'),
        title: 'Part 3',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T11:30:00Z'))
  })

  test('handles activity without end_time by using start_time for overlap check', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Completed workout',
      }),
      makeActivity({
        // No end_time - ongoing or point-in-time activity starting during the first
        start_time: new Date('2024-01-15T10:30:00Z'),
        title: 'Ongoing workout',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    // Should merge because second starts within first's time range
    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T11:00:00Z'))
  })

  test('keeps first title when merging activities with titles', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'First title',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:30:00Z'),
        title: 'Second title',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('First title')
  })

  test('uses available title when first activity has no title', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        // No title
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:30:00Z'),
        title: 'The title',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('The title')
  })

  test('merges data objects from overlapping activities', () => {
    const activities = [
      makeActivity({
        data: { exerciseType: 'strength_training', sets: 3 },
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        data: { avgHeartRate: 120, maxHeartRate: 150 },
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].data).toEqual({
      avgHeartRate: 120,
      exerciseType: 'strength_training',
      maxHeartRate: 150,
      sets: 3,
    })
  })

  test('concatenates notes with newline when merging', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        notes: 'First note',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        notes: 'Second note',
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].notes).toBe('First note\nSecond note')
  })

  test('preserves notes when only one activity has notes', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        notes: 'Only note',
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].notes).toBe('Only note')
  })

  test('keeps first source when merging', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        source: 'manual',
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].source).toBe('health_connect')
  })

  test('handles multiple separate groups of overlapping activities', () => {
    const activities = [
      // Morning workout group
      makeActivity({
        end_time: new Date('2024-01-15T08:00:00Z'),
        start_time: new Date('2024-01-15T07:00:00Z'),
        title: 'Morning A',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T08:30:00Z'),
        start_time: new Date('2024-01-15T07:30:00Z'),
        title: 'Morning B',
      }),
      // Evening workout group
      makeActivity({
        end_time: new Date('2024-01-15T19:00:00Z'),
        start_time: new Date('2024-01-15T18:00:00Z'),
        title: 'Evening A',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T19:30:00Z'),
        start_time: new Date('2024-01-15T18:30:00Z'),
        title: 'Evening B',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(2)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T07:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T08:30:00Z'))
    expect(result[1].start_time).toEqual(new Date('2024-01-15T18:00:00Z'))
    expect(result[1].end_time).toEqual(new Date('2024-01-15T19:30:00Z'))
  })

  test('merges activities that touch exactly at boundary', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T12:00:00Z'),
        start_time: new Date('2024-01-15T11:00:00Z'), // Starts exactly when previous ends
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    // Activities that touch should be merged (same workout logged as two parts)
    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T12:00:00Z'))
  })

  test('handles unsorted input correctly', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        start_time: new Date('2024-01-15T10:30:00Z'),
        title: 'Second',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'First',
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('First') // First by start_time should be kept
  })

  test('preserves id from first activity when merging', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'first-id',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: 'second-id',
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('first-id')
  })

  test('single activity has no source_ids', () => {
    const activity = makeActivity({
      end_time: new Date('2024-01-15T11:00:00Z'),
      id: 'only-id',
      title: 'Solo workout',
    })
    const result = mergeOverlappingActivities([activity]) as MergedActivity[]
    expect(result).toHaveLength(1)
    expect(result[0].source_ids).toBeUndefined()
  })

  test('two merged activities have source_ids with both IDs', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'first-id',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: 'second-id',
        start_time: new Date('2024-01-15T10:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities) as MergedActivity[]
    expect(result).toHaveLength(1)
    expect(result[0].source_ids).toEqual(['first-id', 'second-id'])
  })

  test('two separate groups each track source_ids independently', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T08:00:00Z'),
        id: 'morning-a',
        start_time: new Date('2024-01-15T07:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T08:30:00Z'),
        id: 'morning-b',
        start_time: new Date('2024-01-15T07:30:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T19:00:00Z'),
        id: 'evening-a',
        start_time: new Date('2024-01-15T18:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T19:30:00Z'),
        id: 'evening-b',
        start_time: new Date('2024-01-15T18:30:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities) as MergedActivity[]
    expect(result).toHaveLength(2)
    expect(result[0].source_ids).toEqual(['morning-a', 'morning-b'])
    expect(result[1].source_ids).toEqual(['evening-a', 'evening-b'])
  })

  test('three merged activities track all source_ids', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: 'id-1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'id-2',
        start_time: new Date('2024-01-15T10:15:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: 'id-3',
        start_time: new Date('2024-01-15T10:45:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities) as MergedActivity[]
    expect(result).toHaveLength(1)
    expect(result[0].source_ids).toEqual(['id-1', 'id-2', 'id-3'])
  })
})
