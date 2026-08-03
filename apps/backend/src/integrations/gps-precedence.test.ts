import { describe, expect, test } from 'vitest'

import { activityTrackSources, gpsPrecedenceSpan } from './gps-precedence.ts'

const at = (iso: string) => new Date(iso)

describe('activityTrackSources', () => {
  test('holds every source that contributes a per-activity GPS track', () => {
    // Kept in sync by hand with the integrations that write locations from an
    // activity; a new one missing here would have its track deleted by the others.
    expect(activityTrackSources).toEqual(['garmin', 'strava'])
  })
})

describe('gpsPrecedenceSpan', () => {
  const gpsPoints = [
    { time: at('2025-01-15T07:05:00.000Z') },
    { time: at('2025-01-15T07:20:00.000Z') },
    { time: at('2025-01-15T07:35:00.000Z') },
  ]
  const activitySpan = { end: at('2025-01-15T07:45:00.000Z'), start: at('2025-01-15T07:00:00.000Z') }

  test('widens the track range out to the full activity span', () => {
    const span = gpsPrecedenceSpan(gpsPoints, activitySpan)

    expect(span).toEqual(activitySpan)
  })

  test('lets the track overhang the activity span within tolerance', () => {
    const span = gpsPrecedenceSpan(gpsPoints, {
      end: at('2025-01-15T07:30:00.000Z'),
      start: at('2025-01-15T07:10:00.000Z'),
    })

    // Both ends overhang by 5 min, exactly the tolerance
    expect(span?.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span?.end).toEqual(at('2025-01-15T07:35:00.000Z'))
  })

  test('clamps an outlier timestamp to the tolerated window', () => {
    // A bogus fix a year later must not stretch the soft-delete range to cover it
    const span = gpsPrecedenceSpan([...gpsPoints, { time: at('2026-01-15T07:20:00.000Z') }], activitySpan)

    expect(span?.end).toEqual(at('2025-01-15T07:50:00.000Z'))
  })

  test('clamps an outlier before the activity too', () => {
    const span = gpsPrecedenceSpan([{ time: at('2024-01-15T07:20:00.000Z') }, ...gpsPoints], activitySpan)

    expect(span?.start).toEqual(at('2025-01-15T06:55:00.000Z'))
  })

  test('falls back to the track range when the span is unknown', () => {
    for (const noSpan of [undefined, null]) {
      const span = gpsPrecedenceSpan(gpsPoints, noSpan)
      expect(span?.start).toEqual(at('2025-01-15T07:05:00.000Z'))
      expect(span?.end).toEqual(at('2025-01-15T07:35:00.000Z'))
    }
  })

  test('handles a single GPS point', () => {
    const span = gpsPrecedenceSpan([{ time: at('2025-01-15T07:05:00.000Z') }])

    expect(span?.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span?.end).toEqual(at('2025-01-15T07:05:00.000Z'))
  })

  test('uses the activity span when there are no GPS points', () => {
    expect(gpsPrecedenceSpan([], activitySpan)).toEqual(activitySpan)
  })

  test('returns null when there is nothing to derive a range from', () => {
    expect(gpsPrecedenceSpan([])).toBeNull()
    expect(gpsPrecedenceSpan([], null)).toBeNull()
  })

  test('ignores unparseable timestamps rather than yielding an invalid range', () => {
    const span = gpsPrecedenceSpan([{ time: new Date('nope') }, ...gpsPoints])

    expect(span?.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span?.end).toEqual(at('2025-01-15T07:35:00.000Z'))
  })

  test('does not treat unordered GPS points as an inverted range', () => {
    const span = gpsPrecedenceSpan([
      { time: at('2025-01-15T07:35:00.000Z') },
      { time: at('2025-01-15T07:05:00.000Z') },
    ])

    expect(span?.start).toEqual(at('2025-01-15T07:05:00.000Z'))
    expect(span?.end).toEqual(at('2025-01-15T07:35:00.000Z'))
  })

  test('handles a track long enough to break a spread-argument min/max', () => {
    // 24 h at 1 Hz — Math.min(...times) would exceed V8's argument limit here
    const start = at('2025-01-15T00:00:00.000Z').getTime()
    const longTrack = Array.from({ length: 86_400 }, (_, i) => ({ time: new Date(start + i * 1000) }))

    const span = gpsPrecedenceSpan(longTrack)

    expect(span?.start).toEqual(new Date(start))
    expect(span?.end).toEqual(new Date(start + 86_399 * 1000))
  })
})
