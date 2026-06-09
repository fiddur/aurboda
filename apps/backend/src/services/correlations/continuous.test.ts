import { describe, expect, test } from 'vitest'

import { computeContinuous } from './continuous.ts'

const seriesMap = (entries: [string, number][]): Map<string, number> => new Map(entries)

describe('computeContinuous', () => {
  test('perfectly correlated same-day series', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']
    const trigger = seriesMap(days.map((d, i) => [d, i + 1]))
    const outcome = seriesMap(days.map((d, i) => [d, 2 * (i + 1)]))

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })

    expect(result.n).toBe(4)
    expect(result.pearson).toBeCloseTo(1, 5)
    expect(result.pearson_p).toBe(0) // perfect correlation
    expect(result.spearman).toBeCloseTo(1, 5)
  })

  test('reports a Pearson p-value for a noisy correlation', () => {
    const days = Array.from(
      { length: 20 },
      (_, i) => new Date(Date.parse('2024-01-01T00:00:00Z') + i * 86_400_000).toISOString().split('T')[0],
    )
    // Weak/none relationship -> p should be a real probability in (0, 1].
    const trigger = seriesMap(days.map((d, i) => [d, i % 5]))
    const outcome = seriesMap(days.map((d, i) => [d, (i * 7) % 3]))
    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })
    expect(result.pearson_p).not.toBeNull()
    expect(result.pearson_p!).toBeGreaterThan(0)
    expect(result.pearson_p!).toBeLessThanOrEqual(1)
  })

  test('pearson_p is null with too few pairs', () => {
    const days = ['2024-01-01', '2024-01-02']
    const result = computeContinuous({
      triggerDaily: seriesMap(days.map((d, i) => [d, i])),
      outcomeDaily: seriesMap(days.map((d, i) => [d, i])),
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })
    expect(result.pearson_p).toBeNull()
  })

  test('lag shifts the outcome forward by N days', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03']
    // outcome on day d+1 equals trigger on day d
    const trigger = seriesMap([
      ['2024-01-01', 10],
      ['2024-01-02', 20],
      ['2024-01-03', 30],
    ])
    const outcome = seriesMap([
      ['2024-01-02', 10],
      ['2024-01-03', 20],
      ['2024-01-04', 30],
    ])

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: ['2024-01-02', '2024-01-03', '2024-01-04'],
      lagDays: 1,
    })

    expect(result.n).toBe(3)
    expect(result.pearson).toBeCloseTo(1, 5)
    expect(result.series[0]).toEqual({ date: '2024-01-01', trigger: 10, outcome: 10 })
  })

  test('only pairs days where both sides are known', () => {
    const trigger = seriesMap([
      ['2024-01-01', 1],
      ['2024-01-02', 2],
      ['2024-01-03', 3],
    ])
    const outcome = seriesMap([
      ['2024-01-01', 5],
      ['2024-01-03', 9],
    ])

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      outcomeKnown: ['2024-01-01', '2024-01-03'], // day 2 unknown
      lagDays: 0,
    })

    expect(result.n).toBe(2)
  })

  test('missing value on a known day defaults to 0', () => {
    const result = computeContinuous({
      triggerDaily: seriesMap([['2024-01-01', 100]]), // day 2 known but absent -> 0
      outcomeDaily: seriesMap([
        ['2024-01-01', 1],
        ['2024-01-02', 2],
        ['2024-01-03', 3],
      ]),
      triggerKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      outcomeKnown: ['2024-01-01', '2024-01-02', '2024-01-03'],
      lagDays: 0,
    })

    expect(result.n).toBe(3)
    const day2 = result.series.find((p) => p.date === '2024-01-02')
    expect(day2?.trigger).toBe(0)
  })

  test('binary trigger yields a present-vs-absent group comparison', () => {
    const days = Array.from(
      { length: 8 },
      (_, i) => new Date(Date.parse('2024-01-01T00:00:00Z') + i * 86_400_000).toISOString().split('T')[0],
    )
    // Trigger present (1) on the first four days, absent on the rest. Outcome is
    // clearly higher on present days (with within-group variance so the t-test
    // is estimable), and the groups don't overlap.
    const presentOutcomes = [78, 80, 82, 80]
    const absentOutcomes = [69, 71, 70, 70]
    const trigger = seriesMap(days.map((d, i) => [d, i < 4 ? 1 : 0]))
    const outcome = seriesMap(days.map((d, i) => [d, i < 4 ? presentOutcomes[i] : absentOutcomes[i - 4]]))

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })

    const gc = result.group_comparison
    expect(gc).not.toBeNull()
    expect(gc!.trigger_is_binary).toBe(true)
    expect(gc!.n_with).toBe(4)
    expect(gc!.n_without).toBe(4)
    expect(gc!.mean_with).toBeCloseTo(80, 6)
    expect(gc!.mean_without).toBeCloseTo(70, 6)
    expect(gc!.difference).toBeCloseTo(10, 6)
    expect(gc!.welch).not.toBeNull()
    expect(gc!.mann_whitney!.rank_biserial).toBeCloseTo(1, 6)
  })

  test('counts and (optionally) filters incomplete nutrition days', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03', '2024-01-04']
    const trigger = seriesMap(days.map((d, i) => [d, i + 1]))
    const outcome = seriesMap(days.map((d, i) => [d, 10 + i]))
    // Only the 1st and 3rd days have complete nutrition on the trigger side.
    const triggerCompleteDays = ['2024-01-01', '2024-01-03']

    // 'all': keep every aligned pair but report how many were complete.
    const all = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
      triggerCompleteDays,
    })
    expect(all.n).toBe(4)
    expect(all.n_complete).toBe(2)

    // 'complete_only': drop the incomplete pairs entirely.
    const filtered = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
      triggerCompleteDays,
      requireComplete: true,
    })
    expect(filtered.n).toBe(2)
    expect(filtered.n_complete).toBe(2)
    expect(filtered.series.map((p) => p.date)).toEqual(['2024-01-01', '2024-01-03'])
  })

  test('n_complete is null when no completeness set is provided', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03']
    const result = computeContinuous({
      triggerDaily: seriesMap(days.map((d, i) => [d, i])),
      outcomeDaily: seriesMap(days.map((d, i) => [d, i])),
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })
    expect(result.n_complete).toBeNull()
  })

  test('no group comparison when the trigger is present every day', () => {
    const days = ['2024-01-01', '2024-01-02', '2024-01-03']
    const result = computeContinuous({
      triggerDaily: seriesMap(days.map((d) => [d, 5])),
      outcomeDaily: seriesMap(days.map((d, i) => [d, i])),
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
    })
    expect(result.group_comparison).toBeNull()
  })

  test('caps the returned series', () => {
    const days = Array.from(
      { length: 50 },
      (_, i) => new Date(Date.parse('2024-01-01T00:00:00Z') + i * 86_400_000).toISOString().split('T')[0],
    )
    const trigger = seriesMap(days.map((d, i) => [d, i]))
    const outcome = seriesMap(days.map((d, i) => [d, i]))

    const result = computeContinuous({
      triggerDaily: trigger,
      outcomeDaily: outcome,
      triggerKnown: days,
      outcomeKnown: days,
      lagDays: 0,
      maxSeriesPoints: 10,
    })

    expect(result.n).toBe(50)
    expect(result.series).toHaveLength(10)
  })
})
