import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { TimeSeriesPoint } from '../db/types.ts'

import { query } from '../db/connection.ts'
import { insertActivity, insertActivityTypeDefinition, insertTimeSeries } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getActivityImpact } from './correlations/activity-impact.ts'
import { getBaseline } from './correlations/baseline.ts'
import { getContinuousCorrelation } from './correlations/explore.ts'
import { getGenericCorrelation } from './correlations/generic.ts'
import { getHrvActivitiesCorrelation } from './correlations/hrv-activities.ts'
import { queryMetricsBucketed } from './queries/metrics.ts'
import { getTrend } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000
const DAY_MS = 86_400_000

const at = (iso: string) => new Date(iso)

/** A resting heart rate of 50 every morning, 90 on the mornings inside the gathering. */
const restingHr = (fromIso: string, days: number, inGathering: (t: Date) => boolean): TimeSeriesPoint[] =>
  Array.from({ length: days }, (_, i) => {
    const time = new Date(at(fromIso).getTime() + i * DAY_MS)
    return { metric: 'resting_heart_rate', source: 'garmin', time, value: inGathering(time) ? 90 : 50 }
  })

const gathering = { end: at('2026-05-04T00:00:00Z'), start: at('2026-05-01T00:00:00Z') }
const inGathering = (t: Date) => t >= gathering.start && t < gathering.end

