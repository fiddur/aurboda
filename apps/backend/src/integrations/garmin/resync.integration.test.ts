import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
/**
 * Tests processActivityDetail against a real PostgreSQL instance with PostGIS,
 * using a real (trimmed) Garmin API response as fixture.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { GarminActivityDetailResponse } from './client.ts'
import type { FitActivity } from './fit.ts'

import {
  activityTypeExists,
  adoptLegacyActivity,
  getActivityTrack,
  getTimeSeries,
  getTimeSeriesWithSource,
  hasRawRecord,
  insertActivity,
  insertLocations,
  insertRawRecord,
  insertTimeSeries,
  replaceTimeSeriesInWindow,
} from '../../db/index.ts'
import { softDeleteSupersededLocations } from '../../db/locations.ts'
import { upsertActivityTrack } from '../../db/tracks.ts'
import { auditError, auditInfo, auditWarn } from '../../services/audit-log.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { extractTrackPoints, processActivityDetail, processActivityFit } from './process.ts'

const garminDetailFixture = JSON.parse(
  readFileSync(resolve(__dirname, '../../test/fixtures/garmin-activity-detail.json'), 'utf-8'),
) as GarminActivityDetailResponse

const CONTAINER_TIMEOUT = 120_000

describe('Garmin resync integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  const realDeps = {
    activityTypeExists,
    adoptLegacyActivity,
    auditError,
    auditInfo,
    auditWarn,
    deleteGarminActivityWithWrongType: async () => null as string | null,
    insertActivity: async () => '' as string,
    insertLocations,
    insertRawRecord,
    insertTimeSeries,
    softDeleteSupersededLocations,
    upsertActivityTrack,
  }

  test('processActivityDetail inserts time series and GPS from real Garmin response', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse

    const points = await processActivityDetail(user, data, { deps: realDeps })

    expect(points).toBeGreaterThan(0)

    const latIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLatitude')
    const lonIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLongitude')
    expect(latIdx).toBeGreaterThanOrEqual(0)
    expect(lonIdx).toBeGreaterThanOrEqual(0)

    const firstMetrics = data.activityDetailMetrics[0].metrics
    const tsIdx = data.metricDescriptors.findIndex((d) => d.key === 'directTimestamp')
    const hrIdx = data.metricDescriptors.findIndex((d) => d.key === 'directHeartRate')
    const firstTs =
      typeof firstMetrics[tsIdx] === 'object'
        ? (firstMetrics[tsIdx] as { parsedValue: number }).parsedValue
        : (firstMetrics[tsIdx] as number)
    const lastEntry = data.activityDetailMetrics[data.activityDetailMetrics.length - 1].metrics
    const lastTs =
      typeof lastEntry[tsIdx] === 'object'
        ? (lastEntry[tsIdx] as { parsedValue: number }).parsedValue
        : (lastEntry[tsIdx] as number)

    const hrData = await getTimeSeries(user, 'heart_rate', new Date(firstTs - 1000), new Date(lastTs + 1000))
    expect(hrData.length).toBeGreaterThan(0)

    const expectedHr =
      typeof firstMetrics[hrIdx] === 'object'
        ? (firstMetrics[hrIdx] as { parsedValue: number }).parsedValue
        : (firstMetrics[hrIdx] as number)
    if (expectedHr > 0) {
      expect(hrData[0][1]).toBe(expectedHr)
    }
  })

  test('processActivityDetail extracts GPS from per-second metrics', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse

    await processActivityDetail(user, data, { deps: realDeps })

    // The fixture has directLatitude/directLongitude in metrics — GPS should be extracted
    // GPS is downsampled to ~1 point per minute, so 120 seconds of data = ~2 GPS points
    const latIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLatitude')
    expect(latIdx).toBeGreaterThanOrEqual(0)

    const { query } = await import('../../db/connection.ts')
    const result = await query(
      user,
      `SELECT source, time, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon
       FROM locations WHERE source = 'garmin' ORDER BY time`,
      [],
    )

    expect(result.rows.length).toBeGreaterThan(0)
    // Verify coordinates are in the expected area (Bollebygd, Sweden ~57.65°N, 12.62°E)
    const firstLoc = result.rows[0]
    expect(Number(firstLoc.lat)).toBeCloseTo(57.65, 1)
    expect(Number(firstLoc.lon)).toBeCloseTo(12.63, 1)
  })

  test('processActivityDetail writes the full-resolution track for the activity', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse
    const samples = extractTrackPoints(data)
    const start = samples[0]!.time
    const activityId = await insertActivity(user, {
      activity_type: 'running',
      data: { garmin_activity_id: data.activityId },
      end_time: samples[samples.length - 1]!.time,
      external_id: `garmin-test-${data.activityId}`,
      source: 'garmin',
      start_time: start,
    })

    await processActivityDetail(user, data, {
      activityId,
      activitySpan: { end: samples[samples.length - 1]!.time, start },
      activityStart: start,
      deps: realDeps,
    })
    await processActivityDetail(user, data, { activityId, activityStart: start, deps: realDeps })

    const track = await getActivityTrack(user, activityId)
    expect(track).toMatchObject({ activity_id: activityId, full_resolution: true, source: 'garmin' })
    expect(track!.point_count).toBe(new Set(samples.map((p) => p.time.getTime())).size)
    expect(track!.points[0]!.t).toBe(0)
    expect(track!.points[0]!.lat).toBeCloseTo(57.65, 1)
    expect(track!.length_m).toBeGreaterThan(0)
  })

  test('processActivityDetail is idempotent (can be called twice)', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse

    const points1 = await processActivityDetail(user, data, { deps: realDeps })
    const points2 = await processActivityDetail(user, data, { deps: realDeps })

    expect(points1).toBe(points2)
  })

  test('a FIT re-sync of a JSON-synced activity replaces its samples of the metrics the file has', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse
    const start = extractTrackPoints(data)[0]!.time
    const at = (offsetMs: number) => new Date(start.getTime() + offsetMs)
    await processActivityDetail(user, data, { deps: realDeps })
    const jsonHr = await getTimeSeriesWithSource(user, 'heart_rate', at(-600_000), at(3_600_000))
    expect(jsonHr.length).toBeGreaterThan(2)
    const span = { end: jsonHr.at(-1)!.time, start: jsonHr[0]!.time }
    const bodyBattery = await getTimeSeries(user, 'body_battery', at(-600_000), at(3_600_000))
    const outside = at(-3_600_000)
    await insertTimeSeries(user, [
      { metric: 'heart_rate', source: 'garmin', time: outside, value: 61 },
      { metric: 'heart_rate', source: 'oura', time: at(10_500), value: 62 },
    ])

    const fit = {
      exerciseTitles: [],
      fileIds: [],
      laps: [],
      records: [
        { heartRate: 140, timestamp: at(10_250) },
        { heartRate: 150, timestamp: at(20_250) },
      ],
      sessions: [],
      sets: [],
    } as unknown as FitActivity
    const fitDeps = { ...realDeps, fitReplace: { hasRawRecord, replaceTimeSeriesInWindow } }
    const options = { activitySpan: span, activityStart: start, deps: fitDeps }
    await processActivityFit(user, { fit, garminActivityId: data.activityId }, options)
    await processActivityFit(user, { fit, garminActivityId: data.activityId }, options)

    const hr = await getTimeSeriesWithSource(user, 'heart_rate', at(-7_200_000), at(3_600_000))
    expect(hr.map((p) => [p.time.getTime() - start.getTime(), p.value, p.source])).toEqual([
      [-3_600_000, 61, 'garmin'],
      [10_250, 140, 'garmin'],
      [10_500, 62, 'oura'],
      [20_250, 150, 'garmin'],
    ])
    expect(await getTimeSeries(user, 'body_battery', at(-600_000), at(3_600_000))).toEqual(bodyBattery)
  })

  test('a FIT sync of an activity never synced through the JSON detail adds to what is there', async () => {
    const user = getTestUser()
    const start = new Date('2026-05-01T08:00:00Z')
    await insertTimeSeries(user, [{ metric: 'heart_rate', source: 'garmin', time: start, value: 70 }])
    const fit = {
      exerciseTitles: [],
      fileIds: [],
      laps: [],
      records: [{ heartRate: 140, timestamp: new Date(start.getTime() + 1000) }],
      sessions: [],
      sets: [],
    } as unknown as FitActivity

    await processActivityFit(
      user,
      { fit, garminActivityId: 1 },
      {
        activitySpan: { end: new Date(start.getTime() + 60_000), start },
        activityStart: start,
        deps: { ...realDeps, fitReplace: { hasRawRecord, replaceTimeSeriesInWindow } },
      },
    )

    const hr = await getTimeSeries(user, 'heart_rate', start, new Date(start.getTime() + 60_000))
    expect(hr.map(([, value]) => value)).toEqual([70, 140])
  })

  test('insertLocations works with Garmin GPS points (no regions)', async () => {
    const user = getTestUser()

    // Simulate what extractGpsPoint produces — no regions field
    await insertLocations(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date('2024-04-10T11:11:33Z') },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date('2024-04-10T11:12:33Z') },
    ])

    const { query } = await import('../../db/connection.ts')
    const result = await query(
      user,
      `SELECT source, ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon FROM locations ORDER BY time`,
      [],
    )

    expect(result.rows).toHaveLength(2)
    expect(Number(result.rows[0].lat)).toBeCloseTo(57.65, 4)
    expect(Number(result.rows[0].lon)).toBeCloseTo(12.62, 4)
  })
})
