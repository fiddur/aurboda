import type { ImpactBucket, ImpactGroup, WindowEffect } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { NO_EFFECT } from './metrics'
import {
  breakdownMetricOptions,
  chartableGroups,
  describeFilterCount,
  formatLimits,
  isFilterKeyOn,
  metricAccessors,
  parseLimitsInput,
  resolveBreakdownMetric,
  toggleFilterKey,
  withoutDimension,
} from './slicing'

const stats = (mean: number | null) => ({ mean, occurrences: 1, sample_count: 1, stddev: null })

const bucket = (phase: ImpactBucket['phase'], hrv: number | null, extra?: number): ImpactBucket => ({
  end_offset_minutes: 0,
  hr: stats(hrv === null ? null : hrv + 10),
  hrv: stats(hrv),
  ...(extra !== undefined && { metrics: { body_battery: stats(extra) } }),
  phase,
  start_offset_minutes: 0,
  stress: stats(hrv === null ? null : hrv + 20),
})

const effect = (change: number): WindowEffect => ({ ...NO_EFFECT, change, paired_occurrences: 3 })

const group = (key: string, occurrences: number): ImpactGroup => ({
  avg_duration_min: 20,
  hr_effect: effect(-2),
  hrv_effect: effect(3),
  key,
  label: key,
  metric_effects: { body_battery: effect(5) },
  occurrences,
  stress_effect: effect(-4),
  timeline: [bucket('before', 40, 60), bucket('during', 45, 55), bucket('after', null, 50)],
})

describe('filter keys', () => {
  test('toggling adds a filter, adds and removes keys, and drops an empty filter', () => {
    const one = toggleFilterKey([], 'duration', '15-30')
    expect(one).toEqual([{ dimension: 'duration', keys: ['15-30'] }])
    const two = toggleFilterKey(toggleFilterKey(one, 'sleep', 'none'), 'duration', '30-60')
    expect(two).toEqual([
      { dimension: 'duration', keys: ['15-30', '30-60'] },
      { dimension: 'sleep', keys: ['none'] },
    ])
    const back = toggleFilterKey(toggleFilterKey(two, 'duration', '15-30'), 'duration', '30-60')
    expect(back).toEqual([{ dimension: 'sleep', keys: ['none'] }])
  })

  test('tells whether a key is on', () => {
    const filters = [{ dimension: 'sleep', keys: ['none'] }]
    expect(isFilterKeyOn(filters, 'sleep', 'none')).toBe(true)
    expect(isFilterKeyOn(filters, 'sleep', 'before')).toBe(false)
    expect(isFilterKeyOn(filters, 'duration', 'none')).toBe(false)
  })

  test('removes one dimension', () => {
    const filters = [
      { dimension: 'duration', keys: ['0-15'] },
      { dimension: 'sleep', keys: ['none'] },
    ]
    expect(withoutDimension(filters, 'duration')).toEqual([{ dimension: 'sleep', keys: ['none'] }])
  })
})

describe('limits', () => {
  test('parses valid limits', () => {
    expect(parseLimitsInput('10, 20 ,45', 'duration')).toEqual({ limits: [10, 20, 45] })
    expect(parseLimitsInput('6,22', 'time_of_day')).toEqual({ limits: [6, 22] })
  })

  test('blank text is an error', () => {
    expect(parseLimitsInput('  ', 'duration')).toEqual({ error: 'Give at least one limit' })
  })

  test('reports invalid limits', () => {
    expect(parseLimitsInput('30,15', 'duration')).toHaveProperty('error')
    expect(parseLimitsInput('0,24', 'time_of_day')).toHaveProperty('error')
    expect(parseLimitsInput('a', 'duration')).toHaveProperty('error')
    expect(parseLimitsInput('0', 'duration')).toHaveProperty('error')
  })

  test('formats limits', () => {
    expect(formatLimits([15, 30, 60])).toBe('15, 30, 60')
  })
})

describe('chartableGroups', () => {
  test('keeps groups with at least 3 sessions, at most 8', () => {
    const groups = [group('a', 2), ...Array.from({ length: 10 }, (_, i) => group(`g${i}`, 3 + i))]
    const chartable = chartableGroups(groups)
    expect(chartable).toHaveLength(8)
    expect(chartable[0].key).toBe('g0')
    expect(chartable.some((g) => g.key === 'a')).toBe(false)
  })
})

describe('breakdown metric', () => {
  const extras = [{ label: 'Body Battery', metric: 'body_battery' }]

  test('lists the shown metrics in canonical order then the extras', () => {
    expect(breakdownMetricOptions(['stress', 'hrv'], extras)).toEqual([
      { key: 'hrv', label: 'HRV' },
      { key: 'stress', label: 'Stress' },
      { key: 'body_battery', label: 'Body Battery' },
    ])
  })

  test('resolves the requested metric, else stress, else the first', () => {
    const all = breakdownMetricOptions(['hrv', 'hr', 'stress'], extras)
    expect(resolveBreakdownMetric('body_battery', all)).toBe('body_battery')
    expect(resolveBreakdownMetric('', all)).toBe('stress')
    expect(resolveBreakdownMetric('spo2', all)).toBe('stress')
    expect(resolveBreakdownMetric('', breakdownMetricOptions(['hr'], extras))).toBe('hr')
    expect(resolveBreakdownMetric('', [])).toBe('')
  })
})

describe('metricAccessors', () => {
  const g = group('a', 5)

  test('reads a fixed metric', () => {
    const hrv = metricAccessors('hrv')
    expect(hrv.series(g)).toEqual([40, 45, null])
    expect(hrv.during(g)).toBe(45)
    expect(hrv.effect(g).change).toBe(3)
    expect(hrv).toMatchObject({ decimals: 1, direction: 'up' })
    expect(metricAccessors('hr')).toMatchObject({ decimals: 0, direction: 'down' })
    expect(metricAccessors('stress').during(g)).toBe(65)
    expect(metricAccessors('stress').effect(g).change).toBe(-4)
  })

  test('reads an extra metric', () => {
    const extra = metricAccessors('body_battery')
    expect(extra.series(g)).toEqual([60, 55, 50])
    expect(extra.during(g)).toBe(55)
    expect(extra.effect(g).change).toBe(5)
    expect(extra).toMatchObject({ decimals: 1, direction: 'up' })
  })

  test('an extra without data reads as nothing', () => {
    const missing = metricAccessors('skin_temp')
    expect(missing.series(g)).toEqual([null, null, null])
    expect(missing.effect(g)).toEqual(NO_EFFECT)
    expect(missing.direction).toBe('neutral')
  })
})

describe('describeFilterCount', () => {
  test('counts kept of total, or the total alone', () => {
    expect(describeFilterCount(70, 151)).toBe('70 of 151 sessions')
    expect(describeFilterCount(151, 151)).toBe('151 sessions')
    expect(describeFilterCount(1, 1)).toBe('1 session')
    expect(describeFilterCount(0, 1)).toBe('0 of 1 session')
  })
})
