import { describe, expect, test } from 'vitest'

import type { HrvStatsWithDelta } from '../../state/api'

import {
  describeMetrics,
  describeProductivityR,
  extraMetricColumn,
  metricDirection,
  orderExtras,
  proseLabel,
  toggleExtra,
  toggleMetric,
} from './metrics'

describe('describeMetrics', () => {
  test('lists the shown metrics in canonical order', () => {
    expect(describeMetrics(['hrv', 'hr', 'stress'])).toBe('HRV, heart rate and stress')
    expect(describeMetrics(['stress', 'hrv'])).toBe('HRV and stress')
    expect(describeMetrics(['stress'])).toBe('stress')
    expect(describeMetrics([])).toBe('')
  })

  test('spells out HRV in the long style', () => {
    expect(describeMetrics(['hrv', 'hr', 'stress'], 'long')).toBe(
      'heart rate variability (HRV), heart rate and stress',
    )
    expect(describeMetrics(['hr'], 'long')).toBe('heart rate')
  })

  test('adds the extras after the three, in prose case', () => {
    expect(describeMetrics(['hr', 'stress'], 'short', ['Body Battery'])).toBe(
      'heart rate, stress and body battery',
    )
    expect(describeMetrics([], 'short', ['SpO2', 'Respiratory Rate'])).toBe('SpO2 and respiratory rate')
  })
})

describe('proseLabel', () => {
  test('lower-cases plain words and keeps acronyms', () => {
    expect(proseLabel('Body Battery')).toBe('body battery')
    expect(proseLabel('VO2 Max')).toBe('VO2 max')
  })
})

describe('toggleMetric', () => {
  test('removes a shown metric', () => {
    expect(toggleMetric(['hrv', 'hr', 'stress'], 'hr')).toEqual(['hrv', 'stress'])
  })

  test('adds a hidden metric in canonical order', () => {
    expect(toggleMetric(['stress'], 'hrv')).toEqual(['hrv', 'stress'])
  })

  test('keeps the last shown metric', () => {
    expect(toggleMetric(['hr'], 'hr')).toEqual(['hr'])
  })

  test('lets the last of the three go while an extra is shown', () => {
    expect(toggleMetric(['hr'], 'hr', 1)).toEqual([])
  })
})

describe('toggleExtra', () => {
  const available = ['body_battery', 'respiratory_rate', 'spo2']

  test('adds in the order of the available list, unknown ones last', () => {
    expect(toggleExtra(['spo2', 'mood'], 'body_battery', 3, available)).toEqual([
      'body_battery',
      'spo2',
      'mood',
    ])
    expect(orderExtras(['zeta', 'alpha', 'spo2'], available)).toEqual(['spo2', 'alpha', 'zeta'])
  })

  test('removes, but keeps the last shown metric of all', () => {
    expect(toggleExtra(['spo2'], 'spo2', 1, available)).toEqual([])
    expect(toggleExtra(['spo2'], 'spo2', 0, available)).toEqual(['spo2'])
  })
})

describe('extra metric columns', () => {
  const stats = {
    metrics: {
      body_battery: {
        delta_from_baseline: -4.2,
        effect: {
          after_mean: 40,
          before_mean: 50,
          change: -10,
          change_stddev: 2,
          p_value: 0.01,
          paired_occurrences: 5,
        },
        mean: 44.5,
        stddev: 3,
      },
    },
  } as unknown as HrvStatsWithDelta

  test('read the row metrics and fall back to empty', () => {
    const column = extraMetricColumn('body_battery', 'Body Battery')
    expect(column.mean(stats)).toBe(44.5)
    expect(column.delta(stats)).toBe(-4.2)
    expect(column.effect(stats).change).toBe(-10)
    expect(column.direction).toBe('up')

    const missing = extraMetricColumn('spo2', 'SpO2')
    expect(missing.mean(stats)).toBeNull()
    expect(missing.effect(stats).paired_occurrences).toBe(0)
  })

  test('direction is known only for some metrics', () => {
    expect(metricDirection('hrv_sdnn')).toBe('up')
    expect(metricDirection('resting_heart_rate')).toBe('down')
    expect(metricDirection('respiratory_rate')).toBe('neutral')
  })
})

describe('describeProductivityR', () => {
  const coefficients = { heart_rate: -0.05, hrv_rmssd: 0.12, stress_level: 0.2 }

  test('shows r for each shown metric', () => {
    expect(describeProductivityR(coefficients, ['hrv', 'hr', 'stress'])).toBe(
      'r HRV 0.12 · HR −0.05 · Stress 0.20',
    )
    expect(describeProductivityR(coefficients, ['stress'])).toBe('r Stress 0.20')
  })

  test('skips metrics without an r', () => {
    expect(describeProductivityR({ ...coefficients, hrv_rmssd: null }, ['hrv', 'hr'])).toBe('r HR −0.05')
  })

  test('adds the extras that have an r', () => {
    expect(
      describeProductivityR(
        coefficients,
        ['hr'],
        [
          { label: 'Body Battery', r: 0.31 },
          { label: 'SpO2', r: null },
          { label: 'Mood', r: undefined },
        ],
      ),
    ).toBe('r HR −0.05 · Body Battery 0.31')
  })

  test('is undefined when no shown metric has an r', () => {
    expect(
      describeProductivityR({ heart_rate: null, hrv_rmssd: null, stress_level: 0.3 }, ['hrv', 'hr']),
    ).toBeUndefined()
  })
})
