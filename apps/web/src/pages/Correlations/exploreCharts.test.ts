import { describe, expect, it } from 'vitest'

import { describeSelectorAxis, fiveNumberSummary, linearRegression } from './exploreCharts'

describe('linearRegression', () => {
  it('fits a clean line', () => {
    const fit = linearRegression([0, 1, 2, 3], [1, 3, 5, 7]) // y = 2x + 1
    expect(fit!.slope).toBeCloseTo(2, 6)
    expect(fit!.intercept).toBeCloseTo(1, 6)
  })

  it('returns null with no x-variance or too few points', () => {
    expect(linearRegression([1, 1, 1], [1, 2, 3])).toBeNull()
    expect(linearRegression([1], [2])).toBeNull()
  })
})

describe('fiveNumberSummary', () => {
  it('computes quartiles with interpolation', () => {
    const s = fiveNumberSummary([1, 2, 3, 4, 5])
    expect(s).toEqual({ min: 1, q1: 2, median: 3, q3: 4, max: 5 })
  })

  it('handles a single value', () => {
    expect(fiveNumberSummary([7])).toEqual({ min: 7, q1: 7, median: 7, q3: 7, max: 7 })
  })

  it('returns null for empty input', () => {
    expect(fiveNumberSummary([])).toBeNull()
  })
})

describe('describeSelectorAxis', () => {
  it('labels built-in metrics with their unit', () => {
    expect(describeSelectorAxis({ kind: 'metric', metric: 'weight' })).toContain('weight')
    expect(describeSelectorAxis({ kind: 'metric', metric: 'weight' })).toMatch(/\(.+\)/)
  })

  it('labels a custom metric without a unit', () => {
    expect(describeSelectorAxis({ kind: 'metric', metric: 'back_pain' })).toBe('back_pain')
  })

  it('uses kcal for calories and g for other nutrients', () => {
    expect(describeSelectorAxis({ kind: 'nutrition', nutrient: 'calories' })).toBe('calories (kcal)')
    expect(describeSelectorAxis({ kind: 'nutrition', nutrient: 'carbs' })).toBe('carbs (g)')
  })

  it('labels tags by count and productivity by minutes', () => {
    expect(describeSelectorAxis({ kind: 'tag', pattern: 'sauna' })).toBe('sauna (count)')
    expect(describeSelectorAxis({ kind: 'productivity_app', pattern: 'vscode' })).toBe('vscode (min)')
  })
})
