import { describe, expect, it } from 'vitest'

import {
  describeCompleteness,
  describeSelectorAxis,
  fiveNumberSummary,
  linearRegression,
  selectorAxisLabel,
} from './exploreCharts'

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
    expect(describeSelectorAxis({ kind: 'metric', metric: 'headache' })).toBe('headache')
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

describe('selectorAxisLabel', () => {
  const selectors = { sensitivities: [{ label: 'gluten', value: 'flag-1' }] }

  it('names a sensitivity selector by its flag', () => {
    expect(selectorAxisLabel({ flag: 'flag-1', kind: 'sensitivity' }, selectors)).toBe(
      'Meals with gluten (count)',
    )
  })

  it('falls back when the flag is unknown or the selectors are not loaded', () => {
    expect(selectorAxisLabel({ flag: 'flag-2', kind: 'sensitivity' }, selectors)).toBe(
      'Meals with a sensitivity flag (count)',
    )
    expect(selectorAxisLabel({ flag: 'flag-1', kind: 'sensitivity' }, undefined)).toBe(
      'Meals with a sensitivity flag (count)',
    )
  })

  it('leaves other kinds as describeSelectorAxis labels them', () => {
    expect(selectorAxisLabel({ kind: 'nutrition', nutrient: 'carbs' }, selectors)).toBe('carbs (g)')
  })
})

describe('describeCompleteness', () => {
  const flag = { flag: 'flag-1', kind: 'sensitivity' } as const
  const sleep = { kind: 'metric', metric: 'sleep_score' } as const

  it('speaks of nutrition when a side is nutrition, else of the meal log', () => {
    expect(describeCompleteness(4, { kind: 'nutrition', nutrient: 'carbs' }, flag)).toBe(
      '4 with full nutrition',
    )
    expect(describeCompleteness(4, flag, sleep)).toBe('4 on days with a complete meal log')
    expect(describeCompleteness(null, flag, sleep)).toBeNull()
  })
})
