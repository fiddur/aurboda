import { describe, expect, test } from 'vitest'

import {
  findMergedGroupForActivity,
  mergeOverlappingActivities,
  type Activity,
  type MergedActivity,
} from './db/index.ts'

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

  test('does not merge activities of different types (without categoryMap)', () => {
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

describe('findMergedGroupForActivity', () => {
  const makeActivity = (overrides: Partial<Activity>): Activity => ({
    activity_type: 'exercise',
    source: 'health_connect',
    start_time: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  })

  test('returns the single activity when no merge group exists', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'solo-id',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    const merged = mergeOverlappingActivities(activities)
    const group = findMergedGroupForActivity(merged, activities, 'solo-id')
    expect(group).toHaveLength(1)
    expect(group[0].id).toBe('solo-id')
  })

  test('returns empty array for non-existent activity ID', () => {
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'real-id',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    const merged = mergeOverlappingActivities(activities)
    const group = findMergedGroupForActivity(merged, activities, 'non-existent')
    expect(group).toHaveLength(0)
  })

  test('finds transitive chain: A overlaps B, B overlaps C, but A does not overlap C', () => {
    // A: 10:00-10:30, B: 10:20-11:00, C: 10:50-11:30
    // A overlaps B (10:30 >= 10:20), B overlaps C (11:00 >= 10:50), A does NOT directly overlap C
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T10:30:00Z'),
        id: 'A',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'B',
        start_time: new Date('2024-01-15T10:20:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: 'C',
        start_time: new Date('2024-01-15T10:50:00Z'),
      }),
    ]
    const merged = mergeOverlappingActivities(activities)
    expect(merged).toHaveLength(1) // all merged transitively

    const group = findMergedGroupForActivity(merged, activities, 'A')
    expect(group).toHaveLength(3)
    expect(group.map((a) => a.id).sort()).toEqual(['A', 'B', 'C'])
  })

  test('returns only the correct group when there are separate groups', () => {
    const activities = [
      // Morning group
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
      // Evening group
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
    const merged = mergeOverlappingActivities(activities)

    const morningGroup = findMergedGroupForActivity(merged, activities, 'morning-a')
    expect(morningGroup).toHaveLength(2)
    expect(morningGroup.map((a) => a.id).sort()).toEqual(['morning-a', 'morning-b'])

    const eveningGroup = findMergedGroupForActivity(merged, activities, 'evening-b')
    expect(eveningGroup).toHaveLength(2)
    expect(eveningGroup.map((a) => a.id).sort()).toEqual(['evening-a', 'evening-b'])
  })

  test('real-world scenario: 4 activities with transitive chaining (same-type)', () => {
    // Simulates: Health Connect 10:27-11:37, Gravl 10:27-10:40, Polar 10:27-11:32, Manual 11:32-12:37
    // HC overlaps Gravl, HC overlaps Polar, Polar overlaps Manual
    // HC does NOT directly overlap Manual (11:37 >= 11:32 — actually it does in this case)
    // Let's make it so HC ends at 11:30 and Manual starts at 11:32 to be truly transitive
    const activities = [
      makeActivity({
        end_time: new Date('2024-01-15T10:40:00Z'),
        id: 'gravl',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:27:00Z'),
        title: 'Weightlifting',
      }),
      makeActivity({
        end_time: new Date('2024-01-15T11:30:00Z'),
        id: 'hc',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:27:00Z'),
      }),
      makeActivity({
        data: { exerciseTypeName: 'Strength training' },
        end_time: new Date('2024-01-15T11:32:00Z'),
        id: 'polar',
        source: 'oura',
        start_time: new Date('2024-01-15T10:27:00Z'),
      }),
      makeActivity({
        end_time: new Date('2024-01-15T12:37:00Z'),
        id: 'manual',
        source: 'manual',
        start_time: new Date('2024-01-15T11:32:00Z'),
        title: 'Extra sets',
      }),
    ]
    const merged = mergeOverlappingActivities(activities)
    expect(merged).toHaveLength(1)

    // Looking up any activity in the group should return all 4
    const group = findMergedGroupForActivity(merged, activities, 'gravl')
    expect(group).toHaveLength(4)
    expect(group.map((a) => a.id).sort()).toEqual(['gravl', 'hc', 'manual', 'polar'])
  })
})

// =============================================================================
// Cross-source merge tests
// =============================================================================

