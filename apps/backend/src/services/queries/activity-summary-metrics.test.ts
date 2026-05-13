import { describe, expect, test } from 'vitest'

import { computeActivitySummaryMetrics, type SummaryMetricSeries } from './activity-summary-metrics.ts'

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
