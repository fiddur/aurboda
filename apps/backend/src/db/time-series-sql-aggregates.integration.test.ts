import type { DataSource, HrZoneSecs, HrZoneThresholds } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { TimeSeriesPoint } from './types.ts'

import { computeHrZoneSecs } from '../services/settings.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import {
  deleteTimeSeriesPoint,
  getHrZoneSecs,
  getLatestTimeSeriesValue,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesBucketedAvgForWindows,
  getTimeSeriesWithSource,
  type HrZoneBucket,
  insertTimeSeries,
} from './time-series.ts'

const CONTAINER_TIMEOUT = 120_000

const ZONES: HrZoneThresholds = { 1: 100, 2: 120, 3: 140, 4: 160, 5: 180 }

/** The JS bucketing chart-data used before the zone computation moved into SQL. */
const HR_ZONE_BIN_ORIGIN = Date.UTC(2000, 0, 1)
const utcBucketStart = (t: Date, bucketSize: string): Date => {
  const bin = (intervalMs: number): Date =>
    new Date(HR_ZONE_BIN_ORIGIN + Math.floor((t.getTime() - HR_ZONE_BIN_ORIGIN) / intervalMs) * intervalMs)
  switch (bucketSize) {
    case '1m':
      return bin(60_000)
    case '5m':
      return bin(5 * 60_000)
    case '15m':
      return bin(15 * 60_000)
    case '1h':
      return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate(), t.getUTCHours()))
    case '1w': {
      const d = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
      d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7))
      return d
    }
    case '1M':
      return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), 1))
    default:
      return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()))
  }
}

type ZoneRow = { bucket_start: Date | null; sample_count: number; secs: HrZoneSecs }

/** `computeHrZoneSecs` over the same rows, ordered by (time, source) as the SQL breaks ties. */
const referenceHrZoneSecs = async (
  user: string,
  start: Date,
  end: Date,
  bucket: HrZoneBucket,
): Promise<ZoneRow[]> => {
  const rows = (await getTimeSeriesWithSource(user, 'heart_rate', start, end)).sort(
    (a, b) => a.time.getTime() - b.time.getTime() || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0),
  )
  const points: [Date, number][] = rows.map((r) => [r.time, r.value])
  if (points.length === 0) return []
  if (bucket === 'none') {
    return [{ bucket_start: null, sample_count: points.length, secs: computeHrZoneSecs(points, ZONES) }]
  }
  const groups = new Map<number, [Date, number][]>()
  for (const point of points) {
    const key = utcBucketStart(point[0], bucket).getTime()
    groups.set(key, [...(groups.get(key) ?? []), point])
  }
  return [...groups.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => ({
      bucket_start: new Date(key),
      sample_count: group.length,
      secs: computeHrZoneSecs(group, ZONES),
    }))
}

const expectSameZoneRows = (actual: ZoneRow[], expected: ZoneRow[]) => {
  expect(actual.map((r) => [r.bucket_start?.toISOString() ?? null, r.sample_count])).toEqual(
    expected.map((r) => [r.bucket_start?.toISOString() ?? null, r.sample_count]),
  )
  actual.forEach((row, i) => {
    for (const zone of [0, 1, 2, 3, 4, 5] as const) {
      expect(row.secs[zone]).toBeCloseTo(expected[i]!.secs[zone], 9)
    }
  })
}

const hr = (iso: string, value: number, source: DataSource = 'garmin'): TimeSeriesPoint => ({
  metric: 'heart_rate',
  source,
  time: new Date(iso),
  value,
})

/** Deterministic irregular series: gaps of 0.25 s to 150 s, values sweeping every zone. */
const irregularSeries = (fromIso: string, count: number): TimeSeriesPoint[] => {
  let seed = 7
  const next = () => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }
  const points: TimeSeriesPoint[] = []
  let t = new Date(fromIso).getTime()
  for (let i = 0; i < count; i++) {
    points.push(hr(new Date(t).toISOString(), Math.round(70 + next() * 140)))
    t += Math.max(250, Math.round(next() * 150_000))
  }
  return points
}

