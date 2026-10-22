import type { DataSource } from '@aurboda/api-spec'

import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity } from './activities/index.ts'
import { query } from './connection.ts'
import { insertRawRecord } from './raw-records.ts'
import {
  getActivityTrack,
  getGarminTrackBackfillCandidates,
  getStravaTrackBackfillCandidates,
  hasActivityTrack,
  upsertActivityTrack,
} from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const start = new Date('2026-07-01T08:00:00Z')
const end = new Date('2026-07-01T09:00:00Z')

const haversine = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * 6_371_008.8 * Math.asin(Math.sqrt(a))
}

const twoPoint = 'SRID=4326;LINESTRING ZM(18 59 10 0, 18 59.01 12.5 60)'

const addActivity = async (
  source: DataSource,
  externalId: string,
  data: Record<string, unknown>,
  startTime = start,
): Promise<string> =>
  insertActivity(getTestUser(), {
    activity_type: 'running',
    data,
    end_time: new Date(startTime.getTime() + 3_600_000),
    external_id: externalId,
    source,
    start_time: startTime,
  })

describe('Activity tracks integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('upsertActivityTrack / getActivityTrack', () => {
    test('round-trips points with altitude and seconds since start, and derives length and count', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-1', {})
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })

      const track = await getActivityTrack(user, id)
      expect(track).toMatchObject({
        activity_id: id,
        full_resolution: true,
        point_count: 2,
        source: 'garmin',
      })
      expect(track?.points).toEqual([
        { alt: 10, lat: 59, lon: 18, t: 0 },
        { alt: 12.5, lat: 59.01, lon: 18, t: 60 },
      ])
      const expected = haversine(59, 18, 59.01, 18)
      expect(Math.abs((track?.length_m ?? 0) - expected) / expected).toBeLessThan(0.01)
      expect(await hasActivityTrack(user, id, 'garmin')).toBe(true)
      expect(await hasActivityTrack(user, id, 'strava')).toBe(false)
    })

    test('upsert replaces the existing track for the same source', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-1', {})
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: 'SRID=4326;LINESTRING ZM(18 59 0 0, 18 59.01 0 30, 18 59.02 0 60)',
        full_resolution: false,
        source: 'garmin',
      })

      const track = await getActivityTrack(user, id)
      expect(track).toMatchObject({ full_resolution: false, point_count: 3 })
      const rows = await query(user, `SELECT count(*)::int AS n FROM activity_tracks`)
      expect(rows.rows[0].n).toBe(1)
    })

    test('is removed when the activity is deleted', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-1', {})
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })
      await query(user, `DELETE FROM activities WHERE id = $1`, [id])

      expect(await getActivityTrack(user, id)).toBeNull()
    })

    test('is not served for a soft-deleted activity', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-1', {})
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [id])

      expect(await getActivityTrack(user, id)).toBeNull()
    })

    test('prefers a full-resolution track, then the one with more points', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-1', {})
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: 'SRID=4326;LINESTRING ZM(18 59 0 0, 18 59.01 0 30, 18 59.02 0 60)',
        full_resolution: false,
        source: 'strava',
      })
      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })
      expect((await getActivityTrack(user, id))?.source).toBe('garmin')

      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: 'SRID=4326;LINESTRING ZM(18 59 0 0, 18 59.01 0 30, 18 59.02 0 60)',
        full_resolution: true,
        source: 'strava',
      })
      expect((await getActivityTrack(user, id))?.source).toBe('strava')
    })

    test('returns null when there is no track', async () => {
      const id = await addActivity('garmin', 'garmin-1', {})
      expect(await getActivityTrack(getTestUser(), id)).toBeNull()
    })
  })

  describe('getGarminTrackBackfillCandidates', () => {
    const detail = {
      activityDetailMetrics: [],
      activityId: 777,
      metricDescriptors: [{ key: 'directLatitude', metricsIndex: 0, unit: { key: 'dd' } }],
    }

    test('lists an activity with a stored detail and no track, until a track exists', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-act-777', { garmin_activity_id: 777 })
      await addActivity('garmin', 'garmin-act-888', { garmin_activity_id: 888 })
      await insertRawRecord(user, {
        data: detail,
        external_id: 'garmin-activity-detail-777',
        record_type: 'garmin_activity_detail',
        recorded_at: start,
        source: 'garmin',
      })

      const candidates = await getGarminTrackBackfillCandidates(user, { limit: 10 })
      expect(candidates).toEqual([{ activity_id: id, detail, end_time: end, start_time: start }])
      expect(await getGarminTrackBackfillCandidates(user, { after: start, limit: 10 })).toEqual([])

      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: true,
        source: 'garmin',
      })
      expect(await getGarminTrackBackfillCandidates(user, { limit: 10 })).toEqual([])
    })

    test('skips a detail without coordinates, lists one with only a polyline', async () => {
      const user = getTestUser()
      await addActivity('garmin', 'garmin-act-777', { garmin_activity_id: 777 })
      const polylineId = await addActivity('garmin', 'garmin-act-888', { garmin_activity_id: 888 })
      await insertRawRecord(user, {
        data: { activityDetailMetrics: [], activityId: 777, metricDescriptors: [{ key: 'directHeartRate' }] },
        external_id: 'garmin-activity-detail-777',
        record_type: 'garmin_activity_detail',
        recorded_at: start,
        source: 'garmin',
      })
      await insertRawRecord(user, {
        data: { activityId: 888, geoPolylineDTO: { polyline: [{ lat: 59.3, lon: 18.07, timestampGMT: 1 }] } },
        external_id: 'garmin-activity-detail-888',
        record_type: 'garmin_activity_detail',
        recorded_at: start,
        source: 'garmin',
      })
      const candidates = await getGarminTrackBackfillCandidates(user, { limit: 10 })
      expect(candidates.map((c) => c.activity_id)).toEqual([polylineId])
    })

    test('excludes deleted activities', async () => {
      const user = getTestUser()
      const id = await addActivity('garmin', 'garmin-act-777', { garmin_activity_id: 777 })
      await insertRawRecord(user, {
        data: detail,
        external_id: 'garmin-activity-detail-777',
        record_type: 'garmin_activity_detail',
        recorded_at: start,
        source: 'garmin',
      })
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [id])
      expect(await getGarminTrackBackfillCandidates(user, { limit: 10 })).toEqual([])
    })
  })

  describe('getStravaTrackBackfillCandidates', () => {
    const storeStrava = async (externalId: string, data: Record<string, unknown>): Promise<void> =>
      insertRawRecord(getTestUser(), {
        data,
        external_id: externalId,
        record_type: 'strava_activity',
        recorded_at: start,
        source: 'strava',
      })

    test('lists an activity with a polyline and no track, until a track exists', async () => {
      const user = getTestUser()
      const id = await addActivity('strava', 'strava-activity-1', { strava_activity_id: 1 })
      await storeStrava('strava-activity-1', {
        elapsed_time: 3600,
        map: { polyline: 'abc', summary_polyline: 'a' },
      })
      const summaryOnly = await addActivity('strava', 'strava-activity-2', {}, end)
      await storeStrava('strava-activity-2', {
        elapsed_time: 1800,
        map: { polyline: '', summary_polyline: 'xyz' },
      })
      await addActivity('strava', 'strava-activity-3', {}, new Date(end.getTime() + 3_600_000))
      await storeStrava('strava-activity-3', { elapsed_time: 1800, map: { summary_polyline: '' } })

      expect(await getStravaTrackBackfillCandidates(user, { limit: 10 })).toEqual([
        { activity_id: id, elapsed_seconds: 3600, polyline: 'abc', start_time: start },
        { activity_id: summaryOnly, elapsed_seconds: 1800, polyline: 'xyz', start_time: end },
      ])
      expect(await getStravaTrackBackfillCandidates(user, { limit: 1 })).toHaveLength(1)
      expect(await getStravaTrackBackfillCandidates(user, { after: start, limit: 10 })).toHaveLength(1)

      await upsertActivityTrack(user, {
        activity_id: id,
        ewkt: twoPoint,
        full_resolution: false,
        source: 'strava',
      })
      expect((await getStravaTrackBackfillCandidates(user, { limit: 10 })).map((c) => c.activity_id)).toEqual(
        [summaryOnly],
      )
    })

    test('excludes deleted activities', async () => {
      const user = getTestUser()
      const id = await addActivity('strava', 'strava-activity-1', {})
      await storeStrava('strava-activity-1', { elapsed_time: 3600, map: { polyline: 'abc' } })
      await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [id])
      expect(await getStravaTrackBackfillCandidates(user, { limit: 10 })).toEqual([])
    })
  })
})
