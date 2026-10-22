import { describe, expect, it } from 'vitest'

import {
  computeSleepMinutesFromStages,
  formatMinutesAsHM,
  parseSleepStages,
  type SleepStage,
} from './sleep-utils'

describe('parseSleepStages', () => {
  it('returns empty array for undefined data', () => {
    expect(parseSleepStages(undefined)).toEqual([])
  })

  it('returns empty array when no stages field', () => {
    expect(parseSleepStages({ foo: 'bar' })).toEqual([])
  })

  it('returns empty array when stages is not an array', () => {
    expect(parseSleepStages({ stages: 'not-array' })).toEqual([])
  })

  it('filters out invalid stage entries', () => {
    const data = {
      stages: [
        { endTime: '2024-01-01T07:00:00Z', stage: 4, startTime: '2024-01-01T06:00:00Z' },
        { endTime: 'bad', stage: 'nope', startTime: 123 }, // invalid
        { stage: 5 }, // missing times
        null,
        { endTime: '2024-01-01T08:00:00Z', stage: 5, startTime: '2024-01-01T07:00:00Z' },
      ],
    }
    const result = parseSleepStages(data)
    expect(result).toHaveLength(2)
    expect(result[0]!.stage).toBe(4)
    expect(result[1]!.stage).toBe(5)
  })

  it('filters out stages with invalid stage numbers', () => {
    const data = {
      stages: [
        { endTime: '2024-01-01T07:00:00Z', stage: 0, startTime: '2024-01-01T06:00:00Z' },
        { endTime: '2024-01-01T08:00:00Z', stage: 7, startTime: '2024-01-01T07:00:00Z' },
        { endTime: '2024-01-01T09:00:00Z', stage: 4, startTime: '2024-01-01T08:00:00Z' },
      ],
    }
    const result = parseSleepStages(data)
    expect(result).toHaveLength(1)
    expect(result[0]!.stage).toBe(4)
  })
})

describe('computeSleepMinutesFromStages', () => {
  it('returns 0 for empty stages', () => {
    expect(computeSleepMinutesFromStages([])).toBe(0)
  })

  it('sums only actual sleep stages (2, 4, 5, 6)', () => {
    const stages: SleepStage[] = [
      { endTime: '2024-01-01T01:00:00Z', stage: 1, startTime: '2024-01-01T00:00:00Z' }, // Awake: 60m, excluded
      { endTime: '2024-01-01T03:00:00Z', stage: 4, startTime: '2024-01-01T01:00:00Z' }, // Light: 120m
      { endTime: '2024-01-01T04:00:00Z', stage: 5, startTime: '2024-01-01T03:00:00Z' }, // Deep: 60m
      { endTime: '2024-01-01T05:00:00Z', stage: 6, startTime: '2024-01-01T04:00:00Z' }, // REM: 60m
      { endTime: '2024-01-01T05:30:00Z', stage: 3, startTime: '2024-01-01T05:00:00Z' }, // Out of bed: 30m, excluded
    ]
    expect(computeSleepMinutesFromStages(stages)).toBe(240) // 120 + 60 + 60
  })

  it('includes stage 2 (Sleeping/Unknown) as sleep', () => {
    const stages: SleepStage[] = [
      { endTime: '2024-01-01T02:00:00Z', stage: 2, startTime: '2024-01-01T01:00:00Z' },
    ]
    expect(computeSleepMinutesFromStages(stages)).toBe(60)
  })
})

describe('formatMinutesAsHM', () => {
  it('formats minutes only when < 60', () => {
    expect(formatMinutesAsHM(45)).toBe('45m')
  })

  it('formats hours only when no remaining minutes', () => {
    expect(formatMinutesAsHM(120)).toBe('2h')
  })

  it('formats hours and minutes', () => {
    expect(formatMinutesAsHM(150)).toBe('2h 30m')
  })

  it('handles 0 minutes', () => {
    expect(formatMinutesAsHM(0)).toBe('0m')
  })
})
