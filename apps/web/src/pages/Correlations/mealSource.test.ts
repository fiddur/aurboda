import type { ActivityImpactData } from '@aurboda/api-spec'

import { describe, expect, test } from 'vitest'

import { comparisonAsGroup, mealsWithLabel, mealsWithoutLabel } from './mealSource'

const effect = {
  after_mean: null,
  before_mean: null,
  change: null,
  change_stddev: null,
  p_value: null,
  paired_occurrences: 0,
}

describe('meal source labels', () => {
  test('name the meals with and without the flag', () => {
    expect(mealsWithLabel('gluten')).toBe('Meals with gluten')
    expect(mealsWithoutLabel('gluten')).toBe('Meals without gluten, on days with a complete meal log')
  })
})

describe('comparisonAsGroup', () => {
  const data = {
    activity: 'gluten',
    activity_type: 'meal_sensitivity',
    avg_duration_min: 5,
  } as ActivityImpactData

  test('is null without a comparison', () => {
    expect(comparisonAsGroup(data)).toBeNull()
  })

  test('labels the comparison for the table', () => {
    const comparison = {
      hr_effect: effect,
      hrv_effect: effect,
      occurrences: 42,
      stress_effect: effect,
      timeline: [],
    }
    expect(comparisonAsGroup({ ...data, comparison })).toEqual({
      ...comparison,
      avg_duration_min: 5,
      key: 'comparison',
      label: 'Meals without gluten, on days with a complete meal log',
    })
  })
})
