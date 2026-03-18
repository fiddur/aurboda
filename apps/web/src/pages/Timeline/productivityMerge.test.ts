import { describe, expect, test } from 'vitest'

import type { ProductivityRecord } from '../../state/api'

import { mergeProductivitySpans } from './productivityMerge'

const makeRecord = (
  overrides: Partial<ProductivityRecord> & { start_time: Date; end_time: Date },
): ProductivityRecord => ({
  activity: 'test-app',
  duration_sec: Math.round((overrides.end_time.getTime() - overrides.start_time.getTime()) / 1000),
  ...overrides,
})

const t = (h: number, m: number) => new Date(2024, 0, 15, h, m)

describe('mergeProductivitySpans', () => {
  test('returns empty array for empty input', () => {
    expect(mergeProductivitySpans([])).toEqual([])
  })

  test('single record becomes a single span', () => {
    const records = [makeRecord({ activity: 'vscode', end_time: t(10, 30), start_time: t(10, 0) })]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(1)
    expect(spans[0].records).toHaveLength(1)
    expect(spans[0].groupKey).toBe('')
  })

  test('merges adjacent uncategorized records', () => {
    const records = [
      makeRecord({ activity: 'vscode', end_time: t(10, 10), start_time: t(10, 0) }),
      makeRecord({ activity: 'firefox', end_time: t(10, 20), start_time: t(10, 10) }),
      makeRecord({ activity: 'slack', end_time: t(10, 25), start_time: t(10, 20) }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(1)
    expect(spans[0].records).toHaveLength(3)
    expect(spans[0].start).toEqual(t(10, 0))
    expect(spans[0].end).toEqual(t(10, 25))
    expect(spans[0].groupKey).toBe('')
  })

  test('merges adjacent same-category records', () => {
    const records = [
      makeRecord({
        activity: 'netflix',
        end_time: t(13, 15),
        resolved_category: ['Media', 'TV'],
        start_time: t(13, 10),
      }),
      makeRecord({
        activity: 'netflix',
        end_time: t(13, 20),
        resolved_category: ['Media', 'TV'],
        start_time: t(13, 15),
      }),
      makeRecord({
        activity: 'netflix',
        end_time: t(13, 25),
        resolved_category: ['Media', 'TV'],
        start_time: t(13, 20),
      }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(1)
    expect(spans[0].records).toHaveLength(3)
    expect(spans[0].groupKey).toBe('Media > TV')
    expect(spans[0].start).toEqual(t(13, 10))
    expect(spans[0].end).toEqual(t(13, 25))
  })

  test('keeps different categories as separate spans', () => {
    const records = [
      makeRecord({
        activity: 'vscode',
        end_time: t(10, 30),
        resolved_category: ['Work', 'Programming'],
        start_time: t(10, 0),
      }),
      makeRecord({
        activity: 'netflix',
        end_time: t(10, 30),
        resolved_category: ['Media', 'TV'],
        start_time: t(10, 0),
      }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(2)
    const keys = spans.map((s) => s.groupKey).sort()
    expect(keys).toEqual(['Media > TV', 'Work > Programming'])
  })

  test('splits spans when gap exceeds threshold', () => {
    const records = [
      makeRecord({ activity: 'vscode', end_time: t(10, 10), start_time: t(10, 0) }),
      // 5-minute gap (> 2 minutes)
      makeRecord({ activity: 'vscode', end_time: t(10, 25), start_time: t(10, 15) }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(2)
  })

  test('merges records within the 2-minute gap threshold', () => {
    const records = [
      makeRecord({ activity: 'vscode', end_time: t(10, 10), start_time: t(10, 0) }),
      // 1.5-minute gap (< 2 minutes)
      makeRecord({
        activity: 'vscode',
        end_time: t(10, 22),
        start_time: new Date(2024, 0, 15, 10, 11, 30),
      }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(1)
    expect(spans[0].records).toHaveLength(2)
  })

  test('merges overlapping records of the same category', () => {
    const records = [
      makeRecord({
        activity: 'firefox',
        end_time: t(11, 0),
        resolved_category: ['Work'],
        start_time: t(10, 0),
      }),
      makeRecord({
        activity: 'vscode',
        end_time: t(10, 45),
        resolved_category: ['Work'],
        start_time: t(10, 30),
      }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(1)
    expect(spans[0].end).toEqual(t(11, 0))
    expect(spans[0].records).toHaveLength(2)
  })

  test('excludes uncategorized records fully covered by categorized spans', () => {
    const records = [
      makeRecord({
        activity: 'vscode',
        end_time: t(10, 30),
        resolved_category: ['Work'],
        start_time: t(10, 0),
      }),
      // plasmashell 10:10-10:15 is fully inside Work 10:00-11:00
      makeRecord({ activity: 'plasmashell', end_time: t(10, 15), start_time: t(10, 10) }),
      makeRecord({
        activity: 'vscode',
        end_time: t(11, 0),
        resolved_category: ['Work'],
        start_time: t(10, 30),
      }),
    ]
    const spans = mergeProductivitySpans(records)

    // plasmashell is excluded because it's fully covered by the Work span
    expect(spans).toHaveLength(1)
    expect(spans[0].groupKey).toBe('Work')
    expect(spans[0].records).toHaveLength(2)
    expect(spans[0].start).toEqual(t(10, 0))
    expect(spans[0].end).toEqual(t(11, 0))
  })

  test('keeps uncategorized records not covered by any categorized span', () => {
    const records = [
      makeRecord({
        activity: 'vscode',
        end_time: t(10, 30),
        resolved_category: ['Work'],
        start_time: t(10, 0),
      }),
      // plasmashell 11:00-11:15 is outside the Work span
      makeRecord({ activity: 'plasmashell', end_time: t(11, 15), start_time: t(11, 0) }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans).toHaveLength(2)
    const workSpan = spans.find((s) => s.groupKey === 'Work')!
    expect(workSpan).toBeDefined()
    const uncatSpan = spans.find((s) => s.groupKey === '')!
    expect(uncatSpan.records[0].activity).toBe('plasmashell')
  })

  test('output is sorted by start time', () => {
    const records = [
      makeRecord({
        activity: 'netflix',
        end_time: t(13, 30),
        resolved_category: ['TV'],
        start_time: t(13, 0),
      }),
      makeRecord({ activity: 'vscode', end_time: t(10, 30), start_time: t(10, 0) }),
    ]
    const spans = mergeProductivitySpans(records)

    expect(spans[0].start.getTime()).toBeLessThan(spans[1].start.getTime())
  })
})
