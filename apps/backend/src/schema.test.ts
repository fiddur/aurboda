import { describe, expect, test } from 'vitest'
import { cumulativeMetrics, isValidMetric, metricUnits, validMetrics } from './schema'

describe('schema', () => {
  describe('cumulativeMetrics', () => {
    test('contains expected metrics for Health Connect aggregation', () => {
      expect(cumulativeMetrics).toContain('steps')
      expect(cumulativeMetrics).toContain('distance')
      expect(cumulativeMetrics).toContain('floors_climbed')
      expect(cumulativeMetrics).toContain('calories_active')
      expect(cumulativeMetrics).toContain('calories_total')
    })

    test('all cumulative metrics are valid metrics', () => {
      for (const metric of cumulativeMetrics) {
        expect(isValidMetric(metric)).toBe(true)
      }
    })

    test('all cumulative metrics have defined units', () => {
      for (const metric of cumulativeMetrics) {
        expect(metricUnits[metric]).toBeDefined()
      }
    })

    test('does not contain non-cumulative metrics', () => {
      // These metrics should not be summed across sources
      expect(cumulativeMetrics).not.toContain('heart_rate')
      expect(cumulativeMetrics).not.toContain('weight')
      expect(cumulativeMetrics).not.toContain('hrv_rmssd')
      expect(cumulativeMetrics).not.toContain('resting_heart_rate')
    })
  })

  describe('isValidMetric', () => {
    test('returns true for valid metrics', () => {
      expect(isValidMetric('heart_rate')).toBe(true)
      expect(isValidMetric('steps')).toBe(true)
      expect(isValidMetric('weight')).toBe(true)
    })

    test('returns false for invalid metrics', () => {
      expect(isValidMetric('invalid')).toBe(false)
      expect(isValidMetric('')).toBe(false)
      expect(isValidMetric('HEART_RATE')).toBe(false) // case sensitive
    })
  })

  describe('metricUnits', () => {
    test('has correct units for cumulative metrics', () => {
      expect(metricUnits.steps).toBe('count')
      expect(metricUnits.distance).toBe('m')
      expect(metricUnits.floors_climbed).toBe('count')
      expect(metricUnits.calories_active).toBe('kcal')
      expect(metricUnits.calories_total).toBe('kcal')
    })
  })

  describe('validMetrics', () => {
    test('contains all expected metrics', () => {
      expect(validMetrics.length).toBeGreaterThan(20)
      expect(validMetrics).toContain('heart_rate')
      expect(validMetrics).toContain('steps')
      expect(validMetrics).toContain('sleep_score')
    })
  })
})
