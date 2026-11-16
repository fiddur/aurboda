import { describe, expect, it } from 'vitest'

import type { MetricBucketParsed } from '../../utils/chart'

import {
  dailyPointsFromBuckets,
  dailySleepPoints,
  dailyValueScale,
  DAILY_METRIC_SPECS,
  layoutDailyTracks,
} from './drawDailyMetricTracks'

const at = (iso: string) => new Date(iso)

const bucket = (day: string, metrics: MetricBucketParsed['metrics']): MetricBucketParsed => ({
  end: at(`${day}T23:59:59.999Z`),
  metrics,
  start: at(`${day}T00:00:00Z`),
})

const stats = (avg: number, count: number, sum?: number) => ({
  avg,
  count,
  max: avg,
  min: avg,
  ...(sum === undefined ? {} : { sum }),
})

describe('dailyPointsFromBuckets', () => {
  const buckets = [
    bucket('2026-11-09', { resting_heart_rate: stats(52, 1), steps: stats(400, 20, 8000) }),
    bucket('2026-11-10', { steps: stats(300, 10) }),
    bucket('2026-11-11', { resting_heart_rate: stats(55, 2) }),
  ]

  it('takes the mean for a level and skips days without it', () => {
    expect(
      dailyPointsFromBuckets(buckets, 'resting_heart_rate').map((p) => [p.start.toISOString(), p.value]),
    ).toEqual([
      ['2026-11-09T00:00:00.000Z', 52],
      ['2026-11-11T00:00:00.000Z', 55],
    ])
  })

  it('takes the sum for steps, falling back to mean times count', () => {
    expect(dailyPointsFromBuckets(buckets, 'steps').map((p) => p.value)).toEqual([8000, 3000])
  })
})

describe('dailySleepPoints', () => {
  it('counts a night on the day it ends and merges the same night from two sources', () => {
    const points = dailySleepPoints([
      {
        activity_type: 'sleep',
        end_time: at('2026-11-10T06:30:00Z'),
        start_time: at('2026-11-09T23:00:00Z'),
      },
      {
        activity_type: 'sleep',
        end_time: at('2026-11-10T07:00:00Z'),
        start_time: at('2026-11-09T23:30:00Z'),
      },
      {
        activity_type: 'sleep',
        end_time: at('2026-11-10T15:00:00Z'),
        start_time: at('2026-11-10T14:30:00Z'),
      },
      {
        activity_type: 'sleep',
        end_time: at('2026-11-11T06:00:00Z'),
        start_time: at('2026-11-10T22:00:00Z'),
      },
      { activity_type: 'nap', end_time: at('2026-11-11T13:00:00Z'), start_time: at('2026-11-11T12:00:00Z') },
      { activity_type: 'sleep', start_time: at('2026-11-11T22:00:00Z') },
    ])
    expect(points.map((p) => [p.start.toISOString(), p.end.toISOString(), p.value])).toEqual([
      ['2026-11-10T00:00:00.000Z', '2026-11-11T00:00:00.000Z', 480 + 30],
      ['2026-11-11T00:00:00.000Z', '2026-11-12T00:00:00.000Z', 480],
    ])
  })
})

describe('layoutDailyTracks', () => {
  it('leaves the lane alone without daily metrics', () => {
    expect(layoutDailyTracks(100, 300, 0)).toEqual({ mainHeight: 300, rows: [] })
  })

  it('stacks 28 px rows under the shrunken lane content', () => {
    expect(layoutDailyTracks(100, 300, 2)).toEqual({
      mainHeight: 244,
      rows: [
        { height: 28, y: 344 },
        { height: 28, y: 372 },
      ],
    })
  })

  it('thins the rows on a short lane so the lane keeps 40 px', () => {
    const { mainHeight, rows } = layoutDailyTracks(0, 100, 3)
    expect(mainHeight).toBe(40)
    expect(rows.map((r) => r.height)).toEqual([20, 20, 20])
    expect(rows.at(-1)!.y + rows.at(-1)!.height).toBe(100)
  })
})

describe('dailyValueScale', () => {
  const row = { height: 28, y: 100 }
  const point = (value: number) => ({
    end: at('2026-11-10T00:00:00Z'),
    start: at('2026-11-09T00:00:00Z'),
    value,
  })

  it('maps the series min and max to the row bottom and top, inside the row', () => {
    const y = dailyValueScale([point(50), point(60), point(55)], row)
    expect(y(60)).toBe(111)
    expect(y(50)).toBe(123)
  })

  it('centres a flat series', () => {
    const y = dailyValueScale([point(52), point(52)], row)
    expect(y(52)).toBe(117)
  })
})

describe('DAILY_METRIC_SPECS', () => {
  it('formats sleep as hours and minutes and steps with grouping', () => {
    expect(DAILY_METRIC_SPECS.sleep_duration.format(452)).toBe('7h 32m')
    expect(DAILY_METRIC_SPECS.resting_heart_rate.format(51.6)).toBe('52 bpm')
  })
})
