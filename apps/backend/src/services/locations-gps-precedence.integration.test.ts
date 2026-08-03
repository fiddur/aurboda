/**
 * Integration tests for GPS precedence: an activity's own track supersedes
 * passive phone tracking for the activity's span.
 *
 * Covers the write side (which sources get soft-deleted, and which are spared)
 * and the read side — a soft-deleted point must not come back out of the query
 * the activity map uses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { Location } from '../db/types.ts'

import { insertLocations, softDeleteSupersededLocations } from '../db/locations.ts'
import { activityTrackSources } from '../integrations/gps-precedence.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getRawLocationPoints } from './locations.ts'

const CONTAINER_TIMEOUT = 120_000

const at = (iso: string) => new Date(iso)

/** Phone track: coarse, spanning the whole activity and beyond. */
const phonePoints: Location[] = [
  { lat: 57.6, lon: 12.6, source: 'owntracks', time: at('2025-01-15T06:50:00.000Z') },
  { lat: 57.61, lon: 12.61, source: 'owntracks', time: at('2025-01-15T07:05:00.000Z') },
  { lat: 57.62, lon: 12.62, source: 'owntracks', time: at('2025-01-15T07:25:00.000Z') },
  { lat: 57.63, lon: 12.63, source: 'owntracks', time: at('2025-01-15T07:50:00.000Z') },
]

/** Watch track: accurate, inside the activity span. */
const garminPoints: Location[] = [
  { lat: 57.65, lon: 12.65, source: 'garmin', time: at('2025-01-15T07:10:00.000Z') },
  { lat: 57.66, lon: 12.66, source: 'garmin', time: at('2025-01-15T07:20:00.000Z') },
]

/** The same session mirrored to Strava, downsampled to 60 s. */
const stravaPoints: Location[] = [
  { lat: 57.655, lon: 12.655, source: 'strava', time: at('2025-01-15T07:11:00.000Z') },
]

const activityStart = at('2025-01-15T07:00:00.000Z')
const activityEnd = at('2025-01-15T07:30:00.000Z')

/** Latitudes of the live points in the activity span, in time order. */
const liveInSpan = async (user: string) => {
  const points = await getRawLocationPoints(user, activityStart, activityEnd)
  return points.map((p) => p.lat)
}

describe('GPS precedence (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('softDeleteSupersededLocations', () => {
    test('soft-deletes passive tracking in the span and keeps the activity track', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      const deleted = await softDeleteSupersededLocations(
        user,
        activityTrackSources,
        activityStart,
        activityEnd,
      )

      // Two phone points fall inside the span; the 06:50 and 07:50 ones do not
      expect(deleted).toBe(2)
      expect(await liveInSpan(user)).toEqual([57.65, 57.66])
    })

    test('spares every activity-track source, not just the one syncing', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints, ...stravaPoints])

      // Garmin syncing must not delete the mirrored Strava track: Strava is
      // downsampled to 60 s and neither integration revisits a synced activity,
      // so "last sync wins" would permanently demote the full-resolution track.
      await softDeleteSupersededLocations(user, activityTrackSources, activityStart, activityEnd)

      expect(await liveInSpan(user)).toEqual([57.65, 57.655, 57.66])
    })

    test('leaves points outside the span alone', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      await softDeleteSupersededLocations(user, activityTrackSources, activityStart, activityEnd)

      const before = await getRawLocationPoints(user, at('2025-01-15T06:00:00.000Z'), activityStart)
      const after = await getRawLocationPoints(user, activityEnd, at('2025-01-15T08:00:00.000Z'))
      expect(before).toHaveLength(1)
      expect(after).toHaveLength(1)
    })

    test('returns 0 and changes nothing when there is nothing to supersede', async () => {
      const user = getTestUser()
      await insertLocations(user, garminPoints)

      const deleted = await softDeleteSupersededLocations(
        user,
        activityTrackSources,
        activityStart,
        activityEnd,
      )

      expect(deleted).toBe(0)
      expect(await liveInSpan(user)).toEqual([57.65, 57.66])
    })

    test('is idempotent — a second pass finds nothing left to delete', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      await softDeleteSupersededLocations(user, activityTrackSources, activityStart, activityEnd)
      const second = await softDeleteSupersededLocations(
        user,
        activityTrackSources,
        activityStart,
        activityEnd,
      )

      expect(second).toBe(0)
    })
  })

  describe('insertLocations', () => {
    test('tolerates duplicate (source, time) rows within one batch', async () => {
      const user = getTestUser()

      // Garmin keeps every GPS sample, so two samples can share a timestamp
      // (multisport transitions, >1 sample/s devices). ON CONFLICT DO NOTHING
      // absorbs that; DO UPDATE would abort the whole insert with SQLSTATE 21000.
      await insertLocations(user, [
        { lat: 57.65, lon: 12.65, source: 'garmin', time: at('2025-01-15T07:10:00.000Z') },
        { lat: 57.67, lon: 12.67, source: 'garmin', time: at('2025-01-15T07:10:00.000Z') },
        { lat: 57.66, lon: 12.66, source: 'garmin', time: at('2025-01-15T07:20:00.000Z') },
      ])

      expect(await liveInSpan(user)).toEqual([57.65, 57.66])
    })

    test('does not revive a superseded point', async () => {
      const user = getTestUser()
      await insertLocations(user, phonePoints)
      await softDeleteSupersededLocations(user, activityTrackSources, activityStart, activityEnd)

      await insertLocations(user, phonePoints)

      expect(await liveInSpan(user)).toEqual([])
    })
  })

  describe('getRawLocationPoints', () => {
    test('excludes soft-deleted points', async () => {
      const user = getTestUser()
      await insertLocations(user, phonePoints)

      expect(await getRawLocationPoints(user, activityStart, activityEnd)).toHaveLength(2)

      await softDeleteSupersededLocations(user, activityTrackSources, activityStart, activityEnd)

      expect(await getRawLocationPoints(user, activityStart, activityEnd)).toEqual([])
    })
  })
})
