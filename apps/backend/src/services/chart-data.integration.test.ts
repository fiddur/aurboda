import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { query } from '../db/connection.ts'
import { insertActivity, insertActivityTypeDefinition, insertTimeSeries } from '../db/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getChartData } from './chart-data.ts'
import { createDefaultEngineDeps } from './deduction-deps.ts'
import { createCategory } from './screentime-categories.ts'
import { getTrend } from './trends.ts'

const CONTAINER_TIMEOUT = 120_000

const span = (activity_type: string, category_path: string, start: string, end: string) => ({
  activity_type,
  data: { category_path },
  end_time: new Date(end),
  source: 'activitywatch' as const,
  start_time: new Date(start),
})

beforeAll(async () => {
  await startTestDb()
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await stopTestDb()
})

describe('screentime category chart data', () => {
  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  test('buckets spans stored under per-category types and the legacy umbrella type', async () => {
    const user = getTestUser()
    await createCategory(user, { name: ['Work'], rule_type: 'none' })
    const child = await createCategory(user, { name: ['Work', 'Dev'], rule_regex: 'vim', rule_type: 'regex' })
    const other = await createCategory(user, { name: ['Games'], rule_regex: 'steam', rule_type: 'regex' })

    await insertActivity(
      user,
      span(child.activity_type_name!, 'Work > Dev', '2026-06-01T08:00:00Z', '2026-06-01T09:00:00Z'),
    )
    await insertActivity(user, span('screentime', 'Work', '2026-06-01T10:00:00Z', '2026-06-01T10:30:00Z'))
    await insertActivity(
      user,
      span(other.activity_type_name!, 'Games', '2026-06-01T11:00:00Z', '2026-06-01T12:00:00Z'),
    )

    const result = await getChartData(user, {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-02T00:00:00Z',
      pattern: 'Work',
      source_type: 'productivity_category',
      start: '2026-06-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 1.5 }])
  })

  test('ignores non-screentime activities of a linked type without a matching category_path', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Porn'], rule_regex: 'x', rule_type: 'regex' })
    await insertActivity(
      user,
      span(cat.activity_type_name!, 'Porn', '2026-06-01T08:00:00Z', '2026-06-01T08:15:00Z'),
    )
    await insertActivity(user, {
      activity_type: cat.activity_type_name!,
      end_time: new Date('2026-06-01T09:00:00Z'),
      source: 'manual',
      start_time: new Date('2026-06-01T08:30:00Z'),
    })

    const result = await getChartData(user, {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-02T00:00:00Z',
      pattern: 'Porn',
      source_type: 'productivity_category',
      start: '2026-06-01T00:00:00Z',
    })

    expect(result.buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 0.25 }])
  })

  test('keeps spans of a deleted category in the bar chart and the deduction condition', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Old'], rule_regex: 'x', rule_type: 'regex' })
    await insertActivity(
      user,
      span(cat.activity_type_name!, 'Old', '2026-06-01T08:00:00Z', '2026-06-01T09:00:00Z'),
    )
    await query(user, `DELETE FROM screentime_categories WHERE id = $1`, [cat.id])

    const result = await getChartData(user, {
      aggregation: 'sum',
      bucket_size: '1d',
      end: '2026-06-02T00:00:00Z',
      pattern: 'Old',
      source_type: 'productivity_category',
      start: '2026-06-01T00:00:00Z',
    })
    const ranges = await createDefaultEngineDeps().getScreentime(user, ['Old'], {
      end: new Date('2026-06-02T00:00:00Z'),
      start: new Date('2026-06-01T00:00:00Z'),
    })

    expect(result.buckets).toEqual([{ bucket_start: '2026-06-01T00:00:00.000Z', value: 1 }])
    expect(ranges).toHaveLength(1)
  })

  test('productivity_category trend reads spans from activities', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Work'], rule_type: 'none' })
    const today = new Date()
    today.setUTCHours(0, 0, 0, 0)
    const start = new Date(today.getTime() - 2 * 86_400_000 + 8 * 3_600_000)
    await insertActivity(
      user,
      span(
        cat.activity_type_name!,
        'Work',
        start.toISOString(),
        new Date(start.getTime() + 7_200_000).toISOString(),
      ),
    )
    const productivity = await query(user, `SELECT COUNT(*)::int AS n FROM productivity`)
    expect(productivity.rows[0].n).toBe(0)

    const trend = await getTrend(user, {
      display_period: 'daily',
      lookback_days: 7,
      pattern: 'Work',
      source_type: 'productivity_category',
    })

    expect(trend.history.some((p) => p.value > 0)).toBe(true)
    expect(trend.current_value).toBeGreaterThan(0)
  })

  test('deduction screentime condition sees per-category typed spans', async () => {
    const user = getTestUser()
    const cat = await createCategory(user, { name: ['Porn'], rule_regex: 'x', rule_type: 'regex' })
    await insertActivity(
      user,
      span(cat.activity_type_name!, 'Porn', '2026-06-01T08:00:00Z', '2026-06-01T08:15:00Z'),
    )

    const ranges = await createDefaultEngineDeps().getScreentime(user, ['Porn'], {
      end: new Date('2026-06-02T00:00:00Z'),
      start: new Date('2026-06-01T00:00:00Z'),
    })

    expect(ranges).toHaveLength(1)
  })
})

