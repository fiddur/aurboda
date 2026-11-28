import { describe, expect, test } from 'vitest'

import { allTimeBucket } from './allTime'

describe('allTimeBucket', () => {
  test('a bucket under a day widens to a month', () => {
    expect(allTimeBucket('1m')).toBe('1M')
    expect(allTimeBucket('15m')).toBe('1M')
    expect(allTimeBucket('1h')).toBe('1M')
  })

  test('a day or longer stays', () => {
    expect(allTimeBucket('1d')).toBe('1d')
    expect(allTimeBucket('1w')).toBe('1w')
    expect(allTimeBucket('1M')).toBe('1M')
  })
})
