import { formatImpactWindow } from '@aurboda/api-spec'

import type { WindowEffect } from '../../state/api'

export const SIGNIFICANCE_LEVEL = 0.05
const MIN_PAIRS_FOR_TEST = 3

export const getDeltaClass = (value: number | null, inverted: boolean): string => {
  if (value === null || value === 0) return ''
  const isGood = inverted ? value < 0 : value > 0
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

export const isClearChange = (effect: WindowEffect): boolean =>
  effect.p_value !== null && effect.p_value < SIGNIFICANCE_LEVEL

export const changeClass = (effect: WindowEffect, inverted: boolean): string => {
  if (effect.change === null) return ''
  if (!isClearChange(effect)) return 'muted'
  return getDeltaClass(effect.change, inverted) || 'muted'
}

const formatPValue = (p: number): string => (p < 0.001 ? 'p < 0.001' : `p = ${p.toFixed(3)}`)

export const changeTitle = (effect: WindowEffect): string => {
  if (effect.change === null || effect.paired_occurrences === 0) {
    return 'No occurrences with data both before and after'
  }
  const n = effect.paired_occurrences
  const base = `${formatMean(effect.before_mean)} → ${formatMean(effect.after_mean)} across ${n} ${
    n === 1 ? 'occurrence' : 'occurrences'
  }`
  if (n < MIN_PAIRS_FOR_TEST) return `${base} (too few occurrences to tell)`
  return effect.p_value === null ? base : `${base} (${formatPValue(effect.p_value)})`
}

export const columnTitles = (windowMinutes: number) => ({
  change: `The ${formatImpactWindow(windowMinutes)} after minus the ${formatImpactWindow(windowMinutes)} before, for occurrences with data on both sides; coloured when statistically clear`,
  during: 'Average while it was going on, one value per occurrence',
  vs_avg: 'During minus your average over the whole period',
})
