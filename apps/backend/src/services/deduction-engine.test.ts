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

const makeDeps = (): DeductionEngineDeps => ({
  deleteStaleRuleActivities: vi.fn().mockResolvedValue(0),
  enrichActivities: vi.fn().mockResolvedValue([]),
  getActivities: vi.fn().mockResolvedValue([]),
  getActivitiesWithData: vi.fn().mockResolvedValue([]),
  getActivitiesWithDataFilters: vi.fn().mockResolvedValue([]),
  getEarliestActivityTime: vi.fn().mockResolvedValue(null),
  getLocationVisits: vi.fn().mockResolvedValue([]),
  getScrobbles: vi.fn().mockResolvedValue([]),
  getScreentime: vi.fn().mockResolvedValue([]),
  insertActivity: vi.fn().mockResolvedValue(undefined),
  insertRuleRun: vi.fn().mockResolvedValue(undefined),
})

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
    deps = makeDeps()
  })

  const window = { end: d(23), start: d(0) }

  const makeRule = (overrides: Partial<DeductionRule> = {}): DeductionRule => ({
    conditions: [{ activity_type: 'sauna', kind: 'activity' }],
    enabled: true,
    id: 'rule-1',
    name: 'Sauna activity rule',
    output_activity_type: 'sauna',
    priority: 0,
    ...overrides,
  })

  test('creates activities from single activity condition', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    const { affected_ids } = await evaluateRule(user, makeRule(), window, deps)

    expect(affected_ids).toHaveLength(1)
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
    vi.mocked(deps.getActivities).mockResolvedValue([])

    const { affected_ids } = await evaluateRule(user, makeRule(), window, deps)
    expect(affected_ids).toHaveLength(0)
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  test('intersects multiple conditions (AND)', async () => {
    const rule = makeRule({
      conditions: [
        { activity_type: 'meditation', kind: 'activity' },
        { activity_type: 'holosync', kind: 'activity' },
      ],
      output_activity_type: 'binaural_meditation',
    })

    // Meditation from 9-10, Holosync from 9:30-10:30
    vi.mocked(deps.getActivities).mockImplementation(async (_u, type) => {
      if (type === 'meditation') return [{ end: d(10), start: d(9) }]
      if (type === 'holosync') return [{ end: d(10, 30), start: d(9, 30) }]
      return []
    })

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(1)
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
        { activity_type: 'holosync', kind: 'activity' },
      ],
    })

    vi.mocked(deps.getActivities).mockImplementation(async (_u, type) => {
      if (type === 'meditation') return [{ end: d(10), start: d(9) }]
      if (type === 'holosync') return [{ end: d(12), start: d(11) }]
      return []
    })

    const { affected_ids } = await evaluateRule(user, rule, window, deps)
    expect(affected_ids).toHaveLength(0)
  })

  test('applies merge_gap_seconds to coalesce nearby ranges', async () => {
    const rule = makeRule({ merge_gap_seconds: 600 }) // 10 min gap

    // Two activity occurrences 5 min apart
    vi.mocked(deps.getActivities).mockResolvedValue([
      { end: d(10), start: d(9) },
      { end: d(10, 30), start: d(10, 5) },
    ])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(1) // Merged into one
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        end_time: d(10, 30),
        start_time: d(9),
      }),
    )
  })

  test('stores rule_id and rule_name in activity data', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateRule(user, makeRule(), window, deps)

    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        data: { rule_id: 'rule-1', rule_name: 'Sauna activity rule' },
      }),
    )
  })

  // --- output_data tests ---

  test('merges output_data into created activity data', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    const rule = makeRule({ output_data: { device: 'spanda', display: 'external_monitor' } })
    await evaluateRule(user, rule, window, deps)

    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        data: {
          device: 'spanda',
          display: 'external_monitor',
          rule_id: 'rule-1',
          rule_name: 'Sauna activity rule',
        },
      }),
    )
  })

  // --- activity_data condition tests ---

  test('resolves activity_data condition with eq operator', async () => {
    const rule = makeRule({
      conditions: [
        {
          activity_type: 'computer_active',
          field: 'display',
          kind: 'activity_data',
          operator: 'eq',
          value: 'external',
        },
      ],
    })

    vi.mocked(deps.getActivitiesWithData).mockResolvedValue([{ end: d(11), start: d(10) }])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)
    expect(affected_ids).toHaveLength(1)
    expect(deps.getActivitiesWithData).toHaveBeenCalledWith(
      user,
      'computer_active',
      'display',
      'eq',
      'external',
      window,
    )
  })

  test('resolves activity_data condition with not_exists operator', async () => {
    const rule = makeRule({
      conditions: [{ activity_type: 'sex', field: 'partner', kind: 'activity_data', operator: 'not_exists' }],
    })

    vi.mocked(deps.getActivitiesWithData).mockResolvedValue([{ end: d(11), start: d(10) }])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)
    expect(affected_ids).toHaveLength(1)
    expect(deps.getActivitiesWithData).toHaveBeenCalledWith(
      user,
      'sex',
      'partner',
      'not_exists',
      undefined,
      window,
    )
  })

  // --- location condition tests ---

  test('resolves location condition', async () => {
    const rule = makeRule({
      conditions: [{ kind: 'location', location_name: 'Hokos' }],
    })

    vi.mocked(deps.getLocationVisits).mockResolvedValue([{ end: d(18), start: d(8) }])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)
    expect(affected_ids).toHaveLength(1)
    expect(deps.getLocationVisits).toHaveBeenCalledWith(user, 'Hokos', window)
  })

  // --- enrich mode tests ---

  test('enrich mode calls enrichActivities instead of insertActivity', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])
    vi.mocked(deps.enrichActivities).mockResolvedValue(['activity-1'])

    const rule = makeRule({
      mode: 'enrich',
      output_activity_type: 'sex',
      output_data: { partner: 'Sara' },
    })

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toEqual(['activity-1'])
    expect(deps.enrichActivities).toHaveBeenCalledWith(
      user,
      'sex',
      [{ end: d(11), start: d(10) }],
      { partner: 'Sara' },
      'rule-1',
    )
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  // --- dry-run tests ---

  test('dry-run in create mode returns count without creating', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([
      { end: d(11), start: d(10) },
      { end: d(15), start: d(14) },
    ])

    const { affected_ids, would_affect } = await evaluateRule(user, makeRule(), window, deps, true)

    expect(would_affect).toBe(2)
    expect(affected_ids).toHaveLength(0)
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  test('dry-run in enrich mode returns count without enriching', async () => {
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    const rule = makeRule({
      mode: 'enrich',
      output_activity_type: 'sex',
      output_data: { partner: 'Sara' },
    })

    const { affected_ids, would_affect } = await evaluateRule(user, rule, window, deps, true)

    expect(would_affect).toBe(1)
    expect(affected_ids).toHaveLength(0)
    expect(deps.enrichActivities).not.toHaveBeenCalled()
  })

  // --- scrobble condition tests ---

  test('resolves scrobble condition and creates activities', async () => {
    const rule = makeRule({
      conditions: [
        {
          artist: ['Holosync'],
          duration_seconds: 1800,
          kind: 'scrobble' as const,
          match_mode: 'exact' as const,
        },
      ],
      output_activity_type: 'holosync',
    })

    vi.mocked(deps.getScrobbles).mockResolvedValue([{ end: d(10, 30), start: d(10) }])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(1)
    expect(deps.getScrobbles).toHaveBeenCalledWith(user, ['Holosync'], undefined, 'exact', 1800, window)
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        activity_type: 'holosync',
        end_time: d(10, 30),
        start_time: d(10),
      }),
    )
  })

  test('resolves scrobble condition with track and contains mode', async () => {
    const rule = makeRule({
      conditions: [
        {
          duration_seconds: 240,
          kind: 'scrobble' as const,
          match_mode: 'contains' as const,
          track: 'Warmup',
        },
      ],
      output_activity_type: 'vocal_training',
    })

    vi.mocked(deps.getScrobbles).mockResolvedValue([
      { end: d(9, 4), start: d(9) },
      { end: d(9, 8), start: d(9, 4) },
    ])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(2)
    expect(deps.getScrobbles).toHaveBeenCalledWith(user, undefined, 'Warmup', 'contains', 240, window)
  })

  test('scrobble condition combined with activity condition (AND)', async () => {
    const rule = makeRule({
      conditions: [
        { activity_type: 'meditation', kind: 'activity' },
        {
          artist: ['Holosync'],
          duration_seconds: 1800,
          kind: 'scrobble' as const,
          match_mode: 'exact' as const,
        },
      ],
      output_activity_type: 'holosync',
    })

    // Meditation 9-10, holosync scrobble 9:15-9:45
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(10), start: d(9) }])
    vi.mocked(deps.getScrobbles).mockResolvedValue([{ end: d(9, 45), start: d(9, 15) }])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(1)
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        activity_type: 'holosync',
        end_time: d(9, 45),
        start_time: d(9, 15),
      }),
    )
  })

  test('scrobble condition returns empty when no scrobbles match', async () => {
    const rule = makeRule({
      conditions: [
        {
          artist: ['Nonexistent'],
          duration_seconds: 240,
          kind: 'scrobble' as const,
          match_mode: 'exact' as const,
        },
      ],
    })

    vi.mocked(deps.getScrobbles).mockResolvedValue([])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)
    expect(affected_ids).toHaveLength(0)
    expect(deps.insertActivity).not.toHaveBeenCalled()
  })

  test('scrobble condition defaults match_mode to exact when omitted', async () => {
    const rule = makeRule({
      conditions: [
        {
          artist: ['Artist'],
          duration_seconds: 210,
          kind: 'scrobble' as const,
          match_mode: undefined as unknown as 'exact',
        },
      ],
      output_activity_type: 'test',
    })

    vi.mocked(deps.getScrobbles).mockResolvedValue([{ end: d(10, 30), start: d(10) }])

    await evaluateRule(user, rule, window, deps)

    expect(deps.getScrobbles).toHaveBeenCalledWith(user, ['Artist'], undefined, 'exact', 210, window)
  })

  test('scrobble condition with merge_gap_seconds coalesces nearby ranges', async () => {
    const rule = makeRule({
      conditions: [
        {
          artist: ['Vocal Coach'],
          duration_seconds: 240,
          kind: 'scrobble' as const,
          match_mode: 'exact' as const,
        },
      ],
      merge_gap_seconds: 600, // 10 min gap
      output_activity_type: 'vocal_training',
    })

    // Two scrobbles 5 min apart → should merge into one
    vi.mocked(deps.getScrobbles).mockResolvedValue([
      { end: d(9, 4), start: d(9) },
      { end: d(9, 13), start: d(9, 9) }, // 5 min gap from first end
    ])

    const { affected_ids } = await evaluateRule(user, rule, window, deps)

    expect(affected_ids).toHaveLength(1) // Merged into one
    expect(deps.insertActivity).toHaveBeenCalledWith(
      user,
      expect.objectContaining({
        end_time: d(9, 13),
        start_time: d(9),
      }),
    )
  })
})

