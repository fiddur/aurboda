import { describe, expect, test, vi } from 'vitest'

import type { QueryMetricsBucketedResult } from './queries/types.ts'

import { floorSeriesBucket, type PublicSeriesDeps, resolvePublicSeries } from './feed-series.ts'

const ACTIVITY = {
  end_time: new Date('2026-07-01T07:11:00Z'),
  start_time: new Date('2026-07-01T06:30:00Z'),
}

const bucketed = (buckets: QueryMetricsBucketedResult['buckets']): QueryMetricsBucketedResult => ({
  bucket: '5s',
  buckets,
  end: '',
  start: '',
})

const makeDeps = (over: Partial<PublicSeriesDeps> = {}): PublicSeriesDeps => ({
  findCoveringWindow: vi.fn(async () => ACTIVITY),
  queryBucketed: vi.fn(async () => bucketed([])),
  ...over,
})

describe('floorSeriesBucket', () => {
  test('floors below the minimum to 5s', () => {
    expect(floorSeriesBucket('1s')).toBe('5s')
    expect(floorSeriesBucket('0s')).toBe('5s')
  })

  test('keeps values at or above the minimum', () => {
    expect(floorSeriesBucket('5s')).toBe('5s')
    expect(floorSeriesBucket('60s')).toBe('60s')
    expect(floorSeriesBucket('1m')).toBe('1m')
    expect(floorSeriesBucket('2h')).toBe('2h')
    expect(floorSeriesBucket('1d')).toBe('1d') // `d` is understood, not floored to 5s
  })

  test('falls back to 5s for a malformed bucket', () => {
    expect(floorSeriesBucket('garbage')).toBe('5s')
  })
})

describe('resolvePublicSeries', () => {
  const start = new Date('2026-07-01T06:40:00Z')
  const end = new Date('2026-07-01T07:00:00Z')

  test('returns null for an unauthorized (unshared) metric', async () => {
    const deps = makeDeps({ findCoveringWindow: vi.fn(async () => null) })
    expect(await resolvePublicSeries('heart_rate', start, end, '5s', deps)).toBeNull()
    expect(deps.queryBucketed).not.toHaveBeenCalled()
  })

  test('returns null for an inverted/empty range without hitting authorization', async () => {
    const deps = makeDeps()
    expect(await resolvePublicSeries('heart_rate', end, start, '5s', deps)).toBeNull()
    expect(deps.findCoveringWindow).not.toHaveBeenCalled()
  })

  test('projects only the requested metric and drops per-measurement timestamps', async () => {
    const queryBucketed = vi.fn(async () =>
      bucketed([
        {
          end: '2026-07-01T06:40:05Z',
          metrics: {
            heart_rate: { avg: 148, count: 5, first_time: 'x', last_time: 'y', max: 152, min: 145 },
            stress_level: { avg: 30, count: 5, first_time: 'x', last_time: 'y', max: 40, min: 20 },
          },
          start: '2026-07-01T06:40:00Z',
        },
      ]),
    )
    const result = await resolvePublicSeries('heart_rate', start, end, '5s', makeDeps({ queryBucketed }))

    expect(result).not.toBeNull()
    expect(result!.metric).toBe('heart_rate')
    expect(result!.unit).toBe('bpm')
    expect(result!.samples).toEqual([
      { avg: 148, count: 5, end: '2026-07-01T06:40:05Z', max: 152, min: 145, start: '2026-07-01T06:40:00Z' },
    ])
    // No first_time/last_time leak, and the unshared metric never appears.
    expect(JSON.stringify(result!.samples)).not.toContain('first_time')
    expect(JSON.stringify(result!.samples)).not.toContain('stress_level')
  })

  test('passes sum through for cumulative metrics', async () => {
    const queryBucketed = vi.fn(async () =>
      bucketed([
        {
          end: '2026-07-01T06:41:00Z',
          metrics: {
            distance: { avg: 100, count: 1, first_time: 'x', last_time: 'y', max: 100, min: 100, sum: 100 },
          },
          start: '2026-07-01T06:40:00Z',
        },
      ]),
    )
    const result = await resolvePublicSeries('distance', start, end, '1m', makeDeps({ queryBucketed }))
    expect(result!.samples[0].sum).toBe(100)
  })

  test('skips buckets that lack the requested metric', async () => {
    const queryBucketed = vi.fn(async () =>
      bucketed([
        { end: 'b', metrics: {}, start: 'a' },
        {
          end: 'd',
          metrics: {
            heart_rate: { avg: 150, count: 2, first_time: 'x', last_time: 'y', max: 151, min: 149 },
          },
          start: 'c',
        },
      ]),
    )
    const result = await resolvePublicSeries('heart_rate', start, end, '5s', makeDeps({ queryBucketed }))
    expect(result!.samples).toHaveLength(1)
  })

  test('floors the bucket and clamps the range to the activity window', async () => {
    const queryBucketed = vi.fn(async () => bucketed([]))
    // Request a wider window than the activity and a sub-minimum bucket.
    const wideStart = new Date('2026-07-01T00:00:00Z')
    const wideEnd = new Date('2026-07-01T23:59:00Z')
    await resolvePublicSeries('heart_rate', wideStart, wideEnd, '1s', makeDeps({ queryBucketed }))

    expect(queryBucketed).toHaveBeenCalledWith('heart_rate', ACTIVITY.start_time, ACTIVITY.end_time, '5s')
  })
})
