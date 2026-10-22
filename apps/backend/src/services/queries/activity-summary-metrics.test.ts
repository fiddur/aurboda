import { describe, expect, test } from 'vitest'

import {
  computeActivitySummaryMetrics,
  type SummaryMetricSeries,
  windowBounds,
} from './activity-summary-metrics.ts'

const start = new Date('2024-01-15T10:00:00Z')
const end = new Date('2024-01-15T10:10:00Z') // 10 minutes

const at = (offsetSec: number): Date => new Date(start.getTime() + offsetSec * 1000)

describe('computeActivitySummaryMetrics', () => {
  test('returns empty result for an activity with no end_time and no data', () => {
    const result = computeActivitySummaryMetrics({ start_time: start }, {})
    expect(result).toEqual({})
  })

  test('passes through summary fields stored in activity.data', () => {
    const result = computeActivitySummaryMetrics(
      {
        data: {
          average_hr: 145,
          calories: 230,
          distance: 2671.9,
          elevation_gain: 44,
          max_hr: 172,
          steps: 3446,
          vo2_max: 38,
        },
        end_time: end,
        start_time: start,
      },
      {},
    )
    expect(result).toMatchObject({
      avg_hr: 145,
      calories: 230,
      distance: 2671.9,
      elevation_gain: 44,
      max_hr: 172,
      steps: 3446,
      vo2_max: 38,
    })
  })

  test('ignores non-numeric data fields', () => {
    const result = computeActivitySummaryMetrics(
      { data: { calories: 'lots', distance: null }, end_time: end, start_time: start },
      {},
    )
    expect(result).toEqual({})
  })

  test('computes avg pace from speed time-series (preferred over distance/duration)', () => {
    const series: SummaryMetricSeries = {
      speed: [
        [at(60), 4],
        [at(120), 5],
        [at(180), 6],
      ],
    }
    const result = computeActivitySummaryMetrics(
      { data: { distance: 3000 }, end_time: end, start_time: start },
      series,
    )
    expect(result.avg_speed).toBe(5)
    expect(result.avg_pace).toBe(200) // 1000 / 5 m/s = 200 s/km
  })

  test('falls back to distance/duration when no speed series', () => {
    const result = computeActivitySummaryMetrics(
      { data: { distance: 3000 }, end_time: end, start_time: start },
      {},
    )
    // 600 sec / 3000 m * 1000 = 200 sec/km
    expect(result.avg_pace).toBe(200)
  })

  test('computes elevation gain and loss from elevation series', () => {
    const series: SummaryMetricSeries = {
      elevation: [
        [at(60), 100],
        [at(120), 110], // +10
        [at(180), 105], // -5
        [at(240), 130], // +25
        [at(300), 100], // -30
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.elevation_gain).toBe(35)
    expect(result.elevation_loss).toBe(35)
  })

  test('time-series elevation overrides data.elevation_gain when both present', () => {
    const series: SummaryMetricSeries = {
      elevation: [
        [at(0), 0],
        [at(60), 50],
      ],
    }
    const result = computeActivitySummaryMetrics(
      { data: { elevation_gain: 999 }, end_time: end, start_time: start },
      series,
    )
    expect(result.elevation_gain).toBe(50)
  })

  test('records body battery before and after', () => {
    const series: SummaryMetricSeries = {
      body_battery: [
        [at(0), 78],
        [at(120), 70],
        [at(599), 55],
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.body_battery_before).toBe(78)
    expect(result.body_battery_after).toBe(55)
  })

  test('computes avg cadence, stride length, power, GCT from series', () => {
    const series: SummaryMetricSeries = {
      ground_contact_time: [
        [at(60), 220],
        [at(120), 240],
      ],
      power: [
        [at(60), 300],
        [at(120), 320],
      ],
      run_cadence: [
        [at(60), 170],
        [at(120), 180],
      ],
      stride_length: [
        [at(60), 1.2],
        [at(120), 1.4],
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.avg_cadence).toBe(175)
    expect(result.avg_stride_length).toBe(1.3)
    expect(result.avg_power).toBe(310)
    expect(result.avg_ground_contact_time).toBe(230)
  })

  test('filters non-positive values from movement metrics', () => {
    // Cadence/power/etc. drop to 0 when stopped — those samples shouldn't drag
    // the moving average down.
    const series: SummaryMetricSeries = {
      run_cadence: [
        [at(60), 0],
        [at(120), 180],
        [at(180), 0],
        [at(240), 180],
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.avg_cadence).toBe(180)
  })

  test('fills in HR from time-series when not in data, takes max from samples', () => {
    const series: SummaryMetricSeries = {
      heart_rate: [
        [at(60), 130],
        [at(120), 150],
        [at(180), 172],
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.avg_hr).toBe(151) // (130 + 150 + 172) / 3 = 150.67 → 151
    expect(result.max_hr).toBe(172)
  })

  test('does not override avg_hr/max_hr from data with time-series values', () => {
    const series: SummaryMetricSeries = {
      heart_rate: [
        [at(60), 200],
        [at(120), 200],
      ],
    }
    const result = computeActivitySummaryMetrics(
      { data: { average_hr: 145, max_hr: 172 }, end_time: end, start_time: start },
      series,
    )
    expect(result.avg_hr).toBe(145)
    expect(result.max_hr).toBe(172)
  })

  test('only considers time-series points within the activity window', () => {
    const series: SummaryMetricSeries = {
      heart_rate: [
        [new Date('2024-01-15T09:00:00Z'), 200], // before
        [at(60), 130],
        [at(180), 140],
        [new Date('2024-01-15T11:00:00Z'), 200], // after
      ],
    }
    const result = computeActivitySummaryMetrics({ end_time: end, start_time: start }, series)
    expect(result.avg_hr).toBe(135)
  })
})

describe('windowBounds', () => {
  const points: [Date, number][] = [0, 60, 120, 180, 240].map((sec) => [at(sec), sec])

  test('covers an inclusive range', () => {
    expect(windowBounds(points, at(60), at(180))).toEqual([1, 4])
  })

  test('includes a point landing exactly on either edge', () => {
    // The pre-binary-search filter was `t >= start && t <= end`, so both ends
    // are inclusive — an activity's first and last sample must not drop out.
    expect(windowBounds(points, at(0), at(240))).toEqual([0, 5])
    expect(windowBounds(points, at(120), at(120))).toEqual([2, 3])
  })

  test('returns an empty range when nothing falls inside', () => {
    expect(windowBounds(points, at(300), at(400))).toEqual([5, 5])
    expect(windowBounds(points, at(-100), at(-50))).toEqual([0, 0])
    expect(windowBounds(points, at(61), at(119))).toEqual([2, 2])
  })

  test('handles an empty series', () => {
    expect(windowBounds([], at(0), at(60))).toEqual([0, 0])
  })

  test('agrees with a linear scan across every offset pair', () => {
    // Parity with the filter this replaced, which is the only guarantee that
    // matters — binary search is easy to get subtly wrong at the edges.
    const offsets = [-30, 0, 30, 60, 90, 120, 150, 180, 210, 240, 270]
    for (const from of offsets) {
      for (const to of offsets) {
        if (to < from) continue
        const [lo, hi] = windowBounds(points, at(from), at(to))
        const scanned = points.filter(([t]) => t >= at(from) && t <= at(to))
        expect(points.slice(lo, hi)).toEqual(scanned)
      }
    }
  })

  test('windows a long series without rescanning it per activity', () => {
    // The outage shape: one series fetched for a wide span, many activities each
    // asking for their own window. 200k points is ~2.3 days at 1Hz.
    const long: [Date, number][] = Array.from({ length: 200_000 }, (_, i) => [at(i), i])
    const activityStarts = Array.from({ length: 500 }, (_, i) => i * 400)

    for (const offset of activityStarts) {
      const [lo, hi] = windowBounds(long, at(offset), at(offset + 100))
      expect(hi - lo).toBe(101)
      expect(long[lo][1]).toBe(offset)
    }
  })
})
