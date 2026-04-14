import { beforeEach, describe, expect, test, vi } from 'vitest'

import * as db from '../../db/index.ts'
import {
  assembleScreentimeBuckets,
  mergeByCategorySpans,
  mergeProductivitySpans,
  queryProductivity,
} from './productivity.ts'

// Mock the db module
vi.mock('../../db', () => ({
  getNotesByEntityIds: vi.fn(),
  getProductivity: vi.fn(),
}))

describe('mergeProductivitySpans', () => {
  test('merges consecutive spans for the same activity', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        id: 'id-1',
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        id: 'id-2',
        productivity: 2,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        id: 'id-3',
        productivity: 2,
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0]!.activity).toBe('emacs')
    expect(result[0]!.start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0]!.end_time).toEqual(new Date('2024-01-15T10:15:00Z'))
    expect(result[0]!.duration_sec).toBe(900)
    expect(result[0]!.source_ids).toEqual(['id-1', 'id-2', 'id-3'])
  })

  test('does not merge spans for different activities', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        category: 'Software Development',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        category: 'Browsers',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        productivity: 0,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
  })

  test('merges spans with a small gap (within 2 min leeway)', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 299,
        end_time: new Date('2024-01-15T10:04:59Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(1)
    expect(result[0].start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(result[0].end_time).toEqual(new Date('2024-01-15T10:10:00Z'))
    expect(result[0].duration_sec).toBe(599)
  })

  test('does not merge spans with a large gap between them', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
  })

  test('merges interleaved same-activity spans within gap threshold', () => {
    // emacs → firefox (30s) → emacs: the two emacs spans are within 2 min of each other
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        id: 'id-emacs-1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 30,
        end_time: new Date('2024-01-15T10:05:30Z'),
        id: 'id-firefox-1',
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:30Z'),
        id: 'id-emacs-2',
        start_time: new Date('2024-01-15T10:05:30Z'),
      },
    ])

    // emacs spans merge (gap = 30s < 2min); firefox stays separate
    expect(result).toHaveLength(2)
    const emacs = result.find((r) => r.activity === 'emacs')!
    expect(emacs.start_time).toEqual(new Date('2024-01-15T10:00:00Z'))
    expect(emacs.end_time).toEqual(new Date('2024-01-15T10:10:30Z'))
    expect(emacs.duration_sec).toBe(600) // only actual emacs time, not the firefox gap
    expect(emacs.source_ids).toEqual(['id-emacs-1', 'id-emacs-2'])
  })

  test('does not merge interleaved same-activity spans when gap exceeds threshold', () => {
    // emacs → firefox (5 min) → emacs: gap too large, stays as 2 separate emacs spans
    const result = mergeProductivitySpans([
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
      {
        activity: 'emacs',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:15:00Z'),
        start_time: new Date('2024-01-15T10:10:00Z'),
      },
    ])

    expect(result).toHaveLength(3)
  })

  test('real-world ActivityWatch pattern: rapid Alacritty/firefox interleaving', () => {
    // Derived from actual MCP data: 06:00-07:10 on 2026-02-27
    // Sub-second granularity, lots of 3-30s switches between terminal and browser
    const records = [
      {
        activity: 'Alacritty',
        duration_sec: 257,
        end_time: new Date('2026-02-27T06:04:18Z'),
        id: 'a1',
        start_time: new Date('2026-02-27T06:00:01Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:04:22Z'),
        id: 'f1',
        start_time: new Date('2026-02-27T06:04:18Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 11,
        end_time: new Date('2026-02-27T06:04:34Z'),
        id: 'a2',
        start_time: new Date('2026-02-27T06:04:23Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 7,
        end_time: new Date('2026-02-27T06:04:42Z'),
        id: 'f2',
        start_time: new Date('2026-02-27T06:04:35Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 0,
        end_time: new Date('2026-02-27T06:04:43Z'),
        id: 'a3',
        start_time: new Date('2026-02-27T06:04:43Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 13,
        end_time: new Date('2026-02-27T06:04:58Z'),
        id: 'f3',
        start_time: new Date('2026-02-27T06:04:44Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 66,
        end_time: new Date('2026-02-27T06:06:06Z'),
        id: 'a4',
        start_time: new Date('2026-02-27T06:04:59Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:06:10Z'),
        id: 'a5',
        start_time: new Date('2026-02-27T06:06:07Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 21,
        end_time: new Date('2026-02-27T06:06:35Z'),
        id: 'a6',
        start_time: new Date('2026-02-27T06:06:14Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 1,
        end_time: new Date('2026-02-27T06:06:39Z'),
        id: 'a7',
        start_time: new Date('2026-02-27T06:06:38Z'),
      },
      {
        activity: 'firefox',
        duration_sec: 16,
        end_time: new Date('2026-02-27T06:07:02Z'),
        id: 'f4',
        start_time: new Date('2026-02-27T06:06:40Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 3,
        end_time: new Date('2026-02-27T06:07:06Z'),
        id: 'a8',
        start_time: new Date('2026-02-27T06:07:03Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 173,
        end_time: new Date('2026-02-27T06:10:01Z'),
        id: 'a9',
        start_time: new Date('2026-02-27T06:07:08Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 241,
        end_time: new Date('2026-02-27T06:14:02Z'),
        id: 'a10',
        start_time: new Date('2026-02-27T06:10:01Z'),
      },
    ]

    const result = mergeProductivitySpans(records)

    // All Alacritty spans should merge into one (max gap between consecutive Alacritty ≤ 2min)
    const alacrittySpans = result.filter((r) => r.activity === 'Alacritty')
    expect(alacrittySpans).toHaveLength(1)
    expect(alacrittySpans[0]!.start_time).toEqual(new Date('2026-02-27T06:00:01Z'))
    expect(alacrittySpans[0]!.end_time).toEqual(new Date('2026-02-27T06:14:02Z'))
    // duration_sec is the sum of actual Alacritty time only (not firefox gaps)
    expect(alacrittySpans[0]!.duration_sec).toBe(257 + 11 + 0 + 66 + 3 + 21 + 1 + 3 + 173 + 241)
    expect(alacrittySpans[0]!.source_ids).toContain('a1')
    expect(alacrittySpans[0]!.source_ids).toContain('a10')

    // All firefox spans merge into one (all gaps ≤ 2min)
    const firefoxSpans = result.filter((r) => r.activity === 'firefox')
    expect(firefoxSpans).toHaveLength(1)
    expect(firefoxSpans[0]!.duration_sec).toBe(3 + 7 + 13 + 16)
  })

  test('zero-duration blip records are absorbed into the surrounding span', () => {
    // A 0-second focus event (e.g. system notification stealing focus briefly)
    const result = mergeProductivitySpans([
      {
        activity: 'Alacritty',
        duration_sec: 60,
        end_time: new Date('2024-01-15T10:01:00Z'),
        id: 'a1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'plasmashell',
        duration_sec: 0,
        end_time: new Date('2024-01-15T10:01:00Z'),
        id: 'p1',
        start_time: new Date('2024-01-15T10:01:00Z'),
      },
      {
        activity: 'Alacritty',
        duration_sec: 60,
        end_time: new Date('2024-01-15T10:02:00Z'),
        id: 'a2',
        start_time: new Date('2024-01-15T10:01:00Z'),
      },
    ])

    // Alacritty spans on either side of a 0-sec plasmashell event should merge
    const alacritty = result.find((r) => r.activity === 'Alacritty')!
    expect(alacritty.duration_sec).toBe(120)
    expect(alacritty.source_ids).toEqual(['a1', 'a2'])
  })

  test('handles empty input', () => {
    expect(mergeProductivitySpans([])).toEqual([])
  })

  test('handles single record', () => {
    const record = {
      activity: 'emacs',
      duration_sec: 300,
      end_time: new Date('2024-01-15T10:05:00Z'),
      start_time: new Date('2024-01-15T10:00:00Z'),
    }
    const result = mergeProductivitySpans([record])
    expect(result).toHaveLength(1)
    expect(result[0]).toMatchObject(record)
    expect(result[0]!.source_ids).toEqual([]) // no id on input record, so no source_ids collected
  })

  test('does not merge desktop and mobile spans for same activity', () => {
    const result = mergeProductivitySpans([
      {
        activity: 'slack',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:05:00Z'),
        is_mobile: false,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
      {
        activity: 'slack',
        duration_sec: 300,
        end_time: new Date('2024-01-15T10:10:00Z'),
        is_mobile: true,
        start_time: new Date('2024-01-15T10:05:00Z'),
      },
    ])

    expect(result).toHaveLength(2)
  })
})

describe('assembleScreentimeBuckets', () => {
  test('groups rows by bucket and aggregates totals', () => {
    const rows = [
      {
        bucket_start: new Date('2024-01-15T10:00:00Z'),
        resolved_category: ['Work', 'Programming'],
        total_sec: 1800,
      },
      {
        bucket_start: new Date('2024-01-15T10:00:00Z'),
        resolved_category: ['Work', 'Communication'],
        total_sec: 600,
      },
      { bucket_start: new Date('2024-01-15T11:00:00Z'), resolved_category: ['Media', 'TV'], total_sec: 3600 },
    ]
    const buckets = assembleScreentimeBuckets(rows, 3600000)

    expect(buckets).toHaveLength(2)
    expect(buckets[0].total_sec).toBe(2400) // 1800 + 600
    expect(buckets[0].categories).toHaveLength(2)
    // Sorted by duration desc
    expect(buckets[0].categories[0].total_sec).toBe(1800)
    expect(buckets[1].total_sec).toBe(3600)
  })

  test('handles null resolved_category as empty path', () => {
    const rows = [{ bucket_start: new Date('2024-01-15T10:00:00Z'), resolved_category: null, total_sec: 300 }]
    const buckets = assembleScreentimeBuckets(rows, 3600000)

    expect(buckets).toHaveLength(1)
    expect(buckets[0].categories[0].path).toEqual([])
  })

  test('returns empty array for empty input', () => {
    expect(assembleScreentimeBuckets([], 3600000)).toEqual([])
  })

  test('sorts buckets chronologically', () => {
    const rows = [
      { bucket_start: new Date('2024-01-15T12:00:00Z'), resolved_category: null, total_sec: 100 },
      { bucket_start: new Date('2024-01-15T10:00:00Z'), resolved_category: null, total_sec: 200 },
    ]
    const buckets = assembleScreentimeBuckets(rows, 3600000)
    expect(new Date(buckets[0].start).getTime()).toBeLessThan(new Date(buckets[1].start).getTime())
  })
})

describe('queryProductivity with comments', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('attaches comments to productivity records', async () => {
    const prodId = 'prod-id-1'
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: prodId,
        productivity: 2,
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])

    const notesMap = new Map([
      [
        prodId,
        [
          {
            content: 'Deep focus session',
            created_at: new Date('2024-01-15T11:01:00Z'),
            entity_id: prodId,
            entity_type: 'productivity' as const,
            id: 'note-1',
            updated_at: new Date('2024-01-15T11:01:00Z'),
          },
        ],
      ],
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(notesMap)

    const result = await queryProductivity('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result.data).toHaveLength(1)
    expect(result.data[0].comments).toHaveLength(1)
    expect(result.data[0].comments[0].content).toBe('Deep focus session')
  })

  test('returns empty comments array when no notes exist', async () => {
    vi.mocked(db.getProductivity).mockResolvedValue([
      {
        activity: 'VS Code',
        duration_sec: 3600,
        end_time: new Date('2024-01-15T11:00:00Z'),
        id: 'prod-1',
        start_time: new Date('2024-01-15T10:00:00Z'),
      },
    ])
    vi.mocked(db.getNotesByEntityIds).mockResolvedValue(new Map())

    const result = await queryProductivity('testuser', new Date('2024-01-15'), new Date('2024-01-16'))

    expect(result.data[0].comments).toEqual([])
  })
})

describe('mergeByCategorySpans', () => {
  const mkRecord = (
    start: string,
    end: string,
    activity: string,
    resolved_category?: string[],
    id?: string,
  ) => ({
    activity,
    duration_sec: (new Date(end).getTime() - new Date(start).getTime()) / 1000,
    end_time: new Date(end),
    id,
    resolved_category,
    source_ids: id ? [id] : [],
    start_time: new Date(start),
  })

  const workDevCategory = {
    color: '#4ade80',
    created_at: new Date(),
    exclude_from_screentime: false,
    id: 'cat-work',
    ignore_case: true,
    name: ['Work & Dev'],
    rule_type: 'none' as const,
    score: 2,
    sort_order: 0,
    updated_at: new Date(),
  }

  const softwareDevCategory = {
    ...workDevCategory,
    id: 'cat-softdev',
    name: ['Work & Dev', 'Software Dev'],
    rule_type: 'regex' as const,
  }

  const communicationCategory = {
    ...workDevCategory,
    id: 'cat-comm',
    name: ['Work & Dev', 'Communication'],
    rule_type: 'regex' as const,
  }

  const excludedCategory = {
    ...workDevCategory,
    exclude_from_screentime: true,
    id: 'cat-excluded',
    name: ['Excluded'],
  }

  const categories = [workDevCategory, softwareDevCategory, communicationCategory, excludedCategory]

  test('merges same-category adjacent records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:31:00Z',
        '2024-01-15T09:00:00Z',
        'Alacritty',
        ['Work & Dev', 'Software Dev'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].resolved_category).toEqual(['Work & Dev', 'Software Dev'])
    expect(results[0].source_ids).toEqual(['r1', 'r2'])
  })

  test('promotes overlapping subcategories to parent', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:25:00Z',
        '2024-01-15T09:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].resolved_category).toEqual(['Work & Dev'])
    expect(results[0].category_id).toBe('cat-work')
  })

  test('keeps non-overlapping subcategories separate', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T10:00:00Z',
        '2024-01-15T11:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(2)
    expect(results[0].resolved_category).toEqual(['Work & Dev', 'Software Dev'])
    expect(results[1].resolved_category).toEqual(['Work & Dev', 'Communication'])
  })

  test('filters out excluded categories', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'plasmashell', ['Excluded'], 'r1'),
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].activity).toBe('Emacs')
  })

  test('filters out uncategorized records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'random-app', undefined, 'r1'),
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results).toHaveLength(1)
    expect(results[0].activity).toBe('Emacs')
  })

  test('returns categories map with resolved category metadata', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
    ]
    const { categoriesMap } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(categoriesMap['cat-softdev']).toEqual({
      color: '#4ade80',
      name: ['Work & Dev', 'Software Dev'],
      score: 2,
    })
  })

  test('joins multiple apps in activity field', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord(
        '2024-01-15T08:25:00Z',
        '2024-01-15T09:00:00Z',
        'Slack',
        ['Work & Dev', 'Communication'],
        'r2',
      ),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results[0].activity).toBe('Emacs, Slack')
  })

  test('sums duration_sec from constituent records', () => {
    const records = [
      mkRecord('2024-01-15T08:00:00Z', '2024-01-15T08:30:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r1'),
      mkRecord('2024-01-15T08:31:00Z', '2024-01-15T09:00:00Z', 'Emacs', ['Work & Dev', 'Software Dev'], 'r2'),
    ]
    const { results } = mergeByCategorySpans(records, 2 * 60 * 1000, categories)

    expect(results[0].duration_sec).toBe(1800 + 1740)
  })
})