describe('analyses leave out windows flagged exclude_from_baseline', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    const user = getTestUser()
    await query(user, `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Gathering',
      name: 'gathering',
    })
    await insertActivity(user, {
      activity_type: 'gathering',
      data: { exclude_from_baseline: true },
      end_time: gathering.end,
      source: 'manual',
      start_time: gathering.start,
    })
    await insertTimeSeries(user, restingHr('2026-03-01T06:00:00Z', 81, inGathering))
  }, CONTAINER_TIMEOUT)

  test('baseline', async () => {
    const user = getTestUser()
    const reference = at('2026-05-20T12:00:00Z')
    const excluded = await getBaseline(user, reference, { excludeFlagged: true })
    expect(excluded.resting_hr.avg30day).toBe(50)
    expect(excluded.flagged_exclusion).toMatchObject({
      excluded_points: 3,
      windows: [{ activity_type: 'gathering', start_time: '2026-05-01T00:00:00.000Z' }],
    })

    const included = await getBaseline(user, reference)
    expect(included.resting_hr.avg30day).toBeGreaterThan(50)
    expect(included.flagged_exclusion).toBeUndefined()
  })

  test('metric trend', async () => {
    const user = getTestUser()
    const input = {
      end: at('2026-05-20T12:00:00Z'),
      half_life_days: 7,
      lookback_days: 30,
      pattern: 'resting_heart_rate',
      source_type: 'metric' as const,
    }
    const excluded = await getTrend(user, { ...input, exclude_flagged: true })
    expect(excluded.history.every((p) => Math.abs(p.value - 50) < 1e-9)).toBe(true)
    expect(excluded.flagged_exclusion?.excluded_points).toBe(3)

    const included = await getTrend(user, input)
    expect(Math.max(...included.history.map((p) => p.value))).toBeGreaterThan(50)
  })

  test('a zero-filled metric trend skips the days the windows empty', async () => {
    const user = getTestUser()
    const excluded = await getTrend(user, {
      aggregation: 'sum',
      display_period: 'daily',
      end: at('2026-05-20T12:00:00Z'),
      exclude_flagged: true,
      half_life_days: 7,
      lookback_days: 30,
      missing_days: 'zero',
      pattern: 'resting_heart_rate',
      source_type: 'metric',
    })
    expect(excluded.history.length).toBeGreaterThan(0)
    expect(excluded.history.every((p) => Math.abs(p.value - 50) < 1e-9)).toBe(true)
  })

  test('bucketed metrics only with exclude_flagged', async () => {
    const user = getTestUser()
    const range = [at('2026-04-28T00:00:00Z'), at('2026-05-08T00:00:00Z')] as const
    const kept = await queryMetricsBucketed(user, ['resting_heart_rate'], ...range, '1d')
    expect(kept.buckets).toHaveLength(10)
    expect(kept.flagged_exclusion).toBeUndefined()

    const excluded = await queryMetricsBucketed(user, ['resting_heart_rate'], ...range, '1d', {
      excludeFlagged: true,
    })
    expect(excluded.buckets.map((b) => b.start.slice(0, 10))).toEqual([
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
    ])
    expect(excluded.flagged_exclusion?.excluded_points).toBe(3)
  })

  test('continuous correlation drops the flagged days', async () => {
    const user = getTestUser()
    const params = {
      outcome: { kind: 'metric' as const, metric: 'resting_heart_rate' },
      periodEnd: '2026-05-19',
      periodStart: '2026-04-20',
      trigger: { kind: 'metric' as const, metric: 'resting_heart_rate' },
    }
    const included = await getContinuousCorrelation(user, params)
    const excluded = await getContinuousCorrelation(user, { ...params, excludeFlagged: true })
    expect(excluded.n).toBe(included.n - 3)
    expect(excluded.series.some((p) => p.date === '2026-05-02')).toBe(false)
    expect(excluded.flagged_exclusion?.excluded_days).toBe(3)
  })

  test('generic correlation drops the flagged activities, samples and days', async () => {
    const user = getTestUser()
    const run = (excludeFlagged: boolean) =>
      getGenericCorrelation(
        user,
        [{ pattern: 'gathering', type: 'activity' }],
        { metric: 'resting_heart_rate', type: 'metric' },
        ['24h'],
        90,
        undefined,
        { excludeFlagged, periodEnd: '2026-05-19', periodStart: '2026-04-20' },
      )
    const included = await run(false)
    expect(included.windows_matched).toBe(1)

    const excluded = await run(true)
    expect(excluded.windows_matched).toBe(0)
    expect(excluded.baseline).toMatchObject({ mean: 50 })
    expect(excluded.flagged_exclusion).toMatchObject({ excluded_days: 3, excluded_points: 4 })
  })

  test('activity impact drops the occurrences in a flagged window', async () => {
    const user = getTestUser()
    const run = (excludeFlagged: boolean) =>
      getActivityImpact(
        user,
        'gathering',
        'activity_type',
        30,
        90,
        undefined,
        at('2026-05-19T00:00:00Z'),
        at('2026-04-20T00:00:00Z'),
        'exact',
        [],
        {},
        { excludeFlagged },
      )
    expect((await run(false)).occurrences).toBe(1)
    const excluded = await run(true)
    expect(excluded.occurrences).toBe(0)
    expect(excluded.flagged_exclusion?.excluded_points).toBe(1)
  })

  test('HRV correlations leave out the samples and activities in a flagged window', async () => {
    const user = getTestUser()
    const now = Date.now()
    await insertActivity(user, {
      activity_type: 'gathering',
      data: { exclude_from_baseline: true },
      end_time: new Date(now - 2 * DAY_MS),
      source: 'manual',
      start_time: new Date(now - 3 * DAY_MS),
    })
    await insertTimeSeries(user, [
      { metric: 'heart_rate', source: 'garmin', time: new Date(now - 2.5 * DAY_MS), value: 120 },
      { metric: 'heart_rate', source: 'garmin', time: new Date(now - 5 * DAY_MS), value: 60 },
    ])

    const included = await getHrvActivitiesCorrelation(user, 10)
    expect(included.correlations.activities.map((a) => a.activity_type)).toContain('gathering')

    const excluded = await getHrvActivitiesCorrelation(user, 10, undefined, 'hrv_rmssd', 30, [], {
      excludeFlagged: true,
    })
    expect(excluded.correlations.activities.map((a) => a.activity_type)).not.toContain('gathering')
    expect(excluded.baseline.mean_hr).toBe(60)
    expect(excluded.flagged_exclusion?.excluded_points).toBe(2)
  })
})
