import { describe, expect, test } from 'vitest'

import { bucketLabel, formatWindow, isLongWindow } from './window'

describe('formatWindow', () => {
  test('hours when whole, minutes otherwise', () => {
    expect(formatWindow(30)).toBe('30 min')
    expect(formatWindow(60)).toBe('1 h')
    expect(formatWindow(90)).toBe('90 min')
    expect(formatWindow(240)).toBe('4 h')
    expect(formatWindow(1440)).toBe('24 h')
  })
})

describe('bucketLabel', () => {
  test('a before bucket is labelled by its start, an after bucket by its end', () => {
    expect(bucketLabel({ end_offset_minutes: -180, phase: 'before', start_offset_minutes: -240 })).toBe(
      '-4 h',
    )
    expect(bucketLabel({ end_offset_minutes: 0, phase: 'before', start_offset_minutes: -15 })).toBe('-15 min')
    expect(bucketLabel({ end_offset_minutes: 0, phase: 'during', start_offset_minutes: 0 })).toBe('During')
    expect(bucketLabel({ end_offset_minutes: 60, phase: 'after', start_offset_minutes: 0 })).toBe('+1 h')
    expect(bucketLabel({ end_offset_minutes: 30, phase: 'after', start_offset_minutes: 15 })).toBe('+30 min')
  })
})

describe('isLongWindow', () => {
  test('from two hours', () => {
    expect(isLongWindow(60)).toBe(false)
    expect(isLongWindow(120)).toBe(true)
  })
})
