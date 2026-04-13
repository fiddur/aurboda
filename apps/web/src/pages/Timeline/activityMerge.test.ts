import { describe, expect, it } from 'vitest'

import type { Activity } from '../../state/api'
import type { ChartItem } from './types'

import {
  buildActivityColumnItems,
  EXCLUDED_ACTIVITY_PREFIXES,
  EXCLUDED_ACTIVITY_SOURCES,
  isDurationActivityLike,
  overlapMinutes,
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
  const ouraByDate = new Map<string, Record<string, number>>()
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
      ouraByDate,
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
      ouraByDate,
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
      ouraByDate,
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
      ouraByDate,
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
      ouraByDate,
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
      ouraByDate,
      buildSleepDetails,
      scrobbles,
    )
    expect(items).toHaveLength(0)
    expect(overlaps).toHaveLength(0)
  })
})
