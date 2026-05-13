import type { PeriodMetricStats } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { periodStatsValue } from './periodSummary'

const stats = (overrides: Partial<PeriodMetricStats> & { count: number }): PeriodMetricStats => ({
  avg: 0,
  change_from_previous_period_percent: null,
  completeness_percent: 0,
  max: 0,
  metric: 'sleep_score',
  min: 0,
  stddev: 0,
  trend_per_day: null,
  unit: '',
  ...overrides,
})

describe('periodStatsValue', () => {
  it('returns null when stats is undefined', () => {
    expect(periodStatsValue(undefined, 'avg')).toBeNull()
  })

  it('returns null when count is 0 — even if avg is zero-filled', () => {
    expect(periodStatsValue(stats({ avg: 0, count: 0 }), 'avg')).toBeNull()
  })

  it('returns the field value when count > 0', () => {
    expect(periodStatsValue(stats({ avg: 82.5, count: 8 }), 'avg')).toBe(82.5)
    expect(periodStatsValue(stats({ count: 8, max: 95 }), 'max')).toBe(95)
  })

  it('returns 0 when count > 0 and the field genuinely is zero', () => {
    // A real zero is a valid value when we have samples — only the
    // "no samples at all" case should collapse to null.
    expect(periodStatsValue(stats({ avg: 0, count: 5 }), 'avg')).toBe(0)
  })
})
