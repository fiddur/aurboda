import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createUsageRecorder, installUsageRecorder, type UsageRow } from '../services/usage-recorder.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { query } from './connection.ts'
import {
  findNearbyNamedLocation,
  hasLocations,
  insertLocation,
  insertLocations,
  insertNamedLocation,
  softDeleteLocationsInTrackedActivities,
} from './locations.ts'
import { upsertActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Locations integration', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('ingest usage', () => {
    test('records only the points actually stored, per source', async () => {
      const user = getTestUser()
      const flushed: UsageRow[] = []
      const recorder = createUsageRecorder({ flush: async (rows) => void flushed.push(...rows) })
      installUsageRecorder(recorder)
      try {
        await insertLocations(user, [
          { lat: 59.33, lon: 18.06, source: 'garmin', time: new Date('2026-07-01T10:00:00Z') },
          { lat: 59.34, lon: 18.07, source: 'garmin', time: new Date('2026-07-01T10:01:00Z') },
          { lat: 59.35, lon: 18.08, source: 'owntracks', time: new Date('2026-07-01T10:02:00Z') },
        ])
        await insertLocations(user, [
          { lat: 59.33, lon: 18.06, source: 'garmin', time: new Date('2026-07-01T10:00:00Z') },
        ])
        await insertLocation(user, { lat: 59.36, lon: 18.09, time: new Date('2026-07-01T10:03:00Z') })
        await insertLocation(user, { lat: 59.36, lon: 18.09, time: new Date('2026-07-01T10:03:00Z') })
        await recorder.flushNow()
      } finally {
        installUsageRecorder(null)
      }

      expect(flushed.map(({ channel, count, items }) => ({ channel, count, items }))).toEqual([
        { channel: 'garmin', count: 1, items: 2 },
        { channel: 'owntracks', count: 2, items: 2 },
      ])
    })
  })

  describe('insertLocations', () => {
    test('returns the number of new rows, not counting duplicates', async () => {
      const user = getTestUser()
      const time = new Date('2026-07-01T10:00:00Z')
      expect(
        await insertLocations(user, [
          { lat: 59.33, lon: 18.06, source: 'home_assistant', time },
          { lat: 59.34, lon: 18.07, source: 'home_assistant', time: new Date('2026-07-01T10:01:00Z') },
        ]),
      ).toBe(2)
      expect(
        await insertLocations(user, [
          { lat: 59.33, lon: 18.06, source: 'home_assistant', time },
          { lat: 59.35, lon: 18.08, source: 'home_assistant', time: new Date('2026-07-01T10:02:00Z') },
        ]),
      ).toBe(1)
      expect(await insertLocations(user, [])).toBe(0)
    })

    test('round-trips region names with commas, quotes, braces and backslashes', async () => {
      const user = getTestUser()
      const regions = ['Work, "HQ" {2}', 'back\\slash', "it's"]
      await insertLocations(user, [
        { lat: 59.33, lon: 18.06, regions, source: 'home_assistant', time: new Date('2026-07-01T10:00:00Z') },
      ])
      const result = await query<{ regions: string[] }>(user, `SELECT regions FROM locations`)
      expect(result.rows[0].regions).toEqual(regions)
    })
  })

  describe('softDeleteLocationsInTrackedActivities', () => {
    const activityStart = new Date('2026-07-01T10:00:00Z')
    const activityEnd = new Date('2026-07-01T11:00:00Z')
    const windowStart = new Date('2026-07-01T00:00:00Z')
    const windowEnd = new Date('2026-07-02T00:00:00Z')

    const insertActivity = async (
      user: string,
      opts: { track?: string; deleted?: boolean; start?: Date; end?: Date | null } = {},
    ): Promise<string> => {
      const type = (await query<{ name: string }>(user, 'SELECT name FROM activity_type_definitions LIMIT 1'))
        .rows[0].name
      const id = (
        await query<{ id: string }>(
          user,
          `INSERT INTO activities (source, activity_type, start_time, end_time, deleted_at)
           VALUES ('garmin', $1, $2, $3, $4) RETURNING id`,
          [
            type,
            opts.start ?? activityStart,
            opts.end === undefined ? activityEnd : opts.end,
            opts.deleted ? new Date() : null,
          ],
        )
      ).rows[0].id
      if (opts.track) {
        await upsertActivityTrack(user, {
          activity_id: id,
          ewkt: 'SRID=4326;LINESTRING ZM (18.06 59.33 0 0, 18.07 59.34 0 60)',
          full_resolution: true,
          source: opts.track,
        })
      }
      return id
    }

    const live = async (user: string) =>
      (
        await query<{ source: string; time: Date }>(
          user,
          'SELECT source, time FROM locations WHERE deleted_at IS NULL ORDER BY time, source',
        )
      ).rows.map((r) => `${r.source}@${new Date(r.time).toISOString()}`)

    const inside = new Date('2026-07-01T10:30:00Z')
    const outside = new Date('2026-07-01T12:00:00Z')

    test('deletes points of the source inside a tracked activity, keeps the rest', async () => {
      const user = getTestUser()
      await insertActivity(user, { track: 'garmin' })
      await insertLocations(user, [
        { lat: 59.33, lon: 18.06, source: 'home_assistant', time: inside },
        { lat: 59.33, lon: 18.06, source: 'home_assistant', time: outside },
        { lat: 59.33, lon: 18.06, source: 'owntracks', time: inside },
      ])
      expect(
        await softDeleteLocationsInTrackedActivities(
          user,
          'home_assistant',
          ['garmin', 'strava'],
          windowStart,
          windowEnd,
        ),
      ).toBe(1)
      expect(await live(user)).toEqual([
        `owntracks@${inside.toISOString()}`,
        `home_assistant@${outside.toISOString()}`,
      ])
    })

    test('keeps points inside an activity without a track from the given sources', async () => {
      const user = getTestUser()
      await insertActivity(user)
      await insertActivity(user, { start: new Date('2026-07-01T10:10:00Z'), track: 'manual_upload' })
      await insertLocations(user, [{ lat: 59.33, lon: 18.06, source: 'home_assistant', time: inside }])
      expect(
        await softDeleteLocationsInTrackedActivities(
          user,
          'home_assistant',
          ['garmin', 'strava'],
          windowStart,
          windowEnd,
        ),
      ).toBe(0)
    })

    test('keeps points inside a deleted or unfinished activity', async () => {
      const user = getTestUser()
      await insertActivity(user, { deleted: true, track: 'garmin' })
      await insertActivity(user, { end: null, start: new Date('2026-07-01T10:05:00Z'), track: 'strava' })
      await insertLocations(user, [{ lat: 59.33, lon: 18.06, source: 'home_assistant', time: inside }])
      expect(
        await softDeleteLocationsInTrackedActivities(
          user,
          'home_assistant',
          ['garmin', 'strava'],
          windowStart,
          windowEnd,
        ),
      ).toBe(0)
    })

    test('only touches points inside the window', async () => {
      const user = getTestUser()
      await insertActivity(user, { track: 'garmin' })
      await insertLocations(user, [{ lat: 59.33, lon: 18.06, source: 'home_assistant', time: inside }])
      expect(
        await softDeleteLocationsInTrackedActivities(
          user,
          'home_assistant',
          ['garmin'],
          new Date('2026-07-01T10:40:00Z'),
          windowEnd,
        ),
      ).toBe(0)
    })
  })

  describe('hasLocations', () => {
    const start = new Date('2026-07-01T08:00:00Z')
    const end = new Date('2026-07-01T09:00:00Z')

    test('is true only when a point falls in the window', async () => {
      const user = getTestUser()
      expect(await hasLocations(user, start, end)).toBe(false)

      await insertLocations(user, [
        { lat: 59.33, lon: 18.06, source: 'garmin', time: new Date('2026-07-01T10:00:00Z') },
      ])
      expect(await hasLocations(user, start, end)).toBe(false)

      await insertLocations(user, [
        { lat: 59.34, lon: 18.07, source: 'garmin', time: new Date('2026-07-01T08:30:00Z') },
      ])
      expect(await hasLocations(user, start, end)).toBe(true)
    })

    test('ignores soft-deleted points', async () => {
      const user = getTestUser()
      await insertLocations(user, [
        { lat: 59.34, lon: 18.07, source: 'garmin', time: new Date('2026-07-01T08:30:00Z') },
      ])
      await query(user, `UPDATE locations SET deleted_at = NOW()`)
      expect(await hasLocations(user, start, end)).toBe(false)
    })
  })

  describe('findNearbyNamedLocation', () => {
    test('returns the nearest named location within the distance', async () => {
      const user = getTestUser()
      await insertNamedLocation(user, { lat: 59.3, lon: 18.07, name: 'Near' })
      await insertNamedLocation(user, { lat: 59.302, lon: 18.07, name: 'Farther' })

      expect((await findNearbyNamedLocation(user, 59.3001, 18.07, 500))?.name).toBe('Near')
      expect(await findNearbyNamedLocation(user, 59.31, 18.07, 500)).toBeNull()
    })
  })
})