describe('mergeOverlappingActivities with cross-source merge', () => {
  const makeActivity = (overrides: Partial<Activity>): Activity => ({
    activity_type: 'exercise',
    source: 'health_connect',
    start_time: new Date('2024-01-15T10:00:00Z'),
    ...overrides,
  })

  // Category map for cross-source merge: maps activity_type -> display_category
  const categoryMap = new Map([
    ['exercise', 'exercise'],
    ['yoga', 'exercise'],
    ['walking', 'exercise'],
    ['running', 'exercise'],
    ['strength_training', 'exercise'],
    ['breathwork', 'wellness'],
    ['meditation', 'meditation'],
    ['sleep', 'sleep_rest'],
    ['nap', 'sleep_rest'],
  ])

  test('cross-merges different types from different sources, higher priority wins', () => {
    const activities = [
      makeActivity({
        activity_type: 'breathwork',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-breathwork',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:02Z'),
        title: 'Breathwork',
      }),
      makeActivity({
        activity_type: 'yoga',
        data: { exerciseType: 83 },
        end_time: new Date('2024-01-15T11:00:05Z'),
        id: 'hc-yoga',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(1)
    // Garmin has higher priority than health_connect
    expect(result[0].activity_type).toBe('breathwork')
    expect(result[0].source).toBe('garmin')
    expect(result[0].id).toBe('garmin-breathwork')
    // Time range covers both
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T11:00:05Z'))
    // Data merged (loser's fields preserved)
    expect((result[0].data as Record<string, unknown>)?.exerciseType).toBe(83)
    expect(result[0].source_ids).toEqual(['garmin-breathwork', 'hc-yoga'])
  })

  test('does NOT cross-merge same-source different-type activities', () => {
    const activities = [
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-yoga',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'strength_training',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-strength',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:30Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(2)
  })

  test('does NOT cross-merge activities more than 120s apart', () => {
    const activities = [
      makeActivity({
        activity_type: 'breathwork',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-breathwork',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:05:00Z'),
        id: 'hc-yoga',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:03:00Z'), // 3 minutes = 180s > 120s threshold
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(2)
  })

  test('three-way transitive cross-source merge', () => {
    const activities = [
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'hc-yoga',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'breathwork',
        end_time: new Date('2024-01-15T11:00:05Z'),
        id: 'garmin-breathwork',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:02Z'),
        title: 'Garmin Breathwork',
      }),
      makeActivity({
        activity_type: 'meditation',
        end_time: new Date('2024-01-15T11:00:10Z'),
        id: 'oura-meditation',
        source: 'oura',
        start_time: new Date('2024-01-15T10:00:04Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(1)
    // Garmin (priority 3) > Oura (2) > HC (1)
    expect(result[0].activity_type).toBe('breathwork')
    expect(result[0].source).toBe('garmin')
    expect(result[0].source_ids).toEqual(
      expect.arrayContaining(['hc-yoga', 'garmin-breathwork', 'oura-meditation']),
    )
  })

  test('_user_edited activity wins regardless of source priority', () => {
    const activities = [
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-yoga',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'breathwork',
        data: { _user_edited: true },
        end_time: new Date('2024-01-15T11:00:05Z'),
        id: 'hc-breathwork',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:02Z'),
        title: 'User changed this',
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(1)
    // HC normally lower priority than garmin, but _user_edited boosts it
    expect(result[0].activity_type).toBe('breathwork')
    expect(result[0].source).toBe('health_connect')
    expect(result[0].title).toBe('User changed this')
  })

  test('does NOT cross-merge non-eligible sources (lastfm, calendar)', () => {
    const activities = [
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-yoga',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
      makeActivity({
        activity_type: 'meditation',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'calendar-meditation',
        source: 'calendar',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(2)
  })

  test('does NOT cross-merge sleep_rest category activities', () => {
    const activities = [
      makeActivity({
        activity_type: 'sleep',
        end_time: new Date('2024-01-15T07:00:00Z'),
        id: 'oura-sleep',
        source: 'oura',
        start_time: new Date('2024-01-14T23:00:00Z'),
      }),
      makeActivity({
        activity_type: 'nap',
        end_time: new Date('2024-01-15T07:00:00Z'),
        id: 'hc-nap',
        source: 'health_connect',
        start_time: new Date('2024-01-14T23:00:00Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(2)
  })

  test('without categoryMap, cross-source merge is disabled (backward compatible)', () => {
    const activities = [
      makeActivity({
        activity_type: 'breathwork',
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'garmin-breathwork',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:02Z'),
      }),
      makeActivity({
        activity_type: 'yoga',
        end_time: new Date('2024-01-15T11:00:05Z'),
        id: 'hc-yoga',
        source: 'health_connect',
        start_time: new Date('2024-01-15T10:00:00Z'),
      }),
    ]
    // No categoryMap → no cross-source merge
    const result = mergeOverlappingActivities(activities)
    expect(result).toHaveLength(2)
  })

  test('cross-source merge preserves loser data fields (garmin_activity_id)', () => {
    const activities = [
      makeActivity({
        activity_type: 'breathwork',
        data: { _user_edited: true },
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'aurboda-breathwork',
        source: 'aurboda',
        start_time: new Date('2024-01-15T10:00:00Z'),
        title: 'Breathwork session',
      }),
      makeActivity({
        activity_type: 'yoga',
        data: { garmin_activity_id: 12345, exerciseType: 83 },
        end_time: new Date('2024-01-15T11:00:05Z'),
        id: 'garmin-yoga',
        source: 'garmin',
        start_time: new Date('2024-01-15T10:00:02Z'),
      }),
    ]
    const result = mergeOverlappingActivities(activities, categoryMap)
    expect(result).toHaveLength(1)
    expect(result[0].activity_type).toBe('breathwork') // aurboda wins
    const data = result[0].data as Record<string, unknown>
    // Winner's data takes precedence, but loser's unique fields preserved
    expect(data._user_edited).toBe(true)
    expect(data.garmin_activity_id).toBe(12345)
    expect(data.exerciseType).toBe(83)
  })
})
