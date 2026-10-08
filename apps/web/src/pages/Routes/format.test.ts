import type { RouteEffort } from '@aurboda/api-spec'

import { describe, expect, it } from 'vitest'

import { effortSeries, formatElapsed } from './format'

describe('formatElapsed', () => {
  it('formats minutes and hours', () => {
    expect(formatElapsed(0)).toBe('0:00')
    expect(formatElapsed(312.4)).toBe('5:12')
    expect(formatElapsed(3725)).toBe('1:02:05')
  })
})

describe('effortSeries', () => {
  const effort = (start_time: string, extra: Partial<RouteEffort>): RouteEffort => ({
    activity_id: start_time,
    coverage: 1,
    elapsed_s: 1800,
    source: 'garmin',
    start_time,
    ...extra,
  })
  const efforts = [
    effort('2026-06-08T07:00:00.000Z', { avg_hr: 150, pace_s_per_km: 300 }),
    effort('2026-06-04T07:00:00.000Z', { avg_hr: 155 }),
    effort('2026-06-01T07:00:00.000Z', { pace_s_per_km: 330 }),
  ]

  it('charts pace in minutes per km, oldest first, skipping runs without it', () => {
    expect(effortSeries(efforts, 'pace_s_per_km')).toEqual([
      { date: '2026-06-01T07:00:00.000Z', value: 5.5 },
      { date: '2026-06-08T07:00:00.000Z', value: 5 },
    ])
  })

  it('charts average heart rate', () => {
    expect(effortSeries(efforts, 'avg_hr').map((p) => p.value)).toEqual([155, 150])
  })
})
