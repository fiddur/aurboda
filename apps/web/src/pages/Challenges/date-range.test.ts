import { describe, expect, test } from 'vitest'

import {
  dateToEndIso,
  dateToStartIso,
  defaultWeekRange,
  thisMonthRange,
  thisWeekRange,
  toDateInput,
} from './date-range'

// Midday construction avoids date rollover regardless of the runner's timezone.
const at = (iso: string) => new Date(iso)

describe('date-range', () => {
  test('toDateInput formats local calendar day', () => {
    expect(toDateInput(at('2026-06-03T12:00:00'))).toBe('2026-06-03')
    expect(toDateInput(at('2026-01-09T12:00:00'))).toBe('2026-01-09')
  })

  test('end is exactly one day after start (exclusive end), tz-independent', () => {
    const start = new Date(dateToStartIso('2026-06-01'))
    const end = new Date(dateToEndIso('2026-06-01'))
    expect(end.getTime() - start.getTime()).toBe(24 * 60 * 60 * 1000)
  })

  test('defaultWeekRange spans 7 days', () => {
    expect(defaultWeekRange(at('2026-06-01T12:00:00'))).toEqual({ end: '2026-06-07', start: '2026-06-01' })
  })

  test('thisWeekRange is the Monday–Sunday week', () => {
    // 2026-06-03 is a Wednesday.
    expect(thisWeekRange(at('2026-06-03T12:00:00'))).toEqual({ end: '2026-06-07', start: '2026-06-01' })
    // A Sunday stays within its own week (Mon 2026-06-01 .. Sun 2026-06-07).
    expect(thisWeekRange(at('2026-06-07T12:00:00'))).toEqual({ end: '2026-06-07', start: '2026-06-01' })
  })

  test('thisMonthRange covers the whole calendar month', () => {
    expect(thisMonthRange(at('2026-06-15T12:00:00'))).toEqual({ end: '2026-06-30', start: '2026-06-01' })
    expect(thisMonthRange(at('2026-02-10T12:00:00'))).toEqual({ end: '2026-02-28', start: '2026-02-01' })
  })
})
