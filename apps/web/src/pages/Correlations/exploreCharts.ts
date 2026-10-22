/**
 * Pure chart helpers for the correlation Explore visualisations — kept free of
 * JSX so the maths (regression, quartiles, axis labelling) is unit-testable.
 */

/**
 * `linearRegression`, `RegressionLine`, and `describeSelectorAxis` moved to
 * `@aurboda/api-spec` (shared single source with the backend scatter renderer)
 * and are re-exported here so existing web imports keep working. This module
 * keeps the web-only `fiveNumberSummary` used by the box-plot render.
 */
export { describeSelectorAxis, linearRegression, type RegressionLine } from '@aurboda/api-spec'

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
