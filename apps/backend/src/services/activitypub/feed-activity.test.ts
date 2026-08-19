import { describe, expect, test } from 'vitest'

import type { QueryMetricsBucketedResult } from '../queries/types.ts'

import {
  buildFeedPostActivity,
  type FeedActivityContext,
  type FeedActivityInput,
  windowMetricStat,
} from './feed-activity.ts'

const ctx: FeedActivityContext = {
  apiBaseUrl: 'https://aurboda.net/api/',
  origin: 'https://aurboda.net/',
  username: 'fiddur',
}

const input: FeedActivityInput = {
  activityType: 'running',
  endTime: new Date('2026-07-01T07:11:03Z'),
  includedMetrics: ['duration', 'heart_rate_avg'],
  postId: 'abc123',
  publishedAt: new Date('2026-07-01T20:00:00Z'),
  seriesMetrics: ['heart_rate'],
  startTime: new Date('2026-07-01T06:30:00Z'),
  title: 'Morning run',
  visibility: 'public',
}

describe('buildFeedPostActivity', () => {
  test('builds canonical /users/ URLs, series href, and resolves scalars', () => {
    const c = buildFeedPostActivity(ctx, input, (metric, stat) =>
      metric === 'heart_rate' && stat === 'avg' ? 148 : undefined,
    )
    // Trailing slashes on origin/apiBaseUrl are trimmed.
    expect(c.actor).toBe('https://aurboda.net/users/fiddur')
    expect(c.id).toBe('https://aurboda.net/users/fiddur/feed/abc123')
    expect(c.object.id).toBe('https://aurboda.net/users/fiddur/feed/abc123/object')
    expect(c['@context'][1]).toEqual({ aurboda: 'https://aurboda.net/ns/activitystreams#' })
    // publishedAt drives the Create's published, workout time stays in aurboda:startTime.
    expect(c.published).toBe('2026-07-01T20:00:00.000Z')
    expect(c.object['aurboda:startTime']).toBe('2026-07-01T06:30:00.000Z')
    // Shared scalars resolved (duration from window + injected HR avg).
    expect(c.object['aurboda:metrics']).toEqual([
      { key: 'duration', unit: 'seconds', value: 2463 },
      { key: 'heart_rate_avg', unit: 'bpm', value: 148 },
    ])
    // Series href points at the public endpoint under the API base.
    const series = c.object['aurboda:series'] as { href: string }[]
    expect(series[0].href).toContain('https://aurboda.net/api/public/fiddur/series?')
    expect(series[0].href).toContain('metric=heart_rate')
  })

  test('carries the personal message and renders the date line in the given timezone (#1001)', () => {
    const c = buildFeedPostActivity(
      ctx,
      { ...input, message: 'Lovely trail!', timeZone: 'Europe/Stockholm' },
      () => undefined,
    )
    expect(c.object['aurboda:message']).toBe('Lovely trail!')
    expect(c.object.content).toContain('<p>Lovely trail!</p>')
    // 06:30Z is 08:30 in Stockholm (CEST) — the date line follows the author's tz.
    expect(c.object.content).toContain('08:30')
  })

  test('omits aurboda:message when no message is set', () => {
    const c = buildFeedPostActivity(ctx, input, () => undefined)
    expect(c.object['aurboda:message']).toBeUndefined()
  })
})

const bucketed = (buckets: QueryMetricsBucketedResult['buckets']): QueryMetricsBucketedResult => ({
  bucket: '1h',
  buckets,
  end: '',
  start: '',
})

describe('windowMetricStat', () => {
  test('merges buckets: sum adds, max takes the extreme, avg re-weights by count', () => {
    const stat = windowMetricStat(
      bucketed([
        {
          end: 'b',
          metrics: {
            distance: { avg: 0, count: 1, first_time: '', last_time: '', max: 0, min: 0, sum: 3000 },
            heart_rate: { avg: 140, count: 10, first_time: '', last_time: '', max: 150, min: 130 },
          },
          start: 'a',
        },
        {
          end: 'd',
          metrics: {
            distance: { avg: 0, count: 1, first_time: '', last_time: '', max: 0, min: 0, sum: 5200 },
            heart_rate: { avg: 160, count: 30, first_time: '', last_time: '', max: 175, min: 140 },
          },
          start: 'c',
        },
      ]),
    )
    // Weighted avg = (140*10 + 160*30) / 40 = 155
    expect(stat('heart_rate', 'avg')).toBe(155)
    expect(stat('heart_rate', 'max')).toBe(175)
    expect(stat('distance', 'sum')).toBe(8200)
  })

  test('returns undefined for a metric with no data', () => {
    const stat = windowMetricStat(bucketed([]))
    expect(stat('heart_rate', 'avg')).toBeUndefined()
  })
})
