import { formatImpactWindow } from '@aurboda/api-spec'

import type { WindowEffect } from '../../state/api'

export const SIGNIFICANCE_LEVEL = 0.05
const MIN_PAIRS_FOR_TEST = 3

/** Which way is good for a metric: up (HRV), down (stress), or neutral when it is not known. */
export type MetricDirection = 'up' | 'down' | 'neutral'

export const getDeltaClass = (value: number | null, direction: MetricDirection): string => {
  if (value === null || value === 0 || direction === 'neutral') return ''
  const isGood = direction === 'down' ? value < 0 : value > 0
  return isGood ? 'positive' : 'negative'
}

/** Rounds to the decimals a cell shows, so a delta that displays as 0 is neither signed nor coloured. */
export const roundTo = (value: number | null, decimals: number): number | null => {
  if (value === null) return null
  const factor = 10 ** decimals
  const rounded = Math.round(value * factor) / factor
  return rounded === 0 ? 0 : rounded
}

export const formatDelta = (value: number | null, decimals: number): string => {
  if (value === null) return '--'
  return `${value > 0 ? '+' : ''}${value.toFixed(decimals)}`
}

const formatMean = (value: number | null): string => (value === null ? '--' : value.toFixed(1))

const decidingP = (effect: WindowEffect): number | null =>
  effect.p_value_adjusted === undefined ? effect.p_value : effect.p_value_adjusted

export const isClearChange = (effect: WindowEffect): boolean => {
  const p = decidingP(effect)
  return p !== null && p < SIGNIFICANCE_LEVEL
}

export const changeClass = (effect: WindowEffect, direction: MetricDirection): string => {
  if (effect.change === null) return ''
  if (!isClearChange(effect)) return 'muted'
  if (direction === 'neutral') return ''
  return getDeltaClass(effect.change, direction) || 'muted'
}

const formatPValue = (p: number): string => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`)

const formatPValues = (effect: WindowEffect): string | null => {
  if (effect.p_value === null) return null
  const raw = formatPValue(effect.p_value)
  return effect.p_value_adjusted === undefined || effect.p_value_adjusted === null
    ? raw
    : `${raw}, adjusted for the comparisons ${formatPValue(effect.p_value_adjusted)}`
}

/** The line under a table of tested changes: how many there are and what that means. */
export const comparisonsNote = (comparisons: number): string | null => {
  if (comparisons < 2) return null
  const expected = Math.round(comparisons * SIGNIFICANCE_LEVEL)
  const chance =
    expected === 0
      ? `fewer than one of these would be expected to pass p < ${SIGNIFICANCE_LEVEL} by chance`
      : `about ${expected === 1 ? 'one' : expected} of these would pass p < ${SIGNIFICANCE_LEVEL} by chance`
  return `${comparisons} comparisons: ${chance}. Results are marked from the p-value adjusted for them (Benjamini–Hochberg).`
}

export const changeTitle = (effect: WindowEffect): string => {
  if (effect.change === null || effect.paired_occurrences === 0) {
    return 'No occurrences with data both before and after'
  }
  const n = effect.paired_occurrences
  const base = `${formatMean(effect.before_mean)} → ${formatMean(effect.after_mean)} across ${n} ${
    n === 1 ? 'occurrence' : 'occurrences'
  }`
  if (n < MIN_PAIRS_FOR_TEST) return `${base} (too few occurrences to tell)`
  const p = formatPValues(effect)
  return p === null ? base : `${base} (${p})`
}

export const columnTitles = (windowMinutes: number) => ({
  change: `The ${formatImpactWindow(windowMinutes)} after minus the ${formatImpactWindow(windowMinutes)} before, for occurrences with data on both sides; coloured when statistically clear`,
  during: 'Average while it was going on, one value per occurrence',
  vs_avg: 'During minus your average over the whole period',
})
