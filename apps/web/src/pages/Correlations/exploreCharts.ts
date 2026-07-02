/**
 * Pure chart helpers for the correlation Explore visualisations — kept free of
 * JSX so the maths (regression, quartiles, axis labelling) is unit-testable.
 */

import type { CorrelationSelector } from '@aurboda/api-spec'

import { isValidMetric, metricUnits } from '@aurboda/api-spec'

export interface RegressionLine {
  slope: number
  intercept: number
}

/** Ordinary least-squares fit y = slope·x + intercept, or null when undefined. */
export const linearRegression = (xs: number[], ys: number[]): RegressionLine | null => {
  const n = xs.length
  if (n < 2 || xs.length !== ys.length) return null
  let sx = 0
  let sy = 0
  let sxx = 0
  let sxy = 0
  for (let i = 0; i < n; i++) {
    sx += xs[i]
    sy += ys[i]
    sxx += xs[i] * xs[i]
    sxy += xs[i] * ys[i]
  }
  const denom = n * sxx - sx * sx
  if (denom === 0) return null
  const slope = (n * sxy - sx * sy) / denom
  return { slope, intercept: (sy - slope * sx) / n }
}

export interface FiveNumberSummary {
  min: number
  q1: number
  median: number
  q3: number
  max: number
}

/** Five-number summary (min, quartiles, max) with linear interpolation. */
export const fiveNumberSummary = (values: number[]): FiveNumberSummary | null => {
  if (values.length === 0) return null
  const s = [...values].sort((a, b) => a - b)
  const quantile = (p: number): number => {
    if (s.length === 1) return s[0]
    const idx = p * (s.length - 1)
    const lo = Math.floor(idx)
    const hi = Math.ceil(idx)
    return s[lo] + (s[hi] - s[lo]) * (idx - lo)
  }
  return { min: s[0], q1: quantile(0.25), median: quantile(0.5), q3: quantile(0.75), max: s[s.length - 1] }
}

/** Short axis label for a selector, including its unit where known. */
export const describeSelectorAxis = (selector: CorrelationSelector): string => {
  switch (selector.kind) {
    case 'metric': {
      if (!isValidMetric(selector.metric)) return selector.metric || 'metric'
      const unit = metricUnits[selector.metric]
      return unit ? `${selector.metric} (${unit})` : selector.metric
    }
    case 'nutrition':
      return `${selector.nutrient} (${selector.nutrient === 'calories' ? 'kcal' : 'g'})`
    case 'activity':
      return `${selector.pattern || 'activity'} (${selector.measure === 'duration_min' ? 'min' : 'count'})`
    case 'productivity_category':
    case 'productivity_app':
      return `${selector.pattern || 'productivity'} (min)`
    case 'tag':
    default:
      return `${selector.pattern || 'tag'} (count)`
  }
}