describe('evaluateAllRules', () => {
  const user = 'testuser'
  let deps: DeductionEngineDeps
  const window = { end: d(23), start: d(0) }

  beforeEach(() => {
    deps = makeDeps()
  })

  test('evaluates rules in priority order', async () => {
    const callOrder: string[] = []

    // Priority 1 rule depends on priority 0 output
    const rules: DeductionRule[] = [
      {
        conditions: [{ activity_type: 'sauna', kind: 'activity' }],
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

    // Activity resolver returns data for the base rule
    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateAllRules(user, rules, window, deps)

    expect(callOrder).toEqual(['rule-0', 'rule-1'])
  })

  test('returns aggregate counts', async () => {
    const rules: DeductionRule[] = [
      {
        conditions: [{ activity_type: 'sauna', kind: 'activity' }],
        enabled: true,
        id: 'rule-1',
        name: 'Rule 1',
        output_activity_type: 'sauna',
        priority: 0,
      },
    ]

    vi.mocked(deps.getActivities).mockResolvedValue([
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
        conditions: [{ activity_type: 'sauna', kind: 'activity' }],
        enabled: true,
        id: 'rule-1',
        name: 'Rule 1',
        output_activity_type: 'sauna',
        priority: 0,
      },
    ]

    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])

    await evaluateAllRules(user, rules, window, deps)

    expect(deps.deleteStaleRuleActivities).toHaveBeenCalledWith(
      user,
      'rule-1',
      window.start,
      window.end,
      expect.any(Array),
    )
  })

  test('does not clean up stale activities for enrich mode rules', async () => {
    const rules: DeductionRule[] = [
      {
        conditions: [{ activity_type: 'sauna', kind: 'activity' }],
        enabled: true,
        id: 'rule-1',
        mode: 'enrich',
        name: 'Enrich rule',
        output_activity_type: 'sex',
        output_data: { partner: 'Sara' },
        priority: 0,
      },
    ]

    vi.mocked(deps.getActivities).mockResolvedValue([{ end: d(11), start: d(10) }])
    vi.mocked(deps.enrichActivities).mockResolvedValue(['a1'])

    await evaluateAllRules(user, rules, window, deps)

    expect(deps.deleteStaleRuleActivities).not.toHaveBeenCalled()
  })
})
