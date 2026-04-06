import { describe, expect, test } from 'vitest'

import { computeSleepMinutes } from './sleep-duration.ts'

describe('computeSleepMinutes', () => {
  test('returns undefined when data is undefined', () => {
    expect(computeSleepMinutes(undefined)).toBeUndefined()
  })

  test('returns undefined when data has no stage info', () => {
    expect(computeSleepMinutes({ some_field: 'value' })).toBeUndefined()
  })

  test('returns undefined when stages is not an array', () => {
    expect(computeSleepMinutes({ stages: 'not-an-array' })).toBeUndefined()
  })

  test('returns undefined when stages is empty', () => {
    expect(computeSleepMinutes({ stages: [] })).toBeUndefined()
  })

  describe('Health Connect stages format', () => {
    // Stage values: 1=Awake, 2=Sleeping, 3=Out of bed, 4=Light, 5=Deep, 6=REM

    test('sums only sleep stages (2, 4, 5, 6), excluding awake (1) and out of bed (3)', () => {
      const data = {
        stages: [
          { endTime: '2025-01-21T00:30:00Z', stage: 1, startTime: '2025-01-21T00:00:00Z' }, // 30m awake
          { endTime: '2025-01-21T02:30:00Z', stage: 4, startTime: '2025-01-21T00:30:00Z' }, // 120m light
          { endTime: '2025-01-21T03:30:00Z', stage: 5, startTime: '2025-01-21T02:30:00Z' }, // 60m deep
          { endTime: '2025-01-21T04:00:00Z', stage: 1, startTime: '2025-01-21T03:30:00Z' }, // 30m awake
          { endTime: '2025-01-21T05:00:00Z', stage: 6, startTime: '2025-01-21T04:00:00Z' }, // 60m REM
          { endTime: '2025-01-21T06:00:00Z', stage: 2, startTime: '2025-01-21T05:00:00Z' }, // 60m sleeping
        ],
      }
      // Total sleep: 120 + 60 + 60 + 60 = 300 minutes
      expect(computeSleepMinutes(data)).toBe(300)
    })

    test('returns undefined when all stages are awake', () => {
      const data = {
        stages: [
          { endTime: '2025-01-21T01:00:00Z', stage: 1, startTime: '2025-01-21T00:00:00Z' },
          { endTime: '2025-01-21T02:00:00Z', stage: 3, startTime: '2025-01-21T01:00:00Z' },
        ],
      }
      expect(computeSleepMinutes(data)).toBeUndefined()
    })

    test('handles stages with only deep and REM', () => {
      const data = {
        stages: [
          { endTime: '2025-01-21T02:00:00Z', stage: 5, startTime: '2025-01-21T00:00:00Z' }, // 120m deep
          { endTime: '2025-01-21T03:30:00Z', stage: 6, startTime: '2025-01-21T02:00:00Z' }, // 90m REM
        ],
      }
      expect(computeSleepMinutes(data)).toBe(210)
    })

    test('skips stages with missing or invalid fields', () => {
      const data = {
        stages: [
          { endTime: '2025-01-21T02:00:00Z', stage: 4, startTime: '2025-01-21T00:00:00Z' }, // 120m light
          { stage: 5, startTime: '2025-01-21T02:00:00Z' }, // missing endTime
          { endTime: '2025-01-21T04:00:00Z', stage: 6 }, // missing startTime
          { endTime: '2025-01-21T05:00:00Z', startTime: '2025-01-21T04:00:00Z' }, // missing stage
        ],
      }
      expect(computeSleepMinutes(data)).toBe(120)
    })

    test('rounds to nearest minute', () => {
      const data = {
        stages: [
          // 90.5 minutes (90 min + 30 sec)
          { endTime: '2025-01-21T01:30:30Z', stage: 4, startTime: '2025-01-21T00:00:00Z' },
        ],
      }
      expect(computeSleepMinutes(data)).toBe(91)
    })
  })

  describe('Oura total_sleep_duration format', () => {
    test('converts seconds to minutes', () => {
      const data = { total_sleep_duration: 21600 } // 360 minutes = 6 hours
      expect(computeSleepMinutes(data)).toBe(360)
    })

    test('rounds to nearest minute', () => {
      const data = { total_sleep_duration: 21630 } // 360.5 minutes
      expect(computeSleepMinutes(data)).toBe(361)
    })

    test('returns undefined for zero duration', () => {
      const data = { total_sleep_duration: 0 }
      expect(computeSleepMinutes(data)).toBeUndefined()
    })
  })

  describe('priority', () => {
    test('prefers Health Connect stages over Oura total_sleep_duration', () => {
      const data = {
        stages: [
          { endTime: '2025-01-21T02:00:00Z', stage: 5, startTime: '2025-01-21T00:00:00Z' }, // 120m deep
        ],
        total_sleep_duration: 21600, // 360 minutes
      }
      expect(computeSleepMinutes(data)).toBe(120)
    })
  })
})
