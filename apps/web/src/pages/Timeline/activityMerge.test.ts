import { describe, expect, it } from 'vitest'

import type { Activity } from '../../state/api'
import type { ChartItem } from './types'

import {
  buildActivityColumnItems,
  collapseToParentType,
  EXCLUDED_ACTIVITY_PREFIXES,
  EXCLUDED_ACTIVITY_SOURCES,
  isDurationActivityLike,
  overlapMinutes,
  resolveCollapseTarget,
  tryMergeActivityIntoItem,
} from './activityMerge'

// -- Helpers ------------------------------------------------------------------

const makeActivity = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'holosync',
  end_time: new Date('2026-01-01T09:00:00Z'),
  id: 'act-1',
  source: 'manual',
  start_time: new Date('2026-01-01T08:00:00Z'),
  ...overrides,
})

const makeBuiltinActivity = (overrides: Partial<Activity> = {}): Activity => ({
  activity_type: 'meditation',
  end_time: new Date('2026-01-01T09:00:00Z'),
  id: 'act-1',
  start_time: new Date('2026-01-01T08:00:00Z'),
  ...overrides,
})

const makeChartItem = (overrides: Partial<ChartItem> = {}): ChartItem => ({
  activity_type: 'meditation',
  color: '#a855f7',
  column: 'Activity',
  end: new Date('2026-01-01T09:00:00Z'),
  entity_id: 'act-1',
  entity_type: 'activity',
  isPoint: false,
  label: 'Meditation',
  start: new Date('2026-01-01T08:00:00Z'),
  tooltip: { details: [], time: '08:00 – 09:00', title: 'Meditation' },
  ...overrides,
})

// -- isDurationActivityLike ---------------------------------------------------

describe('isDurationActivityLike', () => {
  it('returns false for point activities (no end_time)', () => {
    expect(isDurationActivityLike(makeActivity({ end_time: undefined }))).toBe(false)
  })

  it('returns false for lastfm source', () => {
    expect(isDurationActivityLike(makeActivity({ source: 'lastfm' }))).toBe(false)
  })

  it('returns false for computer: prefix activity types', () => {
    expect(isDurationActivityLike(makeActivity({ activity_type: 'computer:idle' }))).toBe(false)
  })

  it('returns true for a normal duration activity', () => {
    expect(isDurationActivityLike(makeActivity({ source: 'manual' }))).toBe(true)
  })

  it('EXCLUDED_ACTIVITY_SOURCES covers lastfm', () => {
    expect(EXCLUDED_ACTIVITY_SOURCES.has('lastfm')).toBe(true)
  })

  it('EXCLUDED_ACTIVITY_PREFIXES covers computer:', () => {
    expect(EXCLUDED_ACTIVITY_PREFIXES).toContain('computer:')
  })
})

// -- overlapMinutes -----------------------------------------------------------

