import { describe, expect, test } from 'vitest'

import { dateToTemporalInstant } from './temporal-interop.ts'

describe('dateToTemporalInstant', () => {
  test('preserves the exact epoch milliseconds', () => {
    const date = new Date('2026-07-01T06:30:00.000Z')
    const instant = dateToTemporalInstant(date)
    expect(instant.epochMilliseconds).toBe(date.getTime())
  })

  test('round-trips back to the same ISO instant', () => {
    const date = new Date('2026-07-01T06:30:00.123Z')
    expect(new Date(dateToTemporalInstant(date).toString()).getTime()).toBe(date.getTime())
  })

  test('handles the unix epoch', () => {
    expect(dateToTemporalInstant(new Date(0)).epochMilliseconds).toBe(0)
  })
})
