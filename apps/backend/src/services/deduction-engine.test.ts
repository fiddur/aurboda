import type { DeductionRule } from '@aurboda/api-spec'

import { beforeEach, describe, expect, test, vi } from 'vitest'

import type { DeductionEngineDeps, TimeRange } from './deduction-engine.ts'

import {
  evaluateAllRules,
  evaluateRule,
  intersectTimeRanges,
  mergeRangesWithGap,
} from './deduction-engine.ts'

const d = (h: number, m = 0) =>
  new Date(`2024-01-15T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00Z`)

describe('intersectTimeRanges', () => {
  test('returns empty for non-overlapping ranges', () => {
    const a: TimeRange[] = [{ end: d(10), start: d(9) }]
    const b: TimeRange[] = [{ end: d(12), start: d(11) }]
    expect(intersectTimeRanges(a, b)).toEqual([])
  })

  test('returns overlap of two overlapping ranges', () => {
    const a: TimeRange[] = [{ end: d(11), start: d(9) }]
    const b: TimeRange[] = [{ end: d(12), start: d(10) }]
    expect(intersectTimeRanges(a, b)).toEqual([{ end: d(11), start: d(10) }])
  })

  test('returns empty for empty inputs', () => {
    expect(intersectTimeRanges([], [{ end: d(10), start: d(9) }])).toEqual([])
    expect(intersectTimeRanges([{ end: d(10), start: d(9) }], [])).toEqual([])
  })

  test('handles multiple overlapping ranges', () => {
    const a: TimeRange[] = [
      { end: d(10), start: d(8) },
      { end: d(15), start: d(13) },
    ]
    const b: TimeRange[] = [
      { end: d(11), start: d(9) },
      { end: d(14), start: d(12) },
    ]
    const result = intersectTimeRanges(a, b)
    expect(result).toEqual([
      { end: d(10), start: d(9) },
      { end: d(14), start: d(13) },
    ])
  })

  test('handles one range fully containing another', () => {
    const a: TimeRange[] = [{ end: d(12), start: d(8) }]
    const b: TimeRange[] = [{ end: d(11), start: d(9) }]
    expect(intersectTimeRanges(a, b)).toEqual([{ end: d(11), start: d(9) }])
  })

  test('handles touching but not overlapping ranges', () => {
    const a: TimeRange[] = [{ end: d(10), start: d(9) }]
    const b: TimeRange[] = [{ end: d(11), start: d(10) }]
    expect(intersectTimeRanges(a, b)).toEqual([])
  })
})

describe('mergeRangesWithGap', () => {
  test('returns empty for empty input', () => {
    expect(mergeRangesWithGap([], 0)).toEqual([])
  })

  test('returns single range unchanged', () => {
    const ranges: TimeRange[] = [{ end: d(10), start: d(9) }]
    expect(mergeRangesWithGap(ranges, 0)).toEqual(ranges)
  })

  test('merges ranges within gap', () => {
    const ranges: TimeRange[] = [
      { end: d(10), start: d(9) },
      { end: d(11, 30), start: d(10, 5) }, // 5 min gap
    ]
    const result = mergeRangesWithGap(ranges, 10 * 60 * 1000) // 10 min gap
    expect(result).toEqual([{ end: d(11, 30), start: d(9) }])
  })

  test('does not merge ranges beyond gap', () => {
    const ranges: TimeRange[] = [
      { end: d(10), start: d(9) },
      { end: d(12), start: d(11) }, // 1h gap
    ]
    const result = mergeRangesWithGap(ranges, 30 * 60 * 1000) // 30 min gap
    expect(result).toHaveLength(2)
  })
})

