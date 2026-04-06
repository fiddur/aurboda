import { describe, expect, test } from 'vitest'

import type { HrZoneThresholds, PeriodMetricStats } from '../state/api'

import {
  defaultHrZoneThresholds,
  findMetricTimeSeconds,
  formatBpmRange,
  formatZoneTime,
  getWeekDateRange,
  hrZoneColors,
  hrZoneWeeklyTargetMinutes,
} from './hrZones'

describe('formatZoneTime', () => {
  test('formats minutes correctly', () => {
    expect(formatZoneTime(300)).toBe('5 min')
    expect(formatZoneTime(1800)).toBe('30 min')
    expect(formatZoneTime(0)).toBe('0 min')
  })

  test('formats hours and minutes', () => {
    expect(formatZoneTime(3600)).toBe('1 h')
    expect(formatZoneTime(5400)).toBe('1 h 30 min')
    expect(formatZoneTime(8100)).toBe('2 h 15 min')
  })

  test('handles fractional seconds by flooring', () => {
    expect(formatZoneTime(89)).toBe('1 min') // 89 seconds = 1 min
    expect(formatZoneTime(119)).toBe('1 min') // 119 seconds = 1 min
    expect(formatZoneTime(120)).toBe('2 min') // 120 seconds = 2 min
  })

  test('handles large values', () => {
    expect(formatZoneTime(36000)).toBe('10 h') // 600 min = 10 hours
    expect(formatZoneTime(12300)).toBe('3 h 25 min') // 205 min
  })
})

describe('formatBpmRange', () => {
  test('formats zone 0 correctly', () => {
    expect(formatBpmRange(0, defaultHrZoneThresholds)).toBe('< 86 bpm')
  })

  test('formats zone 5 correctly', () => {
    expect(formatBpmRange(5, defaultHrZoneThresholds)).toBe('151+ bpm')
  })

  test('formats middle zones correctly', () => {
    expect(formatBpmRange(1, defaultHrZoneThresholds)).toBe('86 - 101 bpm')
    expect(formatBpmRange(2, defaultHrZoneThresholds)).toBe('102 - 117 bpm')
    expect(formatBpmRange(3, defaultHrZoneThresholds)).toBe('118 - 134 bpm')
    expect(formatBpmRange(4, defaultHrZoneThresholds)).toBe('135 - 150 bpm')
  })

  test('uses custom thresholds', () => {
    const customThresholds: HrZoneThresholds = {
      1: 100,
      2: 120,
      3: 140,
      4: 160,
      5: 180,
    }
    expect(formatBpmRange(0, customThresholds)).toBe('< 100 bpm')
    expect(formatBpmRange(2, customThresholds)).toBe('120 - 139 bpm')
    expect(formatBpmRange(5, customThresholds)).toBe('180+ bpm')
  })
})

describe('findMetricTimeSeconds', () => {
  test('returns time for existing metric', () => {
    const metrics = [
      { avg: 1000, metric: 'hr_zone_0_sec', unit: 'sec' },
      { avg: 2000, metric: 'hr_zone_1_sec', unit: 'sec' },
      { avg: 3000, metric: 'hr_zone_2_sec', unit: 'sec' },
    ] as PeriodMetricStats[]

    expect(findMetricTimeSeconds(metrics, 'hr_zone_1_sec')).toBe(2000)
  })

  test('returns 0 for missing metric', () => {
    const metrics = [{ avg: 1000, metric: 'hr_zone_0_sec', unit: 'sec' }] as PeriodMetricStats[]

    expect(findMetricTimeSeconds(metrics, 'hr_zone_5_sec')).toBe(0)
  })

  test('returns 0 when avg is undefined', () => {
    const metrics = [{ metric: 'hr_zone_0_sec', unit: 'sec' }] as PeriodMetricStats[]

    expect(findMetricTimeSeconds(metrics, 'hr_zone_0_sec')).toBe(0)
  })

  test('returns 0 for empty metrics array', () => {
    expect(findMetricTimeSeconds([], 'hr_zone_0_sec')).toBe(0)
  })

  test('handles decimal values', () => {
    const metrics = [{ avg: 2498.28, metric: 'hr_zone_1_sec', unit: 'sec' }] as PeriodMetricStats[]

    expect(findMetricTimeSeconds(metrics, 'hr_zone_1_sec')).toBe(2498.28)
  })
})

describe('getWeekDateRange', () => {
  test('returns start and end as ISO strings', () => {
    const range = getWeekDateRange()

    expect(typeof range.start).toBe('string')
    expect(typeof range.end).toBe('string')
    expect(range.start).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(range.end).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })

  test('start is before end', () => {
    const range = getWeekDateRange()
    const start = new Date(range.start)
    const end = new Date(range.end)

    expect(start.getTime()).toBeLessThan(end.getTime())
  })

  test('range spans approximately 7 days', () => {
    const range = getWeekDateRange()
    const start = new Date(range.start)
    const end = new Date(range.end)
    const diffMs = end.getTime() - start.getTime()
    const diffDays = diffMs / (1000 * 60 * 60 * 24)

    // Should be close to 7 days (6 days + ~1 day from start of day to end of day)
    expect(diffDays).toBeGreaterThanOrEqual(6)
    expect(diffDays).toBeLessThanOrEqual(7)
  })

  test('returns consistent values when called multiple times', () => {
    const range1 = getWeekDateRange()
    const range2 = getWeekDateRange()

    // Same day calls should return same values
    expect(range1.start).toBe(range2.start)
    expect(range1.end).toBe(range2.end)
  })
})

describe('constants', () => {
  test('defaultHrZoneThresholds has correct structure', () => {
    expect(defaultHrZoneThresholds).toEqual({
      1: 86,
      2: 102,
      3: 118,
      4: 135,
      5: 151,
    })
  })

  test('hrZoneWeeklyTargetMinutes has 6 zones', () => {
    expect(hrZoneWeeklyTargetMinutes).toHaveLength(6)
    expect(hrZoneWeeklyTargetMinutes[0]).toBe(0) // Zone 0 no target
    expect(hrZoneWeeklyTargetMinutes[2]).toBe(200) // Zone 2 target
    expect(hrZoneWeeklyTargetMinutes[5]).toBe(10) // Zone 5 target
  })

  test('hrZoneColors has 6 colors', () => {
    expect(hrZoneColors).toHaveLength(6)
    hrZoneColors.forEach((color) => {
      expect(color).toMatch(/^#[0-9A-Fa-f]{6}$/)
    })
  })
})