describe('Time series SQL aggregates', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('getHrZoneSecs', () => {
    const start = new Date('2024-01-28T00:00:00Z')
    const end = new Date('2024-02-02T00:00:00Z')

    const seed = async (user: string) => {
      await insertTimeSeries(user, [
        // Outside the range on both sides, and exactly on both ends (inclusive)
        hr('2024-01-27T23:59:59.999Z', 150),
        hr('2024-01-28T00:00:00.000Z', 110),
        hr('2024-02-02T00:00:00.000Z', 190),
        hr('2024-02-02T00:00:00.001Z', 150),
        // Irregular gaps, many > 60 s, straddling 1m/5m/15m/1h boundaries
        ...irregularSeries('2024-01-28T10:52:13.250Z', 300),
        // Exactly on every threshold, and just below
        hr('2024-01-29T12:00:00Z', 99.999),
        hr('2024-01-29T12:00:01Z', 100),
        hr('2024-01-29T12:00:02Z', 120),
        hr('2024-01-29T12:00:03Z', 140),
        hr('2024-01-29T12:00:04Z', 160),
        hr('2024-01-29T12:00:05Z', 180),
        hr('2024-01-29T12:00:06Z', 179.999),
        // Duplicates across two sources at one timestamp: same zone, then different zones
        hr('2024-01-29T13:00:00Z', 125, 'garmin'),
        hr('2024-01-29T13:00:00Z', 130, 'health_connect'),
        hr('2024-01-29T13:00:10Z', 90, 'garmin'),
        hr('2024-01-29T13:00:10Z', 185, 'health_connect'),
        hr('2024-01-29T13:00:40Z', 150),
        // Straddling the Sunday→Monday week boundary (also day and hour)
        hr('2024-01-28T23:59:30Z', 150),
        hr('2024-01-28T23:59:50Z', 155),
        hr('2024-01-29T00:00:10Z', 165),
        hr('2024-01-29T00:00:40Z', 170),
        // Straddling the January→February month boundary
        hr('2024-01-31T23:59:20Z', 95),
        hr('2024-01-31T23:59:59.500Z', 105),
        hr('2024-02-01T00:00:30Z', 115),
        hr('2024-02-01T00:02:00Z', 125),
        // Straddling a 5-minute boundary within an hour
        hr('2024-02-01T08:04:40Z', 135),
        hr('2024-02-01T08:05:05Z', 145),
        // A lone sample: its own bucket at every size up to a day
        hr('2024-01-30T15:42:00Z', 165),
        // Soft-deleted below, and another metric that must not count
        hr('2024-01-29T12:00:03.500Z', 200),
        { metric: 'hrv_rmssd', source: 'garmin', time: new Date('2024-01-29T12:00:03.700Z'), value: 190 },
      ])
      await deleteTimeSeriesPoint(user, 'heart_rate', new Date('2024-01-29T12:00:03.500Z'), 'garmin')
    }

    const buckets: HrZoneBucket[] = ['none', '1m', '5m', '15m', '1h', '1d', '1w', '1M']
    for (const bucket of buckets) {
      test(`equals computeHrZoneSecs grouped by the old bucketing for '${bucket}'`, async () => {
        const user = getTestUser()
        await seed(user)

        const expected = await referenceHrZoneSecs(user, start, end, bucket)
        const actual = await getHrZoneSecs(user, start, end, ZONES, bucket)

        expect(expected.length).toBeGreaterThan(0)
        expectSameZoneRows(actual, expected)
      })
    }

    test('fixture exercises the single-sample and capped-gap branches', async () => {
      const user = getTestUser()
      await seed(user)

      const minutes = await getHrZoneSecs(user, start, end, ZONES, '1m')
      const lone = minutes.find((r) => r.bucket_start?.toISOString() === '2024-01-30T15:42:00.000Z')
      expect(lone).toEqual({
        bucket_start: new Date('2024-01-30T15:42:00Z'),
        sample_count: 1,
        secs: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 1, 5: 0 },
      })
      const [all] = await getHrZoneSecs(user, start, end, ZONES)
      const total = Object.values(all!.secs).reduce((a, b) => a + b, 0)
      expect(all!.sample_count).toBe((await getTimeSeries(user, 'heart_rate', start, end)).length)
      // Capped at 60 s per sample, and the range spans days, so the gaps must have been capped
      expect(total).toBeLessThanOrEqual(all!.sample_count * 60)
      expect(total).toBeLessThan((end.getTime() - start.getTime()) / 1000)
    })

    test('a single sample counts one second', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [hr('2024-01-29T12:00:00Z', 181)])

      expect(await getHrZoneSecs(user, start, end, ZONES)).toEqual([
        { bucket_start: null, sample_count: 1, secs: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 1 } },
      ])
    })

    test('an empty range returns no rows, bucketed or not', async () => {
      const user = getTestUser()
      await insertTimeSeries(user, [hr('2024-03-01T00:00:00Z', 150)])

      expect(await getHrZoneSecs(user, start, end, ZONES)).toEqual([])
      expect(await getHrZoneSecs(user, start, end, ZONES, '1d')).toEqual([])
    })
  })

  describe('getTimeSeriesBucketedAvgForWindows', () => {
    const seed = async (user: string) => {
      await insertTimeSeries(user, [
        ...irregularSeries('2024-01-15T09:58:00Z', 200),
        hr('2024-01-15T10:10:00Z', 100, 'health_connect'),
        { metric: 'steps', source: 'aurboda', time: new Date('2024-01-15T10:01:00Z'), value: 10 },
        { metric: 'steps', source: 'aurboda', time: new Date('2024-01-15T10:07:00Z'), value: 20 },
        { metric: 'steps', source: 'garmin', time: new Date('2024-01-15T10:03:00Z'), value: 999 },
      ])
    }

    const windows = [
      { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T10:00:00Z') },
      // Overlaps the first, unaligned to the 5-minute grid
      { end: new Date('2024-01-15T10:47:31Z'), start: new Date('2024-01-15T10:02:17.500Z') },
      // No samples
      { end: new Date('2024-01-16T01:00:00Z'), start: new Date('2024-01-16T00:00:00Z') },
      // Identical to the first
      { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T10:00:00Z') },
      { end: new Date('2024-01-15T13:30:00Z'), start: new Date('2024-01-15T12:03:00Z') },
    ]

    test('equals getTimeSeriesBucketed per window', async () => {
      const user = getTestUser()
      await seed(user)

      const actual = await getTimeSeriesBucketedAvgForWindows(user, 'heart_rate', windows, '5 minutes')
      const expected = await Promise.all(
        windows.map(async (w) =>
          (await getTimeSeriesBucketed(user, ['heart_rate'], w.start, w.end, '5 minutes')).map(
            (b) => [b.bucket_start, b.avg] as [Date, number],
          ),
        ),
      )

      expect(actual).toHaveLength(windows.length)
      expect(actual[2]).toEqual([])
      expect(actual[0]!.length).toBeGreaterThan(0)
      expect(actual.map((s) => s.map(([t]) => t.toISOString()))).toEqual(
        expected.map((s) => s.map(([t]) => t.toISOString())),
      )
      actual.forEach((series, i) =>
        series.forEach(([, avg], j) => expect(avg).toBeCloseTo(expected[i]![j]![1], 9)),
      )
    })

    test('applies the cumulative source filter like getTimeSeriesBucketed', async () => {
      const user = getTestUser()
      await seed(user)
      const window = { end: new Date('2024-01-15T11:00:00Z'), start: new Date('2024-01-15T10:00:00Z') }

      const [actual] = await getTimeSeriesBucketedAvgForWindows(user, 'steps', [window], '5 minutes')
      const expected = (
        await getTimeSeriesBucketed(user, ['steps'], window.start, window.end, '5 minutes')
      ).map((b) => [b.bucket_start, b.avg] as [Date, number])

      expect(actual).toEqual(expected)
      expect(actual).toEqual([
        [new Date('2024-01-15T10:00:00Z'), 10],
        [new Date('2024-01-15T10:05:00Z'), 20],
      ])
    })

    test('no windows → no query, no series', async () => {
      expect(await getTimeSeriesBucketedAvgForWindows(getTestUser(), 'heart_rate', [], '5 minutes')).toEqual(
        [],
      )
    })
  })

  describe('getLatestTimeSeriesValue', () => {
    test('equals the last value getTimeSeries returns for [since, now]', async () => {
      const user = getTestUser()
      const now = Date.now()
      const at = (hoursAgo: number) => new Date(now - hoursAgo * 3600_000)
      await insertTimeSeries(user, [
        { metric: 'resting_heart_rate', source: 'garmin', time: at(24 * 40), value: 40 },
        { metric: 'resting_heart_rate', source: 'garmin', time: at(48), value: 52 },
        { metric: 'resting_heart_rate', source: 'oura', time: at(24), value: 55 },
        { metric: 'resting_heart_rate', source: 'garmin', time: at(2), value: 70 },
        { metric: 'resting_heart_rate', source: 'garmin', time: at(-5), value: 99 },
        { metric: 'heart_rate', source: 'garmin', time: at(1), value: 120 },
      ])
      await deleteTimeSeriesPoint(user, 'resting_heart_rate', at(2), 'garmin')
      const since = at(24 * 30)

      const series = await getTimeSeries(user, 'resting_heart_rate', since, new Date())
      expect(await getLatestTimeSeriesValue(user, 'resting_heart_rate', since)).toBe(series.at(-1)![1])
      expect(series.at(-1)![1]).toBe(55)
    })

    test('respects the source filter, and is undefined without data', async () => {
      const user = getTestUser()
      const now = Date.now()
      await insertTimeSeries(user, [
        { metric: 'steps', source: 'aurboda', time: new Date(now - 7200_000), value: 100 },
        { metric: 'steps', source: 'garmin', time: new Date(now - 3600_000), value: 999 },
      ])
      const since = new Date(now - 86_400_000)

      expect(await getLatestTimeSeriesValue(user, 'steps', since)).toBe(100)
      expect(await getLatestTimeSeriesValue(user, 'resting_heart_rate', since)).toBeUndefined()
    })
  })
})
