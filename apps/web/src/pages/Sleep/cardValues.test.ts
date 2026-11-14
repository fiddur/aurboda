import type { PeriodMetricStats } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { sleepCardValues } from './cardValues'

const stats = (
  overrides: Partial<PeriodMetricStats> & { metric: string; count: number },
): PeriodMetricStats => ({
  avg: 0,
  change_from_previous_period_percent: null,
  completeness_percent: 0,
  max: 0,
  min: 0,
  stddev: 0,
  trend_per_day: null,
  unit: '',
  ...overrides,
})

describe('sleepCardValues', () => {
  it('maps a metric with no samples to no value and no trend', () => {
    const values = sleepCardValues([
      stats({ change_from_previous_period_percent: 0, count: 0, metric: 'sleep_score' }),
      stats({ count: 0, metric: 'sleep_efficiency' }),
      stats({ count: 0, metric: 'sleep_latency' }),
    ])
    expect(values.sleep_score).toEqual({ avg: null, trend: null })
    expect(values.sleep_efficiency).toEqual({ avg: null, trend: null })
    expect(values.sleep_latency).toEqual({ avg: null, trend: null })
  })

  it('keeps the average and trend of a metric with samples', () => {
    const values = sleepCardValues([
      stats({ avg: 82.5, change_from_previous_period_percent: 3.2, count: 7, metric: 'sleep_score' }),
    ])
    expect(values.sleep_score).toEqual({ avg: 82.5, trend: 3.2 })
  })

  it('keeps a real zero average', () => {
    const values = sleepCardValues([stats({ avg: 0, count: 4, metric: 'sleep_latency' })])
    expect(values.sleep_latency).toEqual({ avg: 0, trend: null })
  })

  it('leaves out metrics the summary did not return', () => {
    expect(sleepCardValues([]).sleep_score).toBeUndefined()
  })
})
