import { describe, expect, it } from 'vitest'
import type { Activity, Tag } from '../../state/api'
import {
  buildActivityColumnItems,
  EXCLUDED_TAG_PREFIXES,
  EXCLUDED_TAG_SOURCES,
  isDurationTagActivityLike,
  overlapMinutes,
  tryMergeTagIntoActivity,
} from './activityMerge'
import type { ChartItem } from './types'

// ── Helpers ──────────────────────────────────────────────────────────────────

const makeTag = (overrides: Partial<Tag> = {}): Tag => ({
  end_time: new Date('2026-01-01T09:00:00Z'),
  id: 'tag-1',
  source: 'manual',
  start_time: new Date('2026-01-01T08:00:00Z'),
  tag: 'Holosync',
  tag_key: 'Holosync',
  ...overrides,
})

const makeActivity = (overrides: Partial<Activity> = {}): Activity => ({
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

// ── isDurationTagActivityLike ─────────────────────────────────────────────────

describe('isDurationTagActivityLike', () => {
  it('returns false for point tags (no end_time)', () => {
    expect(isDurationTagActivityLike(makeTag({ end_time: undefined }))).toBe(false)
  })

  it('returns false for lastfm source', () => {
    expect(isDurationTagActivityLike(makeTag({ source: 'lastfm' }))).toBe(false)
  })

  it('returns false for lastfm-auto source', () => {
    expect(isDurationTagActivityLike(makeTag({ source: 'lastfm-auto' }))).toBe(false)
  })

  it('returns false for computer: prefix tags', () => {
    expect(isDurationTagActivityLike(makeTag({ tag: 'computer:idle' }))).toBe(false)
  })

  it('returns true for a normal duration tag', () => {
    expect(isDurationTagActivityLike(makeTag({ source: 'manual', tag: 'Holosync' }))).toBe(true)
  })

  it('EXCLUDED_TAG_SOURCES covers lastfm and lastfm-auto', () => {
    expect(EXCLUDED_TAG_SOURCES.has('lastfm')).toBe(true)
    expect(EXCLUDED_TAG_SOURCES.has('lastfm-auto')).toBe(true)
  })

  it('EXCLUDED_TAG_PREFIXES covers computer:', () => {
    expect(EXCLUDED_TAG_PREFIXES).toContain('computer:')
  })
})

// ── overlapMinutes ────────────────────────────────────────────────────────────

describe('overlapMinutes', () => {
  const h = (hour: number) => new Date(`2026-01-01T${String(hour).padStart(2, '0')}:00:00Z`)

  it('returns 0 for non-overlapping intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(10), h(11))).toBe(0)
  })

  it('returns full duration for identical intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(8), h(9))).toBe(60)
  })

  it('returns partial overlap', () => {
    // 08:00-09:00 and 08:30-10:00 → overlap 30 min
    expect(overlapMinutes(h(8), h(9), new Date('2026-01-01T08:30:00Z'), h(10))).toBe(30)
  })

  it('returns 0 for adjacent intervals', () => {
    expect(overlapMinutes(h(8), h(9), h(9), h(10))).toBe(0)
  })
})

// ── tryMergeTagIntoActivity ───────────────────────────────────────────────────

describe('tryMergeTagIntoActivity', () => {
  it('merges Holosync tag into meditation activity with >50% overlap', () => {
    const item = makeChartItem()
    const tag = makeTag({ tag: 'Holosync' }) // 100% overlap
    const result = tryMergeTagIntoActivity(tag, [item])
    expect(result).toBe(true)
    expect(item.tooltip.details).toContain('Also tagged: Holosync')
  })

  it('does not merge when overlap is ≤50%', () => {
    // Tag: 08:00-09:00 (60 min), activity: 08:31-09:30 → overlap ~29 min < 50%
    const item = makeChartItem({
      end: new Date('2026-01-01T09:30:00Z'),
      start: new Date('2026-01-01T08:31:00Z'),
    })
    const tag = makeTag({ tag: 'Holosync' }) // 08:00-09:00
    const result = tryMergeTagIntoActivity(tag, [item])
    expect(result).toBe(false)
  })

  it('does not merge when tag not in TAG_ACTIVITY_MERGE_MAP', () => {
    const item = makeChartItem()
    const tag = makeTag({ tag: 'SomeUnknownTag' })
    expect(tryMergeTagIntoActivity(tag, [item])).toBe(false)
  })

  it('does not merge when activity type does not match', () => {
    const item = makeChartItem({ activity_type: 'exercise' })
    const tag = makeTag({ tag: 'Breathwork' }) // maps to meditation only
    // Breathwork merges with meditation, not exercise
    const result = tryMergeTagIntoActivity(tag, [item])
    expect(result).toBe(false)
  })

  it('merges Holosync into nap activity type', () => {
    const item = makeChartItem({ activity_type: 'nap', label: 'Nap' })
    const tag = makeTag({ tag: 'Holosync' }) // maps to ['meditation', 'nap']
    expect(tryMergeTagIntoActivity(tag, [item])).toBe(true)
  })
})

// ── buildActivityColumnItems ──────────────────────────────────────────────────

describe('buildActivityColumnItems', () => {
  const activityColors = {
    exercise: '#10b981',
    meditation: '#a855f7',
    nap: '#60a5fa',
    sleep: '#3b82f6',
  }
  const tagIcons: Record<string, string> = {}
  const ouraByDate = new Map<string, Record<string, number>>()
  const buildSleepDetails = () => ['8h sleep']
  const getExerciseTypeName = () => 'Running'
  const exerciseColor = () => '#10b981'
  const scrobbles: { artist: string; recorded_at: Date; track: string }[] = []

  it('converts a meditation activity to a ChartItem', () => {
    const { items } = buildActivityColumnItems(
      [makeActivity()],
      [],
      tagIcons,
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

  it('merges Holosync tag into meditation activity', () => {
    const tag = makeTag({ tag: 'Holosync' })
    const { items } = buildActivityColumnItems(
      [makeActivity()],
      [tag],
      tagIcons,
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

  it('keeps a duration tag as separate item when it cannot be merged', () => {
    // A tag not in TAG_ACTIVITY_MERGE_MAP
    const tag = makeTag({ tag: 'Sauna' })
    const { items } = buildActivityColumnItems(
      [makeActivity()],
      [tag],
      tagIcons,
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

  it('excludes lastfm-source tags from the Activity column', () => {
    const tag = makeTag({ source: 'lastfm', tag: 'Holosync' })
    const { items } = buildActivityColumnItems(
      [makeActivity()],
      [tag],
      tagIcons,
      activityColors,
      exerciseColor,
      getExerciseTypeName,
      ouraByDate,
      buildSleepDetails,
      scrobbles,
    )
    // lastfm tag should not appear in Activity column
    expect(items).toHaveLength(1)
    expect(items[0].entity_type).toBe('activity')
  })

  it('records overlap warnings when non-mergeable tags overlap', () => {
    // Sauna tag fully overlaps with meditation activity
    const tag = makeTag({ tag: 'Sauna' })
    const { overlaps } = buildActivityColumnItems(
      [makeActivity()],
      [tag],
      tagIcons,
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
      tagIcons,
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
