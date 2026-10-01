import { describe, expect, test } from 'vitest'

import { assembleStructuredActivity, downsampleRoutePoints } from './feed-structured-activity.ts'

describe('downsampleRoutePoints', () => {
  test('passes a list at or under the cap through unchanged', () => {
    const points = [1, 2, 3]
    expect(downsampleRoutePoints(points, 3)).toBe(points)
    expect(downsampleRoutePoints(points, 500)).toBe(points)
    expect(downsampleRoutePoints([], 500)).toEqual([])
  })

  test('downsamples evenly to the cap, keeping the first and last points', () => {
    const points = Array.from({ length: 2000 }, (_, i) => i)
    const out = downsampleRoutePoints(points, 500)
    expect(out).toHaveLength(500)
    expect(out[0]).toBe(0)
    expect(out.at(-1)).toBe(1999)
    // Strictly increasing (time-ordered input stays time-ordered).
    for (let i = 1; i < out.length; i++) expect(out[i]!).toBeGreaterThan(out[i - 1]!)
  })

  test('a cap of 2 keeps exactly the endpoints', () => {
    expect(downsampleRoutePoints([10, 20, 30, 40], 2)).toEqual([10, 40])
  })
})

describe('assembleStructuredActivity', () => {
  const start = new Date('2026-07-01T06:30:00Z')
  const end = new Date('2026-07-01T07:10:00Z')

  test('emits the QuantPub 0.2 payload with camelCase fields and metric keys', () => {
    const structured = assembleStructuredActivity(
      { activity_type: 'running', end_time: end, start_time: start, title: 'Morning run' },
      [
        { key: 'heart_rate_avg', label: 'Avg HR', unit: 'bpm', value: 150 },
        { key: 'hr_zone_minutes', label: 'HR zones', value: { z2: 22 } },
      ],
      [{ bucket: '5s', metric: 'heartRate', samples: [], unit: 'bpm' }],
      'Lovely',
    )
    expect(structured).toEqual({
      activityType: 'running',
      endTime: end.toISOString(),
      kind: 'activity',
      message: 'Lovely',
      metrics: [
        { key: 'heartRateAvg', unit: 'bpm', value: 150 },
        { key: 'hrZoneMinutes', value: { z2: 22 } },
      ],
      name: 'Morning run',
      series: [{ bucket: '5s', metric: 'heartRate', samples: [], unit: 'bpm' }],
      startTime: start.toISOString(),
    })
    expect(structured).not.toHaveProperty('durationSeconds')
  })

  test('omits the optional fields when absent', () => {
    const structured = assembleStructuredActivity({ activity_type: 'yoga', start_time: start }, [], [])
    expect(structured).toEqual({
      activityType: 'yoga',
      kind: 'activity',
      metrics: [],
      series: [],
      startTime: start.toISOString(),
    })
  })
})
