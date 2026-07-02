import { describe, expect, test } from 'vitest'

import { formatCadence, formatDistance, formatPace } from './format-utils'

describe('formatDistance', () => {
  test('formats meters under 1km without decimals', () => {
    expect(formatDistance(850)).toBe('850 m')
    expect(formatDistance(0)).toBe('0 m')
    expect(formatDistance(999)).toBe('999 m')
  })

  test('formats km with two decimals at and above 1000m', () => {
    expect(formatDistance(1000)).toBe('1.00 km')
    expect(formatDistance(3420)).toBe('3.42 km')
    expect(formatDistance(12345)).toBe('12.35 km')
  })
})

describe('formatPace', () => {
  test('returns undefined when no pace and no speed', () => {
    expect(formatPace(undefined)).toBeUndefined()
    expect(formatPace(0)).toBeUndefined()
    expect(formatPace(undefined, 0)).toBeUndefined()
  })

  test('formats seconds-per-km as M:SS /km', () => {
    expect(formatPace(330)).toBe('5:30 /km')
    expect(formatPace(360)).toBe('6:00 /km')
    expect(formatPace(65)).toBe('1:05 /km')
  })

  test('pads seconds with leading zero', () => {
    expect(formatPace(305)).toBe('5:05 /km')
  })

  test('derives pace from speed (m/s) when pace missing', () => {
    // 2.5 m/s => 400 s/km => 6:40 /km
    expect(formatPace(undefined, 2.5)).toBe('6:40 /km')
  })

  test('prefers explicit pace over speed', () => {
    expect(formatPace(330, 2.5)).toBe('5:30 /km')
  })
})

describe('formatCadence', () => {
  test('rounds and appends spm', () => {
    expect(formatCadence(172)).toBe('172 spm')
    expect(formatCadence(171.7)).toBe('172 spm')
  })
})
