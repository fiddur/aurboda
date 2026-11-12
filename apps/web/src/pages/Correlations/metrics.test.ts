import { describe, expect, test } from 'vitest'

import { describeMetrics, describeProductivityR, toggleMetric } from './metrics'

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

  test('is undefined when no shown metric has an r', () => {
    expect(
      describeProductivityR({ heart_rate: null, hrv_rmssd: null, stress_level: 0.3 }, ['hrv', 'hr']),
    ).toBeUndefined()
  })
})
