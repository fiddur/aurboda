/**
 * Integration test for resolveMemberSeries — the per-member series + total + the
 * "last updated" data timestamp that challenge standings surface. Runs against a
 * real PostgreSQL via testcontainers.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { ChallengeSpecFields } from '../db/index.ts'

import { query } from '../db/connection.ts'
import { insertActivity, insertTimeSeries } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { resolveMemberSeries } from './challenge-spec.ts'

const CONTAINER_TIMEOUT = 120_000

const metricSpec: ChallengeSpecFields = {
  activity_type_id: null,
  aggregation: 'sum',
  bucket_size: '1d',
  pattern: 'steps',
  source_type: 'metric',
  unit: 'steps',
}

describe('resolveMemberSeries integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('metric: last_updated is when the contributing data last changed', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      {
        metric: 'steps',
        source: 'health_connect_aggregate',
        time: new Date('2026-06-01T06:00:00Z'),
        value: 5000,
      },
      {
        metric: 'steps',
        source: 'health_connect_aggregate',
        time: new Date('2026-06-02T18:30:00Z'),
        value: 7000,
      },
    ])

    const series = await resolveMemberSeries(
      user,
      metricSpec,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'UTC',
    )
    expect(series.total).toBe(12000)
    // Both points were written just now, so that — not their 2026 sample times — is the answer.
    expect(Date.now() - new Date(series.last_updated!).getTime()).toBeLessThan(60_000)
  })

  test('metric: a daily aggregate rewritten in place moves last_updated off midnight', async () => {
    const user = getTestUser()
    const midnight = new Date('2026-06-02T00:00:00Z')
    const point = { metric: 'steps', source: 'health_connect_aggregate', time: midnight } as const
    await insertTimeSeries(user, [{ ...point, value: 5000 }])
    // Pretend the morning sync happened hours ago.
    await query(user, `UPDATE time_series SET updated_at = $1 WHERE metric = 'steps'`, [
      new Date('2026-06-02T06:00:00Z'),
    ])
    const window = [new Date('2026-06-01T00:00:00Z'), new Date('2026-06-03T00:00:00Z')] as const
    const spec: ChallengeSpecFields = {
      activity_type_id: null,
      aggregation: 'sum',
      bucket_size: '1d',
      pattern: 'steps',
      source_type: 'metric',
      unit: 'steps',
    }

    const before = await resolveMemberSeries(user, spec, ...window, 'UTC')
    expect(before.last_updated).toBe('2026-06-02T06:00:00.000Z')

    // The same total re-sent leaves it alone; a higher total moves it to now.
    await insertTimeSeries(user, [{ ...point, value: 5000 }])
    expect((await resolveMemberSeries(user, spec, ...window, 'UTC')).last_updated).toBe(
      '2026-06-02T06:00:00.000Z',
    )

    await insertTimeSeries(user, [{ ...point, value: 8200 }])
    const after = await resolveMemberSeries(user, spec, ...window, 'UTC')
    expect(after.total).toBe(8200)
    expect(Date.now() - new Date(after.last_updated!).getTime()).toBeLessThan(60_000)
  })

  test('metric: rows from before updated_at existed fall back to their own time', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      {
        metric: 'steps',
        source: 'health_connect_aggregate',
        time: new Date('2026-06-02T18:30:00Z'),
        value: 7000,
      },
    ])
    await query(user, `UPDATE time_series SET updated_at = NULL`)

    const series = await resolveMemberSeries(
      user,
      {
        activity_type_id: null,
        aggregation: 'sum',
        bucket_size: '1d',
        pattern: 'steps',
        source_type: 'metric',
        unit: 'steps',
      },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'UTC',
    )
    expect(series.last_updated).toBe('2026-06-02T18:30:00.000Z')
  })

  test('metric: no data in the window → last_updated null, total 0', async () => {
    const user = getTestUser()
    // Data exists, but outside the challenge window.
    await insertTimeSeries(user, [
      {
        metric: 'steps',
        source: 'health_connect_aggregate',
        time: new Date('2026-05-20T06:00:00Z'),
        value: 5000,
      },
    ])

    const series = await resolveMemberSeries(
      user,
      metricSpec,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'UTC',
    )
    expect(series.total).toBe(0)
    expect(series.last_updated).toBeNull()
  })

  test('metric: the source filter that bounds the total also bounds last_updated', async () => {
    const user = getTestUser()
    // `steps` is a cumulative metric read only from its trusted sources. A later
    // point from an untrusted source must not count toward the total OR the
    // last_updated, or the two would disagree.
    await insertTimeSeries(user, [
      {
        metric: 'steps',
        source: 'health_connect_aggregate',
        time: new Date('2026-06-01T06:00:00Z'),
        value: 5000,
      },
      { metric: 'steps', source: 'strava', time: new Date('2026-06-02T23:00:00Z'), value: 9999 },
    ])
    // Give the untrusted point the later change stamp, so only the filter can keep it out.
    await query(user, `UPDATE time_series SET updated_at = $1 WHERE source = 'health_connect_aggregate'`, [
      new Date('2026-06-01T06:00:00Z'),
    ])
    await query(user, `UPDATE time_series SET updated_at = $1 WHERE source = 'strava'`, [
      new Date('2026-06-02T23:00:00Z'),
    ])

    const series = await resolveMemberSeries(
      user,
      metricSpec,
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'UTC',
    )
    // strava steps are excluded from the total; last_updated agrees with it.
    expect(series.total).toBe(5000)
    expect(series.last_updated).toBe('2026-06-01T06:00:00.000Z')
  })

  test('metric: a daily aggregate stamped exactly at the exclusive end is outside the window', async () => {
    const user = getTestUser()
    const lastDay = new Date('2026-09-29T22:00:00Z')
    const dayAfter = new Date('2026-09-30T22:00:00Z')
    await insertTimeSeries(user, [
      { metric: 'steps', source: 'health_connect_aggregate', time: lastDay, value: 1000 },
      { metric: 'steps', source: 'health_connect_aggregate', time: dayAfter, value: 5000 },
    ])
    await query(user, `UPDATE time_series SET updated_at = $1 WHERE time = $2`, [
      new Date('2026-09-30T20:00:00Z'),
      lastDay,
    ])
    await query(user, `UPDATE time_series SET updated_at = $1 WHERE time = $2`, [
      new Date('2026-10-01T16:30:00Z'),
      dayAfter,
    ])

    const series = await resolveMemberSeries(
      user,
      metricSpec,
      new Date('2026-08-31T22:00:00Z'),
      dayAfter,
      'Europe/Stockholm',
    )
    expect(series.total).toBe(1000)
    expect(series.last_updated).toBe('2026-09-30T20:00:00.000Z')
    expect(series.buckets).toEqual([{ bucket_start: lastDay.toISOString(), value: 1000 }])
  })

  test("daily buckets follow the challenge's timezone, so a row just after local midnight is the next day", async () => {
    const user = getTestUser()
    await insertActivity(user, {
      activity_type: 'exercise',
      source: 'strava',
      start_time: new Date('2026-06-01T10:00:00Z'),
    })
    // 00:30 on 2 June in Stockholm (CEST, UTC+2), still 1 June in UTC.
    await insertActivity(user, {
      activity_type: 'exercise',
      source: 'strava',
      start_time: new Date('2026-06-01T22:30:00Z'),
    })
    const spec: ChallengeSpecFields = {
      ...metricSpec,
      aggregation: 'count',
      pattern: 'exercise',
      source_type: 'activity_type',
      unit: 'sessions',
    }
    const window = [new Date('2026-05-31T22:00:00Z'), new Date('2026-06-02T22:00:00Z')] as const

    const local = await resolveMemberSeries(user, spec, ...window, 'Europe/Stockholm')
    expect(local.buckets).toEqual([
      { bucket_start: '2026-05-31T22:00:00.000Z', value: 1 },
      { bucket_start: '2026-06-01T22:00:00.000Z', value: 1 },
    ])

    const fallback = await resolveMemberSeries(user, spec, ...window, 'Mars/Base')
    expect(fallback.buckets.filter((b) => b.value > 0)).toEqual([
      { bucket_start: '2026-06-01T00:00:00.000Z', value: 2 },
    ])
  })

  test('activity_type: last_updated is the most recent matching activity start', async () => {
    const user = getTestUser()
    await insertActivity(user, {
      activity_type: 'exercise',
      source: 'strava',
      start_time: new Date('2026-06-01T07:00:00Z'),
    })
    await insertActivity(user, {
      activity_type: 'exercise',
      source: 'strava',
      start_time: new Date('2026-06-02T19:45:00Z'),
    })

    const series = await resolveMemberSeries(
      user,
      {
        ...metricSpec,
        aggregation: 'count',
        pattern: 'exercise',
        source_type: 'activity_type',
        unit: 'sessions',
      },
      new Date('2026-06-01T00:00:00Z'),
      new Date('2026-06-03T00:00:00Z'),
      'UTC',
    )
    expect(series.total).toBe(2)
    expect(series.last_updated).toBe('2026-06-02T19:45:00.000Z')
  })
})
