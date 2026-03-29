import { describe, expect, test } from 'vitest'

import { convertTimestamps, dateOnlyToRange, formatInTz } from './tz-utils.ts'

describe('formatInTz', () => {
  test('converts UTC to CET (winter)', () => {
    const date = new Date('2024-01-15T14:30:00Z')
    const result = formatInTz(date, 'Europe/Stockholm')
    expect(result).toBe('2024-01-15T15:30:00+01:00')
  })

  test('converts UTC to CEST (summer)', () => {
    const date = new Date('2024-07-15T14:30:00Z')
    const result = formatInTz(date, 'Europe/Stockholm')
    expect(result).toBe('2024-07-15T16:30:00+02:00')
  })

  test('handles UTC timezone', () => {
    const date = new Date('2024-01-15T14:30:00Z')
    const result = formatInTz(date, 'UTC')
    expect(result).toBe('2024-01-15T14:30:00+00:00')
  })

  test('handles midnight boundary crossing', () => {
    // 23:30 UTC = 00:30 next day in CET
    const date = new Date('2024-01-15T23:30:00Z')
    const result = formatInTz(date, 'Europe/Stockholm')
    expect(result).toBe('2024-01-16T00:30:00+01:00')
  })

  test('handles DST transition day (spring forward)', () => {
    // 2024-03-31 is CET→CEST transition for Europe/Stockholm
    // At 02:00 CET, clocks jump to 03:00 CEST
    const beforeTransition = new Date('2024-03-31T00:30:00Z') // 01:30 CET
    expect(formatInTz(beforeTransition, 'Europe/Stockholm')).toBe('2024-03-31T01:30:00+01:00')

    const afterTransition = new Date('2024-03-31T01:30:00Z') // 03:30 CEST
    expect(formatInTz(afterTransition, 'Europe/Stockholm')).toBe('2024-03-31T03:30:00+02:00')
  })
})

describe('dateOnlyToRange', () => {
  test('returns full day in CET (winter)', () => {
    const { start, end } = dateOnlyToRange('2024-01-15', 'Europe/Stockholm')
    // CET is UTC+1, so day starts at 23:00 UTC previous day
    expect(start.toISOString()).toBe('2024-01-14T23:00:00.000Z')
    expect(end.toISOString()).toBe('2024-01-15T22:59:59.999Z')
  })

  test('returns full day in CEST (summer)', () => {
    const { start, end } = dateOnlyToRange('2024-07-15', 'Europe/Stockholm')
    // CEST is UTC+2, so day starts at 22:00 UTC previous day
    expect(start.toISOString()).toBe('2024-07-14T22:00:00.000Z')
    expect(end.toISOString()).toBe('2024-07-15T21:59:59.999Z')
  })

  test('returns full day in UTC', () => {
    const { start, end } = dateOnlyToRange('2024-01-15', 'UTC')
    expect(start.toISOString()).toBe('2024-01-15T00:00:00.000Z')
    expect(end.toISOString()).toBe('2024-01-15T23:59:59.999Z')
  })

  test('handles DST transition day (spring forward = 23h day)', () => {
    // 2024-03-31: CET→CEST transition, day is only 23 hours
    const { start, end } = dateOnlyToRange('2024-03-31', 'Europe/Stockholm')
    expect(start.toISOString()).toBe('2024-03-30T23:00:00.000Z') // midnight CET = 23:00 UTC
    expect(end.toISOString()).toBe('2024-03-31T21:59:59.999Z') // midnight CEST = 22:00 UTC, minus 1ms
  })
})

describe('convertTimestamps', () => {
  test('converts ISO datetime strings', () => {
    const data = { start_time: '2024-01-15T14:30:00.000Z', tag: 'coffee' }
    const result = convertTimestamps(data, 'Europe/Stockholm')
    expect(result).toEqual({ start_time: '2024-01-15T15:30:00+01:00', tag: 'coffee' })
  })

  test('converts Date objects', () => {
    const data = { time: new Date('2024-01-15T14:30:00Z') }
    const result = convertTimestamps(data, 'Europe/Stockholm')
    expect(result).toEqual({ time: '2024-01-15T15:30:00+01:00' })
  })

  test('skips date-only fields', () => {
    const data = {
      birth_date: '1990-01-15',
      date: '2024-01-15',
      sleep_date: '2024-01-15',
      start_time: '2024-01-15T14:30:00Z',
    }
    const result = convertTimestamps(data, 'Europe/Stockholm')
    expect(result).toEqual({
      birth_date: '1990-01-15',
      date: '2024-01-15',
      sleep_date: '2024-01-15',
      start_time: '2024-01-15T15:30:00+01:00',
    })
  })

  test('handles nested objects', () => {
    const data = {
      data: [{ end_time: '2024-01-15T16:00:00Z', start_time: '2024-01-15T14:30:00Z' }],
      success: true,
    }
    const result = convertTimestamps(data, 'Europe/Stockholm')
    expect(result).toEqual({
      data: [{ end_time: '2024-01-15T17:00:00+01:00', start_time: '2024-01-15T15:30:00+01:00' }],
      success: true,
    })
  })

  test('handles null and undefined', () => {
    expect(convertTimestamps(null, 'Europe/Stockholm')).toBeNull()
    expect(convertTimestamps(undefined, 'Europe/Stockholm')).toBeUndefined()
  })

  test('passes through non-datetime strings', () => {
    const data = { name: 'coffee', type: 'exercise' }
    expect(convertTimestamps(data, 'Europe/Stockholm')).toEqual(data)
  })

  test('handles arrays of timestamps', () => {
    const data = ['2024-01-15T14:30:00Z', '2024-01-15T15:00:00Z']
    const result = convertTimestamps(data, 'Europe/Stockholm')
    expect(result).toEqual(['2024-01-15T15:30:00+01:00', '2024-01-15T16:00:00+01:00'])
  })
})
