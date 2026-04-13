import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
/**
 * Integration test for Garmin activity detail resync flow.
 *
 * Tests processActivityDetail against a real PostgreSQL instance with PostGIS,
 * using a real (trimmed) Garmin API response as fixture.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { GarminActivityDetailResponse } from './garmin.ts'

import { getTimeSeries, insertLocations, insertRawRecord, insertTimeSeries } from './db/index.ts'
import { softDeleteLocationRange } from './db/locations.ts'
import { processActivityDetail } from './garmin-process.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from './test/db-test-helper.ts'

const garminDetailFixture = JSON.parse(
  readFileSync(resolve(__dirname, 'test/fixtures/garmin-activity-detail.json'), 'utf-8'),
) as GarminActivityDetailResponse

const CONTAINER_TIMEOUT = 60_000

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
    deleteGarminActivityWithWrongType: async () => null as string | null,
    insertActivity: async () => {},
    insertLocations,
    insertRawRecord,
    insertTimeSeries,
    softDeleteLocationRange,
  }

  test('processActivityDetail inserts time series and GPS from real Garmin response', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse

    const points = await processActivityDetail(user, data, realDeps)

    // Should have extracted per-second metrics (HR, speed, elevation, etc.)
    expect(points).toBeGreaterThan(0)

    // Verify time series data was actually inserted into the DB
    const latIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLatitude')
    const lonIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLongitude')
    expect(latIdx).toBeGreaterThanOrEqual(0)
    expect(lonIdx).toBeGreaterThanOrEqual(0)

    // Check heart rate time series was stored
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

    // Verify the first HR value matches the fixture
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

    await processActivityDetail(user, data, realDeps)

    // The fixture has directLatitude/directLongitude in metrics — GPS should be extracted
    // GPS is downsampled to ~1 point per minute, so 120 seconds of data = ~2 GPS points
    const latIdx = data.metricDescriptors.findIndex((d) => d.key === 'directLatitude')
    expect(latIdx).toBeGreaterThanOrEqual(0)

    // Query locations from DB to verify GPS was inserted
    const { query } = await import('./db/connection.ts')
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

  test('processActivityDetail is idempotent (can be called twice)', async () => {
    const user = getTestUser()
    const data = garminDetailFixture as unknown as GarminActivityDetailResponse

    const points1 = await processActivityDetail(user, data, realDeps)
    const points2 = await processActivityDetail(user, data, realDeps)

    expect(points1).toBe(points2)
  })

  test('insertLocations works with Garmin GPS points (no regions)', async () => {
    const user = getTestUser()

    // Simulate what extractGpsPoint produces — no regions field
    await insertLocations(user, [
      { lat: 57.65, lon: 12.62, source: 'garmin', time: new Date('2024-04-10T11:11:33Z') },
      { lat: 57.66, lon: 12.63, source: 'garmin', time: new Date('2024-04-10T11:12:33Z') },
    ])

    const { query } = await import('./db/connection.ts')
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
