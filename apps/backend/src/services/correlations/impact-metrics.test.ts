import { impactExtraMetricsError, MAX_IMPACT_EXTRA_METRICS, parseImpactMetricsParam } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import {
  type DailySampleCount,
  MIN_IMPACT_METRIC_DAYS,
  MIN_IMPACT_QUARTER_HOURS_PER_DAY,
  selectImpactMetrics,
} from './impact-metrics.ts'

/** One entry per day: [samples, covered quarter hours]. */
const days = (metric: string, perDay: [number, number][]): DailySampleCount[] =>
  perDay.map(([count, quarter_hours], i) => ({
    count,
    day: `2026-01-${String(i + 1).padStart(2, '0')}`,
    metric,
    quarter_hours,
  }))

const continuous = (n: number = MIN_IMPACT_METRIC_DAYS): [number, number][] =>
  Array.from({ length: n }, () => [288, 96])

describe('selectImpactMetrics', () => {
  test('offers metrics covering most of the day, with label, unit, coverage and samples', () => {
    const options = selectImpactMetrics(
      [
        ...days('body_battery', [
          [300, 96],
          [200, 90],
          [250, 94],
        ]),
        ...days('spo2', [
          [100, 60],
          [120, 64],
          [110, 62],
          [130, 66],
        ]),
      ],
      [],
    )
    expect(options).toEqual([
      {
        coverage_hours_per_day: 23.5,
        label: 'Body Battery',
        metric: 'body_battery',
        samples_per_day: 250,
        unit: 'score',
      },
      { coverage_hours_per_day: 15.8, label: 'SpO2', metric: 'spo2', samples_per_day: 115, unit: 'percent' },
    ])
  })

  test('leaves out a metric with many samples recorded only during workouts and sleep', () => {
    const options = selectImpactMetrics(
      [
        ...days('respiratory_rate', [
          [5000, 32],
          [4800, 30],
          [5200, 34],
        ]),
        ...days('body_battery', continuous()),
      ],
      [],
    )
    expect(options.map((o) => o.metric)).toEqual(['body_battery'])
  })

  test('leaves out the three fixed metrics and cumulative ones', () => {
    const options = selectImpactMetrics(
      [
        ...days('hrv_rmssd', continuous()),
        ...days('heart_rate', continuous()),
        ...days('stress_level', continuous()),
        ...days('steps', continuous()),
        ...days('calories_active', continuous()),
      ],
      [],
    )
    expect(options).toEqual([])
  })

  test('needs data on enough days and a median of at least 48 covered quarter hours', () => {
    const at = MIN_IMPACT_QUARTER_HOURS_PER_DAY
    const options = selectImpactMetrics(
      [
        ...days('body_battery', continuous(MIN_IMPACT_METRIC_DAYS - 1)),
        ...days('spo2', [
          [500, at - 1],
          [500, at - 1],
          [500, 96],
        ]),
        ...days('respiratory_rate', [
          [100, at],
          [100, at],
          [100, 1],
        ]),
      ],
      [],
    )
    expect(options.map((o) => [o.metric, o.coverage_hours_per_day])).toEqual([['respiratory_rate', 12]])
  })

  test('labels a custom metric by its name in words and takes its unit', () => {
    const options = selectImpactMetrics(
      [...days('skin_conductance', continuous()), ...days('orphan_metric', continuous())],
      [{ description: 'A long paragraph about the sensor.', name: 'skin_conductance', unit: 'uS' }],
    )
    expect(options).toEqual([
      {
        coverage_hours_per_day: 24,
        label: 'Skin Conductance',
        metric: 'skin_conductance',
        samples_per_day: 288,
        unit: 'uS',
      },
    ])
  })

  test('sorts by coverage, then samples, then name', () => {
    const day = (count: number, quarterHours: number): [number, number][] =>
      Array.from({ length: MIN_IMPACT_METRIC_DAYS }, () => [count, quarterHours])
    const options = selectImpactMetrics(
      [
        ...days('spo2', day(1000, 60)),
        ...days('body_battery', day(100, 90)),
        ...days('respiratory_rate', day(200, 60)),
        ...days('body_temperature', day(200, 60)),
      ],
      [],
    )
    expect(options.map((o) => o.metric)).toEqual([
      'body_battery',
      'spo2',
      'body_temperature',
      'respiratory_rate',
    ])
  })
})

describe('parseImpactMetricsParam', () => {
  test('splits, trims, drops empties and duplicates', () => {
    expect(parseImpactMetricsParam(' body_battery, ,respiratory_rate,body_battery,')).toEqual([
      'body_battery',
      'respiratory_rate',
    ])
    expect(parseImpactMetricsParam(undefined)).toEqual([])
    expect(parseImpactMetricsParam('')).toEqual([])
  })
})

describe('impactExtraMetricsError', () => {
  test('accepts up to the maximum of plain names, known or not', () => {
    expect(impactExtraMetricsError([])).toBeNull()
    expect(impactExtraMetricsError(['body_battery', 'respiratory_rate', 'spo2', 'unknown_thing'])).toBeNull()
  })

  test('refuses too many, malformed names and cumulative metrics', () => {
    const tooMany = Array.from({ length: MAX_IMPACT_EXTRA_METRICS + 1 }, (_, i) => `m${i}`)
    expect(impactExtraMetricsError(tooMany)).toMatch(/At most 4/)
    expect(impactExtraMetricsError(['Body Battery'])).toMatch(/Not a metric name/)
    expect(impactExtraMetricsError([`a${'b'.repeat(50)}`])).toMatch(/Not a metric name/)
    expect(impactExtraMetricsError(['body_battery', 'steps'])).toMatch(/steps is a running total/)
  })
})