describe('chart data local-time buckets', () => {
  beforeEach(async () => {
    await cleanTestDb()
    await query(getTestUser(), `DELETE FROM activity_type_definitions WHERE is_builtin = false`)
  })

  // 00:30 local on Sat 28 Mar (CET), Sun 29 Mar (CET, the spring-forward day) and Mon 30 Mar (CEST).
  const times = ['2026-03-27T23:30:00Z', '2026-03-28T23:30:00Z', '2026-03-29T22:30:00Z']
  const window = { end: '2026-04-01T00:00:00Z', start: '2026-03-20T00:00:00Z' }
  const halfHourLater = (iso: string) => new Date(new Date(iso).getTime() + 30 * 60_000).toISOString()

  const seed = async (user: string) => {
    const cat = await createCategory(user, { name: ['Work'], rule_type: 'none' })
    await insertActivityTypeDefinition(user, {
      display_category: 'other',
      display_name: 'Coffee',
      name: 'coffee',
    })
    for (const t of times) {
      await insertActivity(user, {
        activity_type: 'coffee',
        data: { size: 'large' },
        end_time: new Date(halfHourLater(t)),
        source: 'manual',
        start_time: new Date(t),
      })
      await insertActivity(user, span(cat.activity_type_name!, 'Work', t, halfHourLater(t)))
    }
    await insertTimeSeries(
      user,
      times.map((t) => ({ metric: 'weight', source: 'manual' as const, time: new Date(t), value: 70 })),
    )
  }

  const sources = [
    { aggregation: 'count', pattern: 'coffee', source_type: 'tag', value: 1 },
    { aggregation: 'count', pattern: 'coffee', source_type: 'activity_type', value: 1 },
    { aggregation: 'count', pattern: 'weight', source_type: 'metric', value: 1 },
    { aggregation: 'sum', pattern: 'Work', source_type: 'productivity_category', value: 0.5 },
  ] as const

  const values = (buckets: unknown[]) =>
    (buckets as { bucket_start: string; value: number }[]).map((b) => [b.bucket_start, b.value])

  for (const src of sources) {
    test(`${src.source_type}: daily buckets split at local midnight with tz, UTC midnight without`, async () => {
      const user = getTestUser()
      await seed(user)
      const input = { ...window, ...src, bucket_size: '1d' as const }

      const utc = await getChartData(user, input)
      const explicitUtc = await getChartData(user, { ...input, tz: 'UTC' })
      const local = await getChartData(user, { ...input, tz: 'Europe/Stockholm' })

      expect(values(utc.buckets)).toEqual([
        ['2026-03-27T00:00:00.000Z', src.value],
        ['2026-03-28T00:00:00.000Z', src.value],
        ['2026-03-29T00:00:00.000Z', src.value],
      ])
      expect(explicitUtc).toEqual(utc)
      expect(values(local.buckets)).toEqual([
        ['2026-03-27T23:00:00.000Z', src.value],
        ['2026-03-28T23:00:00.000Z', src.value],
        ['2026-03-29T22:00:00.000Z', src.value],
      ])
    })

    test(`${src.source_type}: weekly buckets start on local Monday`, async () => {
      const user = getTestUser()
      await seed(user)
      const input = { ...window, ...src, bucket_size: '1w' as const }

      const utc = await getChartData(user, input)
      const local = await getChartData(user, { ...input, tz: 'Europe/Stockholm' })

      expect(values(utc.buckets)).toEqual([['2026-03-23T00:00:00.000Z', 3 * src.value]])
      expect(values(local.buckets)).toEqual([
        ['2026-03-22T23:00:00.000Z', 2 * src.value],
        ['2026-03-29T22:00:00.000Z', src.value],
      ])
    })
  }

  test('activity_type breakdown buckets by local day', async () => {
    const user = getTestUser()
    await seed(user)
    const input = {
      ...window,
      aggregation: 'count' as const,
      breakdown_fields: ['size'],
      bucket_size: '1d' as const,
      pattern: 'coffee',
      source_type: 'activity_type' as const,
    }

    const local = await getChartData(user, { ...input, tz: 'Europe/Stockholm' })

    expect(local.buckets).toEqual([
      { bucket_start: '2026-03-27T23:00:00.000Z', series: { large: 1 } },
      { bucket_start: '2026-03-28T23:00:00.000Z', series: { large: 1 } },
      { bucket_start: '2026-03-29T22:00:00.000Z', series: { large: 1 } },
    ])
    expect(await getChartData(user, { ...input, tz: 'UTC' })).toEqual(await getChartData(user, input))
  })

  test('hourly buckets follow the local hour in a half-hour offset zone', async () => {
    const user = getTestUser()
    await insertTimeSeries(user, [
      { metric: 'weight', source: 'manual', time: new Date('2026-01-10T10:29:00Z'), value: 70 },
      { metric: 'weight', source: 'manual', time: new Date('2026-01-10T10:31:00Z'), value: 71 },
    ])
    const input = {
      aggregation: 'count' as const,
      bucket_size: '1h' as const,
      end: '2026-01-11T00:00:00Z',
      pattern: 'weight',
      source_type: 'metric' as const,
      start: '2026-01-10T00:00:00Z',
    }

    expect(values((await getChartData(user, input)).buckets)).toEqual([['2026-01-10T10:00:00.000Z', 2]])
    expect(values((await getChartData(user, { ...input, tz: 'Asia/Kolkata' })).buckets)).toEqual([
      ['2026-01-10T09:30:00.000Z', 1],
      ['2026-01-10T10:30:00.000Z', 1],
    ])
  })
})
