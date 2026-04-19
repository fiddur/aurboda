import { describe, expect, test } from 'vitest'

import type { ProductivityRecord, ScreentimeCategory } from '../db/index.ts'

import { buildScreentimeActivitySpans, spansToActivities } from './screentime-activities.ts'

const cat = (overrides: Partial<ScreentimeCategory>): ScreentimeCategory => ({
  created_at: new Date(),
  id: overrides.id ?? 'cat-id',
  ignore_case: true,
  name: overrides.name ?? ['Work'],
  rule_type: 'regex',
  sort_order: 0,
  updated_at: new Date(),
  ...overrides,
})

const rec = (overrides: Partial<ProductivityRecord>): ProductivityRecord => ({
  activity: overrides.activity ?? 'app',
  duration_sec: overrides.duration_sec ?? 120,
  end_time: overrides.end_time ?? new Date('2026-04-19T10:02:00Z'),
  source: overrides.source ?? 'rescuetime',
  start_time: overrides.start_time ?? new Date('2026-04-19T10:00:00Z'),
  ...overrides,
})

describe('buildScreentimeActivitySpans', () => {
  test('skips uncategorized records', () => {
    const records = [rec({ resolved_category: undefined }), rec({ resolved_category: [] })]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toEqual([])
  })

  test('skips records under excluded categories', () => {
    const categories = [cat({ name: ['Idle'], exclude_from_screentime: true })]
    const records = [
      rec({
        resolved_category: ['Idle'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:03:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, categories)
    expect(spans).toEqual([])
  })

  test('skips excluded parent category even for deeper paths', () => {
    const categories = [cat({ name: ['Idle'], exclude_from_screentime: true })]
    const records = [
      rec({
        resolved_category: ['Idle', 'plasmashell'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:03:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, categories)
    expect(spans).toEqual([])
  })

  test('merges adjacent same-category records within 2 minutes', () => {
    const records = [
      rec({
        resolved_category: ['Work', 'Programming'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:05:00Z'),
      }),
      rec({
        resolved_category: ['Work', 'Programming'],
        start_time: new Date('2026-04-19T10:06:00Z'),
        end_time: new Date('2026-04-19T10:10:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toHaveLength(1)
    expect(spans[0].start_time).toEqual(new Date('2026-04-19T10:00:00Z'))
    expect(spans[0].end_time).toEqual(new Date('2026-04-19T10:10:00Z'))
  })

  test('splits records with gaps longer than 2 minutes', () => {
    const records = [
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:05:00Z'),
      }),
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:10:00Z'),
        end_time: new Date('2026-04-19T10:15:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toHaveLength(2)
  })

  test('does not merge records of different categories', () => {
    const records = [
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:05:00Z'),
      }),
      rec({
        resolved_category: ['Entertainment'],
        start_time: new Date('2026-04-19T10:05:00Z'),
        end_time: new Date('2026-04-19T10:10:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toHaveLength(2)
  })

  test('does not merge records from different sources', () => {
    const records = [
      rec({
        resolved_category: ['Work'],
        source: 'rescuetime',
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:05:00Z'),
      }),
      rec({
        resolved_category: ['Work'],
        source: 'activitywatch',
        start_time: new Date('2026-04-19T10:05:00Z'),
        end_time: new Date('2026-04-19T10:10:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toHaveLength(2)
  })

  test('filters out spans shorter than 1 minute', () => {
    const records = [
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:00:30Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans).toEqual([])
  })

  test('attaches score from category when present', () => {
    const categories = [cat({ name: ['Work'], score: 2 })]
    const records = [
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:03:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, categories)
    expect(spans[0].score).toBe(2)
  })

  test('sorts spans by start_time', () => {
    const records = [
      rec({
        resolved_category: ['Entertainment'],
        start_time: new Date('2026-04-19T11:00:00Z'),
        end_time: new Date('2026-04-19T11:05:00Z'),
      }),
      rec({
        resolved_category: ['Work'],
        start_time: new Date('2026-04-19T10:00:00Z'),
        end_time: new Date('2026-04-19T10:05:00Z'),
      }),
    ]
    const spans = buildScreentimeActivitySpans(records, [])
    expect(spans[0].start_time.getTime()).toBeLessThan(spans[1].start_time.getTime())
  })
})

describe('spansToActivities', () => {
  test('maps spans to Activity records with stable external_id', () => {
    const startTime = new Date('2026-04-19T10:00:00Z')
    const spans = [
      {
        category_path: ['Work', 'Programming'],
        end_time: new Date('2026-04-19T10:15:00Z'),
        source: 'rescuetime',
        start_time: startTime,
        score: 2,
      },
    ]
    const activities = spansToActivities(spans)
    expect(activities).toEqual([
      {
        activity_type: 'screentime',
        data: { category_path: 'Work > Programming', score: 2 },
        end_time: new Date('2026-04-19T10:15:00Z'),
        external_id: `rescuetime_${startTime.getTime()}_Work > Programming`,
        source: 'rescuetime',
        start_time: startTime,
      },
    ])
  })

  test('omits score when not present', () => {
    const spans = [
      {
        category_path: ['Work'],
        end_time: new Date('2026-04-19T10:05:00Z'),
        source: 'activitywatch',
        start_time: new Date('2026-04-19T10:00:00Z'),
      },
    ]
    const activities = spansToActivities(spans)
    expect(activities[0].data).toEqual({ category_path: 'Work' })
  })
})
