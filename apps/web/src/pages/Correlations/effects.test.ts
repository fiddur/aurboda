import { impactEffectSummary } from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import type { WindowEffect } from '../../state/api'

import {
  changeClass,
  changeTitle,
  columnTitles,
  comparisonsNote,
  formatDelta,
  getDeltaClass,
  roundTo,
} from './effects'

const effect = (overrides: Partial<WindowEffect> = {}): WindowEffect => ({
  after_mean: 35.4,
  before_mean: 47,
  change: -11.6,
  change_stddev: 4.2,
  p_value: 0.003,
  paired_occurrences: 41,
  ...overrides,
})

describe('changeClass', () => {
  test('colours a clear change by direction', () => {
    expect(changeClass(effect(), 'down')).toBe('positive')
    expect(changeClass(effect(), 'up')).toBe('negative')
    expect(changeClass(effect({ change: 3 }), 'up')).toBe('positive')
  })

  test('mutes a change that is not statistically clear', () => {
    expect(changeClass(effect({ p_value: 0.2 }), 'down')).toBe('muted')
    expect(changeClass(effect({ p_value: null }), 'down')).toBe('muted')
    expect(changeClass(effect({ p_value: 0.2 }), 'neutral')).toBe('muted')
  })

  test('judges from the adjusted p-value when there is one', () => {
    expect(changeClass(effect({ p_value: 0.01, p_value_adjusted: 0.2 }), 'down')).toBe('muted')
    expect(changeClass(effect({ p_value: 0.01, p_value_adjusted: 0.04 }), 'down')).toBe('positive')
    expect(changeClass(effect({ p_value: null, p_value_adjusted: null }), 'down')).toBe('muted')
  })

  test('shows a clear change plainly when the good direction is unknown', () => {
    expect(changeClass(effect(), 'neutral')).toBe('')
  })

  test('is empty without a change', () => {
    expect(changeClass(effect({ change: null }), 'down')).toBe('')
  })
})

describe('changeTitle', () => {
  test('shows before, after, count and p', () => {
    expect(changeTitle(effect())).toBe('47.0 → 35.4 across 41 occurrences (p = 0.003)')
    expect(changeTitle(effect({ p_value: 0.0001 }))).toBe('47.0 → 35.4 across 41 occurrences (p < 0.001)')
  })

  test('shows the adjusted p beside the raw one', () => {
    expect(changeTitle(effect({ p_value: 0.012, p_value_adjusted: 0.18 }))).toBe(
      '47.0 → 35.4 across 41 occurrences (p = 0.012, adjusted for the comparisons p = 0.180)',
    )
  })

  test('says when there are too few occurrences', () => {
    expect(changeTitle(effect({ p_value: null, paired_occurrences: 2 }))).toBe(
      '47.0 → 35.4 across 2 occurrences (too few occurrences to tell)',
    )
  })

  test('omits p when it is null with enough pairs', () => {
    expect(changeTitle(effect({ p_value: null }))).toBe('47.0 → 35.4 across 41 occurrences')
  })

  test('explains a missing change', () => {
    expect(changeTitle(effect({ change: null, paired_occurrences: 0 }))).toBe(
      'No occurrences with data both before and after',
    )
  })
})

describe('comparisonsNote', () => {
  test('says how many would pass by chance', () => {
    expect(comparisonsNote(24)).toBe(
      '24 comparisons: about one of these would pass p < 0.05 by chance. Results are marked from the p-value adjusted for them (Benjamini–Hochberg).',
    )
    expect(comparisonsNote(60)).toContain('60 comparisons: about 3 of these would pass')
    expect(comparisonsNote(6)).toContain('6 comparisons: fewer than one of these would be expected to pass')
  })

  test('is null with fewer than two comparisons', () => {
    expect(comparisonsNote(1)).toBeNull()
    expect(comparisonsNote(0)).toBeNull()
  })
})

describe('impactEffectSummary', () => {
  test('matches the change cell numbers', () => {
    expect(impactEffectSummary('Stress', effect(), 48)).toBe(
      'Stress 47.0 → 35.4 (−11.6) · 41 of 48 occurrences',
    )
    expect(impactEffectSummary('HRV', effect({ after_mean: 50, before_mean: 45, change: 5 }), 48)).toBe(
      'HRV 45.0 → 50.0 (+5.0) · 41 of 48 occurrences',
    )
  })

  test('is null without paired occurrences', () => {
    expect(impactEffectSummary('HRV', effect({ change: null, paired_occurrences: 0 }), 5)).toBeNull()
  })
})

describe('deltas', () => {
  test('format and colour', () => {
    expect(formatDelta(7, 0)).toBe('+7')
    expect(formatDelta(null, 1)).toBe('--')
    expect(getDeltaClass(7, 'down')).toBe('negative')
    expect(getDeltaClass(7, 'up')).toBe('positive')
    expect(getDeltaClass(7, 'neutral')).toBe('')
    expect(getDeltaClass(0, 'down')).toBe('')
  })
})

describe('columnTitles', () => {
  test('names the window', () => {
    expect(columnTitles(30).change).toContain('The 30 min after minus the 30 min before')
    expect(columnTitles(240).change).toContain('The 4 h after minus the 4 h before')
  })
})

describe('roundTo', () => {
  test('rounds to the shown decimals', () => {
    expect(roundTo(4.26, 1)).toBe(4.3)
    expect(roundTo(-6.5, 0)).toBe(-6)
    expect(roundTo(null, 0)).toBeNull()
  })

  test('a delta that displays as zero is unsigned and uncoloured', () => {
    const rounded = roundTo(-0.4, 0)
    expect(formatDelta(rounded, 0)).toBe('0')
    expect(getDeltaClass(rounded, 'down')).toBe('')
  })
})
