import {
  builtinDashboardMetrics,
  computedMetrics,
  getMetricAggregation,
  isComputedMetric,
  isValidMetric,
  metricBetterDirections,
  metricLabels,
  metricUnits,
  strengthScoreGroups,
  strengthScoreMetricOf,
  strengthScoreMetrics,
} from '@aurboda/api-spec'
import { describe, expect, test } from 'vitest'

import { isHealthConnectSyncableMetric } from './schema-health-connect.ts'

describe('strength score metrics', () => {
  test('are the overall score and one per score group', () => {
    expect(strengthScoreMetrics).toEqual([
      'strength_score',
      ...strengthScoreGroups.map((g) => `strength_score_${g}`),
    ])
    expect(strengthScoreMetricOf()).toBe('strength_score')
    for (const group of strengthScoreGroups) {
      expect(strengthScoreMetricOf(group)).toBe(`strength_score_${group}`)
    }
  })

  test('each is a built-in level metric with a unit, a label, a better direction and a dashboard entry', () => {
    for (const metric of strengthScoreMetrics) {
      expect(isValidMetric(metric)).toBe(true)
      expect(metricUnits[metric]).toBe('points')
      expect(metricLabels[metric]).toMatch(/^Strength Score/)
      expect(metricBetterDirections[metric]).toBe('higher')
      expect(getMetricAggregation(metric)).toBe('avg')
      expect(builtinDashboardMetrics).toContain(metric)
    }
    expect(metricLabels.strength_score_chest).toBe('Strength Score (Chest)')
  })

  test('are computed, and nothing else is', () => {
    expect(computedMetrics).toEqual(strengthScoreMetrics)
    for (const metric of strengthScoreMetrics) expect(isComputedMetric(metric)).toBe(true)
    expect(isComputedMetric('weight')).toBe(false)
    expect(isComputedMetric('training_impulse')).toBe(false)
    expect(isComputedMetric('mood')).toBe(false)
  })

  test('are never synced to Health Connect', () => {
    for (const metric of strengthScoreMetrics) expect(isHealthConnectSyncableMetric(metric)).toBe(false)
  })
})
