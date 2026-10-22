import { describe, expect, it } from 'vitest'

import {
  barWidth,
  METRIC_CHART_STYLES,
  STRESS_BAND_COLORS,
  stressBand,
  stressBandColor,
} from './stress-bands'

describe('stressBand', () => {
  it('uses Garmin band edges', () => {
    expect([1, 25, 26, 50, 51, 75, 76, 100].map(stressBand)).toEqual([
      'rest',
      'rest',
      'low',
      'low',
      'medium',
      'medium',
      'high',
      'high',
    ])
  })

  it('colours by band', () => {
    expect(stressBandColor(10)).toBe(STRESS_BAND_COLORS.rest)
    expect(stressBandColor(90)).toBe(STRESS_BAND_COLORS.high)
  })
})

describe('METRIC_CHART_STYLES', () => {
  it('draws stress as bars on a fixed 0–100 domain', () => {
    expect(METRIC_CHART_STYLES.stress_level).toMatchObject({ domain: [0, 100], kind: 'bars' })
    expect(METRIC_CHART_STYLES.heart_rate).toBeUndefined()
  })
})

describe('barWidth', () => {
  it('is 80% of the median spacing', () => {
    expect(barWidth([0, 10, 20, 30, 100])).toBe(8)
    expect(barWidth([0, 10, 30])).toBe(12)
  })

  it('is at least 1px', () => {
    expect(barWidth([0, 0.5, 1])).toBe(1)
    expect(barWidth([5])).toBe(1)
    expect(barWidth([])).toBe(1)
  })
})
