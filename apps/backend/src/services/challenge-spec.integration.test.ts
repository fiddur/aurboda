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

    const before = await resolveMemberSeries(user, spec, ...window)
    expect(before.last_updated).toBe('2026-06-02T06:00:00.000Z')

    // The same total re-sent leaves it alone; a higher total moves it to now.
    await insertTimeSeries(user, [{ ...point, value: 5000 }])
    expect((await resolveMemberSeries(user, spec, ...window)).last_updated).toBe('2026-06-02T06:00:00.000Z')

    await insertTimeSeries(user, [{ ...point, value: 8200 }])
    const after = await resolveMemberSeries(user, spec, ...window)
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
    )
    // strava steps are excluded from the total; last_updated agrees with it.
    expect(series.total).toBe(5000)
    expect(series.last_updated).toBe('2026-06-01T06:00:00.000Z')
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
    )
    expect(series.total).toBe(2)
    expect(series.last_updated).toBe('2026-06-02T19:45:00.000Z')
  })
})
