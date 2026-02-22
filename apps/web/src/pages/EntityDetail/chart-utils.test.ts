import { describe, expect, test } from 'vitest'
import { findNearest, findStageAtTime } from './chart-utils'

describe('findNearest', () => {
  test('returns undefined for empty data', () => {
    expect(findNearest([], new Date('2024-01-15T10:00:00Z'))).toBeUndefined()
  })

  test('returns single element for single-element array', () => {
    const data: [Date, number][] = [[new Date('2024-01-15T10:00:00Z'), 72]]
    expect(findNearest(data, new Date('2024-01-15T12:00:00Z'))).toEqual(data[0])
  })

  test('returns exact match', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 70],
      [new Date('2024-01-15T10:05:00Z'), 72],
      [new Date('2024-01-15T10:10:00Z'), 68],
    ]
    expect(findNearest(data, new Date('2024-01-15T10:05:00Z'))).toEqual(data[1])
  })

  test('returns closest point when between two points', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 70],
      [new Date('2024-01-15T10:10:00Z'), 72],
    ]
    // 10:03 is closer to 10:00
    expect(findNearest(data, new Date('2024-01-15T10:03:00Z'))).toEqual(data[0])
    // 10:08 is closer to 10:10
    expect(findNearest(data, new Date('2024-01-15T10:08:00Z'))).toEqual(data[1])
  })

  test('returns first point when target is before all data', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 70],
      [new Date('2024-01-15T10:10:00Z'), 72],
    ]
    expect(findNearest(data, new Date('2024-01-15T09:00:00Z'))).toEqual(data[0])
  })

  test('returns last point when target is after all data', () => {
    const data: [Date, number][] = [
      [new Date('2024-01-15T10:00:00Z'), 70],
      [new Date('2024-01-15T10:10:00Z'), 72],
    ]
    expect(findNearest(data, new Date('2024-01-15T11:00:00Z'))).toEqual(data[1])
  })

  test('handles large dataset with binary search', () => {
    const data: [Date, number][] = Array.from({ length: 1000 }, (_, i) => [
      new Date(new Date('2024-01-15T00:00:00Z').getTime() + i * 60000),
      60 + Math.sin(i) * 10,
    ])
    // Target at 500 minutes in
    const target = new Date(new Date('2024-01-15T00:00:00Z').getTime() + 500 * 60000)
    const result = findNearest(data, target)
    expect(result).toEqual(data[500])
  })
})

describe('findStageAtTime', () => {
  const stages = [
    { endTime: '2024-01-15T00:30:00Z', stage: 4, startTime: '2024-01-15T00:00:00Z' },
    { endTime: '2024-01-15T01:00:00Z', stage: 5, startTime: '2024-01-15T00:30:00Z' },
    { endTime: '2024-01-15T01:30:00Z', stage: 6, startTime: '2024-01-15T01:00:00Z' },
    { endTime: '2024-01-15T01:35:00Z', stage: 1, startTime: '2024-01-15T01:30:00Z' },
  ]

  test('returns correct stage label when time falls within a stage', () => {
    expect(findStageAtTime(stages, new Date('2024-01-15T00:15:00Z'))).toBe('Light')
    expect(findStageAtTime(stages, new Date('2024-01-15T00:45:00Z'))).toBe('Deep')
    expect(findStageAtTime(stages, new Date('2024-01-15T01:15:00Z'))).toBe('REM')
    expect(findStageAtTime(stages, new Date('2024-01-15T01:32:00Z'))).toBe('Awake')
  })

  test('returns undefined when time is outside all stages', () => {
    expect(findStageAtTime(stages, new Date('2024-01-14T23:00:00Z'))).toBeUndefined()
    expect(findStageAtTime(stages, new Date('2024-01-15T02:00:00Z'))).toBeUndefined()
  })

  test('returns stage at exact start boundary (inclusive)', () => {
    expect(findStageAtTime(stages, new Date('2024-01-15T00:00:00Z'))).toBe('Light')
  })

  test('returns undefined at exact end boundary (exclusive)', () => {
    // End of last stage should not match
    expect(findStageAtTime(stages, new Date('2024-01-15T01:35:00Z'))).toBeUndefined()
  })

  test('returns undefined for empty stages', () => {
    expect(findStageAtTime([], new Date('2024-01-15T00:15:00Z'))).toBeUndefined()
  })
})