describe('evaluateRule', () => {
  const user = 'testuser'
  let deps: DeductionEngineDeps

  beforeEach(() => {
    deps = {
      deleteStaleRuleActivities: vi.fn().mockResolvedValue(0),
      getActivities: vi.fn().mockResolvedValue([]),
      getScreentime: vi.fn().mockResolvedValue([]),
      getTags: vi.fn().mockResolvedValue([]),
      insertActivity: vi.fn().mockResolvedValue(undefined),
      insertRuleRun: vi.fn().mockResolvedValue(undefined),
    }
  })

  const window = { end: d(23), start: d(0) }

  const makeRule = (overrides: Partial<DeductionRule> = {}): DeductionRule => ({
    conditions: [{ kind: 'tag', tag_name: 'sauna' }],
    enabled: true,
    id: 'rule-1',
    name: 'Sauna tag to activity',
    output_activity_type: 'sauna',
    priority: 0,
    ...overrides,
  })

  test('creates activities from single tag condition', async () => {
    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(11), start: d(10) }])

    const ids = await evaluateRule(user, makeRule(), window, deps)

    expect(ids).toHaveLength(1)
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        activity_type: 'sauna',
        end_time: d(11),
        source: 'deduction-rule',
        start_time: d(10),
      }),
    )
  })

  test('creates no activities when condition returns empty', async () => {
    vi.mocked(deps.getTags).mockResolvedValue([])

    const ids = await evaluateRule(user, makeRule(), window, deps)
    expect(ids).toHaveLength(0)
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  test('intersects multiple conditions (AND)', async () => {
    const rule = makeRule({
      conditions: [
        { activity_type: 'meditation', kind: 'activity' },
        { kind: 'tag', tag_name: 'holosync' },
      ],
      output_activity_type: 'binaural_meditation',
    })

    // Meditation from 9-10, Holosync tag from 9:30-10:30
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(10), start: d(9) }])
    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(10, 30), start: d(9, 30) }])

    const ids = await evaluateRule(user, rule, window, deps)

    expect(ids).toHaveLength(1)
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        activity_type: 'binaural_meditation',
        end_time: d(10),
        start_time: d(9, 30),
      }),
    )
  })

  test('returns empty when AND conditions do not overlap', async () => {
    const rule = makeRule({
      conditions: [
        { activity_type: 'meditation', kind: 'activity' },
        { kind: 'tag', tag_name: 'holosync' },
      ],
    })

    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(10), start: d(9) }])
    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(12), start: d(11) }])

    const ids = await evaluateRule(user, rule, window, deps)
    expect(ids).toHaveLength(0)
  })

  test('applies merge_gap_seconds to coalesce nearby ranges', async () => {
    const rule = makeRule({ merge_gap_seconds: 600 }) // 10 min gap

    // Two tag occurrences 5 min apart
    vi.mocked(deps.getTags).mockResolvedValue([
      { end: d(10), start: d(9) },
      { end: d(10, 30), start: d(10, 5) },
    ])

    const ids = await evaluateRule(user, rule, window, deps)

    expect(ids).toHaveLength(1) // Merged into one
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        end_time: d(10, 30),
        start_time: d(9),
      }),
    )
  })

  test('stores rule_id in activity data', async () => {
    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateRule(user, makeRule(), window, deps)

    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        data: { rule_id: 'rule-1', rule_name: 'Sauna tag to activity' },
      }),
    )
  })
})

describe('evaluateAllRules', () => {
  const user = 'testuser'
  let deps: DeductionEngineDeps
  const window = { end: d(23), start: d(0) }

  beforeEach(() => {
    deps = {
      deleteStaleRuleActivities: vi.fn().mockResolvedValue(0),
      getActivities: vi.fn().mockResolvedValue([]),
      getScreentime: vi.fn().mockResolvedValue([]),
      getTags: vi.fn().mockResolvedValue([]),
      insertActivity: vi.fn().mockResolvedValue(undefined),
      insertRuleRun: vi.fn().mockResolvedValue(undefined),
    }
  })

  test('evaluates rules in priority order', async () => {
    const callOrder: string[] = []

    // Priority 1 rule depends on priority 0 output
    const rules: DeductionRule[] = [
      {
        conditions: [{ kind: 'tag', tag_name: 'sauna' }],
        enabled: true,
        id: 'rule-0',
        name: 'Base rule',
        output_activity_type: 'sauna',
        priority: 0,
      },
      {
        conditions: [{ activity_type: 'sauna', kind: 'activity' }],
        enabled: true,
        id: 'rule-1',
        name: 'Chained rule',
        output_activity_type: 'wellness_session',
        priority: 1,
      },
    ]

    // Track evaluation order via insertRuleRun calls
    vi.mocked(deps.insertRuleRun).mockImplementation(async (_u, run) => {
      callOrder.push(run.rule_id)
    })

    // Tag resolver returns data for the base rule
    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateAllRules(user, rules, window, deps)

    expect(callOrder).toEqual(['rule-0', 'rule-1'])
  })

  test('returns aggregate counts', async () => {
    const rules: DeductionRule[] = [
      {
        conditions: [{ kind: 'tag', tag_name: 'sauna' }],
        enabled: true,
        id: 'rule-1',
        name: 'Rule 1',
        output_activity_type: 'sauna',
        priority: 0,
      },
    ]

    vi.mocked(deps.getTags).mockResolvedValue([
      { end: d(11), start: d(10) },
      { end: d(15), start: d(14) },
    ])

    const result = await evaluateAllRules(user, rules, window, deps)

    expect(result.rules_evaluated).toBe(1)
    expect(result.activities_created).toBe(2)
  })

  test('cleans up stale activities after evaluation', async () => {
    const rules: DeductionRule[] = [
      {
        conditions: [{ kind: 'tag', tag_name: 'sauna' }],
        enabled: true,
        id: 'rule-1',
        name: 'Rule 1',
        output_activity_type: 'sauna',
        priority: 0,
      },
    ]

    vi.mocked(deps.getTags).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateAllRules(user, rules, window, deps)

    expect(deps.deleteStaleRuleActivities).toHaveBeenCalledWith(
      user,
      'rule-1',
      window.start,
      window.end,
      expect.any(Array),
    )
  })
})
