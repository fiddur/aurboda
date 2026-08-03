import { describe, expect, test } from 'vitest'

import { gpsPrecedenceSpan } from './gps-precedence.ts'

const at = (iso: string) => new Date(iso)

describe('gpsPrecedenceSpan', () => {
  const gpsPoints = [
    { time: at('2025-01-15T07:05:00.000Z') },
    { time: at('2025-01-15T07:20:00.000Z') },
    { time: at('2025-01-15T07:35:00.000Z') },
  ]

  test('widens the track range out to the full activity span', () => {
    const span = gpsPrecedenceSpan(gpsPoints, {
      end: at('2025-01-15T07:45:00.000Z'),
      start: at('2025-01-15T07:00:00.000Z'),
    })

    expect(span.start).toEqual(at('2025-01-15T07:00:00.000Z'))
    expect(span.end).toEqual(at('2025-01-15T07:45:00.000Z'))
  })

  test('keeps track points that fall outside the activity span', () => {
    const span = gpsPrecedenceSpan(gpsPoints, {
      end: at('2025-01-15T07:30:00.000Z'),
      start: at('2025-01-15T07:10:00.000Z'),
    })

    expect(span.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span.end).toEqual(at('2025-01-15T07:35:00.000Z'))
  })

  test('falls back to the track range when the span is unknown', () => {
    for (const noSpan of [undefined, null]) {
      const span = gpsPrecedenceSpan(gpsPoints, noSpan)
      expect(span.start).toEqual(at('2025-01-15T07:05:00.000Z'))
      expect(span.end).toEqual(at('2025-01-15T07:35:00.000Z'))
    }
  })

  test('handles a single GPS point', () => {
    const span = gpsPrecedenceSpan([{ time: at('2025-01-15T07:05:00.000Z') }])

    expect(span.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span.end).toEqual(at('2025-01-15T07:05:00.000Z'))
  })

  test('uses the activity span when there are no GPS points', () => {
    const span = gpsPrecedenceSpan([], {
      end: at('2025-01-15T07:45:00.000Z'),
      start: at('2025-01-15T07:00:00.000Z'),
    })

    expect(span.start).toEqual(at('2025-01-15T07:00:00.000Z'))
    expect(span.end).toEqual(at('2025-01-15T07:45:00.000Z'))
  })

  test('does not treat unordered GPS points as an inverted range', () => {
    const span = gpsPrecedenceSpan([
      { time: at('2025-01-15T07:35:00.000Z') },
      { time: at('2025-01-15T07:05:00.000Z') },
    ])

    expect(span.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span.end).toEqual(at('2025-01-15T07:35:00.000Z'))
  })
})
