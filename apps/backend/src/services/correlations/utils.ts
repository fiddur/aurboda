/**
 * Statistical helper functions for correlation analysis.
 */

import type { HrvStats, HrvStatsWithDelta } from './types.ts'

import { chiSquared2x2, chiSquaredPValue1df } from './stats.ts'

/**
 * Calculate mean of an array of numbers.
 */
export const mean = (values: number[]): number | null => {
  if (values.length === 0) return null
  return values.reduce((a, b) => a + b, 0) / values.length
}

/**
 * Calculate standard deviation of an array of numbers.
 */
export const stddev = (values: number[]): number | null => {
  if (values.length < 2) return null
  const avg = mean(values)!
  const squareDiffs = values.map((v) => (v - avg) ** 2)
  return Math.sqrt(squareDiffs.reduce((a, b) => a + b, 0) / (values.length - 1))
}

/**
 * Calculate Pearson correlation coefficient between two arrays.
 */
export const pearsonCorrelation = (x: number[], y: number[]): number | null => {
  if (x.length !== y.length || x.length < 3) return null

  const n = x.length
  const meanX = mean(x)!
  const meanY = mean(y)!

  let numerator = 0
  let denomX = 0
  let denomY = 0

  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX
    const dy = y[i] - meanY
    numerator += dx * dy
    denomX += dx * dx
    denomY += dy * dy
  }

  const denominator = Math.sqrt(denomX * denomY)
  if (denominator === 0) return null

  return numerator / denominator
}

/**
 * Calculate chi-squared statistic and approximate p-value for 2x2 contingency table.
 */
export const chiSquaredTest = (
  observed: [[number, number], [number, number]],
): { chiSquared: number; pValue: number } | null => {
  const [[a, b], [c, d]] = observed
  const chiSquared = chiSquared2x2({ a, b, c, d })
  if (chiSquared === null) return null

  // Exact two-sided p-value for the chi-squared distribution with 1 df.
  return { chiSquared, pValue: chiSquaredPValue1df(chiSquared) }
}

/**
 * Get HRV/HR data points that fall within a time range.
 * Uses binary search since data is sorted by time (from SQL ORDER BY).
 */
export const getDataInRange = (data: [Date, number][], start: Date, end: Date): number[] => {
  const startMs = start.getTime()
  const endMs = end.getTime()

  // Binary search for first index where time >= start
  let lo = 0
  let hi = data.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (data[mid][0].getTime() < startMs) lo = mid + 1
    else hi = mid
  }
  const startIdx = lo

  // Binary search for first index where time > end
  hi = data.length
  while (lo < hi) {
    const mid = (lo + hi) >>> 1
    if (data[mid][0].getTime() <= endMs) lo = mid + 1
    else hi = mid
  }

  return data.slice(startIdx, lo).map(([, v]) => v)
}

/**
 * Calculate HRV stats from raw data arrays.
 */
export const calculateHrvStats = (
  hrvValues: number[],
  hrValues: number[],
  durationMinutes: number,
  stressValues: number[] = [],
): HrvStats => ({
  mean_hr: mean(hrValues),
  mean_hrv: mean(hrvValues),
  mean_stress: stressValues.length > 0 ? mean(stressValues) : null,
  sample_count: hrvValues.length,
  sample_minutes: Math.round(durationMinutes),
  stddev_hr: stddev(hrValues),
  stddev_hrv: stddev(hrvValues),
  stddev_stress: stressValues.length > 0 ? stddev(stressValues) : null,
})

/**
 * Add baseline delta to HRV stats.
 */
export const addBaselineDelta = (stats: HrvStats, baseline: HrvStats): HrvStatsWithDelta => ({
  ...stats,
  hr_delta_from_baseline:
    stats.mean_hr !== null && baseline.mean_hr !== null
      ? Math.round((stats.mean_hr - baseline.mean_hr) * 10) / 10
      : null,
  hrv_delta_from_baseline:
    stats.mean_hrv !== null && baseline.mean_hrv !== null
      ? Math.round((stats.mean_hrv - baseline.mean_hrv) * 10) / 10
      : null,
  stress_delta_from_baseline:
    stats.mean_stress !== null && baseline.mean_stress !== null
      ? Math.round((stats.mean_stress - baseline.mean_stress) * 10) / 10
      : null,
})