describe('overlapMinutes', () => {
  const h = (hour: number) => new Date(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`)

  it('returns 0 for non-overlapping intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(10), h(11))).toBe(0)
  })

  it('returns full duration for identical intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(8), h(9))).toBe(60)
  })

  it('returns partial overlap', () => {
    // 08:00-09:00 and 08:30-10:00 -> overlap 30 min
    expect(overlapMinutes(h(8), h(9), new Date('2026-01-01T08:30:00Z'), h(10))).toBe(30)
  })

  it('returns 0 for adjacent intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(9), h(10))).toBe(0)
  })
})

// -- tryMergeActivityIntoItem -------------------------------------------------

describe('tryMergeActivityIntoItem', () => {
  it('merges holosync activity into meditation item with >50% overlap', () => {
    const item = makeChartItem()
    const activity = makeActivity({ activity_type: 'holosync' }) // 100% overlap
    const result = tryMergeActivityIntoItem(activity, [item])
    expect(result).toBe(true)
    expect(item.tooltip.details).toContain('Also tagged: Holosync')
  })

  it('does not merge when overlap is <=50%', () => {
    // Activity: 08:00-09:00 (60 min), item: 08:31-09:30 -> overlap ~29 min < 50%
    const item = makeChartItem({
      end: new Date('2026-01-01T09:30:00Z'),
      start: new Date('2026-01-01T08:31:00Z'),
    })
    const activity = makeActivity({ activity_type: 'holosync' }) // 08:00-09:00
    const result = tryMergeActivityIntoItem(activity, [item])
    expect(result).toBe(false)
  })

  it('does not merge when activity type not in ACTIVITY_TYPE_MERGE_MAP', () => {
    const item = makeChartItem()
    const activity = makeActivity({ activity_type: 'some_unknown_type' })
    expect(tryMergeActivityIntoItem(activity, [item])).toBe(false)
  })

  it('does not merge when item activity type does not match', () => {
    const item = makeChartItem({ activity_type: 'exercise' })
    const activity = makeActivity({ activity_type: 'breathwork' }) // maps to meditation only
    // Breathwork merges with meditation, not exercise
    const result = tryMergeActivityIntoItem(activity, [item])
    expect(result).toBe(false)
  })

  it('merges holosync into nap activity type', () => {
    const item = makeChartItem({ activity_type: 'nap', label: 'Nap' })
    const activity = makeActivity({ activity_type: 'holosync' }) // maps to ['meditation', 'nap']
    expect(tryMergeActivityIntoItem(activity, [item])).toBe(true)
  })
})

// -- buildActivityColumnItems -------------------------------------------------

describe('buildActivityColumnItems', () => {
  const activityColors = {
    exercise: '#10b981',
    meditation: '#a855f7',
    nap: '#60a5fa',
    rest: '#86efac',
    sleep: '#3b82f6',
  }
  const itemIcons: Record<string, string> = {}
  const sleepMetricsByDate = new Map<string, Record<string, number>>()
  const buildSleepDetails = () => ['8h sleep']
  const getExerciseTypeName = () => 'Running'
  const exerciseColor = () => '#10b981'
  const scrobbles: { artist: string; recorded_at: Date; track: string }[] = []

  it('converts a meditation activity to a ChartItem', () => {
    const { items } = buildActivityColumnItems(
      [makeBuiltinActivity()],
      [],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    expect(items).toHaveLength(1)
    expect(items[0].label).toBe('Meditation')
    expect(items[0].column).toBe('Activity')
  })

  it('merges holosync activity into meditation activity', () => {
    const tagActivity = makeActivity({ activity_type: 'holosync' })
    const { items } = buildActivityColumnItems(
      [makeBuiltinActivity()],
      [tagActivity],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    // Should be 1 item (merged), not 2
    expect(items).toHaveLength(1)
    expect(items[0].tooltip.details).toContain('Also tagged: Holosync')
  })

  it('keeps a duration activity as separate item when it cannot be merged', () => {
    // An activity type not in ACTIVITY_TYPE_MERGE_MAP
    const tagActivity = makeActivity({ activity_type: 'sauna' })
    const { items } = buildActivityColumnItems(
      [makeBuiltinActivity()],
      [tagActivity],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    expect(items).toHaveLength(2)
    expect(items.map((i) => i.label)).toContain('Sauna')
  })

  it('excludes lastfm-source activities from the Activity column', () => {
    const tagActivity = makeActivity({ activity_type: 'holosync', source: 'lastfm' })
    const { items } = buildActivityColumnItems(
      [makeBuiltinActivity()],
      [tagActivity],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    // lastfm activity should not appear in Activity column
    expect(items).toHaveLength(1)
    expect(items[0].entity_type).toBe('activity')
  })

  it('records overlap warnings when non-mergeable activities overlap', () => {
    // Sauna activity fully overlaps with meditation activity
    const tagActivity = makeActivity({ activity_type: 'sauna' })
    const { overlaps } = buildActivityColumnItems(
      [makeBuiltinActivity()],
      [tagActivity],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    expect(overlaps.length).toBeGreaterThan(0)
    expect(overlaps[0].item1Label).toBe('Sauna')
  })

  it('returns empty lists when given no input', () => {
    const { items, overlaps } = buildActivityColumnItems(
      [],
      [],
      itemIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      sleepMetricsByDate,
      buildSleepDetails,
      scrobbles,
    )
    expect(items).toHaveLength(0)
    expect(overlaps).toHaveLength(0)
  })
})

// -- resolveCollapseTarget ----------------------------------------------------

describe('resolveCollapseTarget', () => {
  const typeDefs = new Map([
    ['running', { parent_type: 'exercise' }],
    ['exercise', {}],
    ['meditation', {}],
  ])

  it('returns immediate parent for hierarchical type', () => {
    expect(resolveCollapseTarget('running', typeDefs)).toBe('exercise')
  })

  it('returns null for top-level type with no parent', () => {
    expect(resolveCollapseTarget('exercise', typeDefs)).toBeNull()
    expect(resolveCollapseTarget('meditation', typeDefs)).toBeNull()
  })

  it('returns null for unknown type', () => {
    expect(resolveCollapseTarget('nonexistent', typeDefs)).toBeNull()
  })
})

// -- collapseToParentType -----------------------------------------------------

describe('collapseToParentType', () => {
  const typeDefs = new Map([
    ['running', { parent_type: 'exercise' }],
    ['strength_training', { parent_type: 'exercise' }],
    ['yoga', { parent_type: 'exercise' }],
    ['exercise', {}],
    ['meditation', {}],
  ])

  const d = (h: number, m = 0) =>
    new Date(Date.UTC(2026, 0, 1, h, m, 0))

  it('collapses adjacent exercise subtypes into one exercise bar', () => {
    const activities: Activity[] = [
      { activity_type: 'running', end_time: d(10, 30), id: 'a', start_time: d(10) },
      { activity_type: 'strength_training', end_time: d(11, 15), id: 'b', start_time: d(10, 35) },
      { activity_type: 'yoga', end_time: d(11, 40), id: 'c', start_time: d(11, 20) },
    ]
    const collapsed = collapseToParentType(activities, typeDefs)
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0].activity_type).toBe('exercise')
    expect(collapsed[0].start_time).toEqual(d(10))
    expect(collapsed[0].end_time).toEqual(d(11, 40))
  })

  it('does not merge across long gaps', () => {
    const activities: Activity[] = [
      { activity_type: 'running', end_time: d(10, 30), id: 'a', start_time: d(10) },
      // 2-hour gap — exceeds default 30-minute merge gap
      { activity_type: 'yoga', end_time: d(13, 30), id: 'b', start_time: d(13) },
    ]
    const collapsed = collapseToParentType(activities, typeDefs)
    expect(collapsed).toHaveLength(2)
    expect(collapsed.every((a) => a.activity_type === 'exercise')).toBe(true)
  })

  it('leaves activities without parent_type unchanged', () => {
    const activities: Activity[] = [
      { activity_type: 'meditation', end_time: d(9, 30), id: 'a', start_time: d(9) },
    ]
    const collapsed = collapseToParentType(activities, typeDefs)
    expect(collapsed).toEqual(activities)
  })

  it('does not merge siblings with different parents', () => {
    const activities: Activity[] = [
      { activity_type: 'running', end_time: d(10, 30), id: 'a', start_time: d(10) },
      { activity_type: 'meditation', end_time: d(11), id: 'b', start_time: d(10, 35) },
    ]
    const collapsed = collapseToParentType(activities, typeDefs)
    expect(collapsed).toHaveLength(2)
    expect(collapsed.map((a) => a.activity_type)).toEqual(['exercise', 'meditation'])
  })

  it('does not mutate input array', () => {
    const activities: Activity[] = [
      { activity_type: 'running', end_time: d(10, 30), id: 'a', start_time: d(10) },
    ]
    const original = [...activities]
    collapseToParentType(activities, typeDefs)
    expect(activities).toEqual(original)
  })

  it('returns empty array for empty input', () => {
    expect(collapseToParentType([], typeDefs)).toEqual([])
  })

  it('respects a custom merge gap', () => {
    const activities: Activity[] = [
      { activity_type: 'running', end_time: d(10, 30), id: 'a', start_time: d(10) },
      { activity_type: 'yoga', end_time: d(11, 30), id: 'b', start_time: d(11) },
    ]
    // Default 30-min gap: these are 30 min apart, should merge.
    expect(collapseToParentType(activities, typeDefs)).toHaveLength(1)
    // 10-min gap: should not merge.
    expect(collapseToParentType(activities, typeDefs, 10 * 60 * 1000)).toHaveLength(2)
  })
})
