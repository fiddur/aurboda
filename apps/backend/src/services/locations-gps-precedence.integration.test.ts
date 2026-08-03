/**
 * Integration tests for GPS precedence: an activity's own track supersedes
 * passive phone tracking for the activity's span.
 *
 * Covers the write side (soft-delete other sources, revive own points on
 * re-sync) and the read side — a soft-deleted point must not come back out of
 * the query the activity map uses.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { Location } from '../db/types.ts'

import { insertLocations, softDeleteOtherSourceLocations } from '../db/locations.ts'
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

const activityStart = at('2025-01-15T07:00:00.000Z')
const activityEnd = at('2025-01-15T07:30:00.000Z')

const sourcesInSpan = async (user: string) => {
  const points = await getRawLocationPoints(user, activityStart, activityEnd)
  return points.map((p) => `${p.lat}`)
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

  describe('softDeleteOtherSourceLocations', () => {
    test('soft-deletes other sources in the span and keeps the activity track', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      const deleted = await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      // Two phone points fall inside the span; the 06:50 and 07:50 ones do not
      expect(deleted).toBe(2)
      expect(await sourcesInSpan(user)).toEqual(['57.65', '57.66'])
    })

    test('leaves points outside the span alone', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      const before = await getRawLocationPoints(user, at('2025-01-15T06:00:00.000Z'), activityStart)
      const after = await getRawLocationPoints(user, activityEnd, at('2025-01-15T08:00:00.000Z'))
      expect(before).toHaveLength(1)
      expect(after).toHaveLength(1)
    })

    test('returns 0 and changes nothing when there is nothing to replace', async () => {
      const user = getTestUser()
      await insertLocations(user, garminPoints)

      const deleted = await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      expect(deleted).toBe(0)
      expect(await sourcesInSpan(user)).toEqual(['57.65', '57.66'])
    })

    test('is idempotent — a second pass finds nothing left to delete', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)
      const second = await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      expect(second).toBe(0)
    })
  })

  describe('insertLocations', () => {
    test('revives a source’s own soft-deleted points on re-sync', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])

      // Strava wins first, taking out the Garmin track...
      await softDeleteOtherSourceLocations(user, 'strava', activityStart, activityEnd)
      expect(await sourcesInSpan(user)).toEqual([])

      // ...then a Garmin re-sync must be able to restore it, otherwise the
      // activity ends up with no GPS at all.
      await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)
      await insertLocations(user, garminPoints)

      expect(await sourcesInSpan(user)).toEqual(['57.65', '57.66'])
    })

    test('does not resurrect points from a source it is not inserting', async () => {
      const user = getTestUser()
      await insertLocations(user, [...phonePoints, ...garminPoints])
      await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      await insertLocations(user, garminPoints)

      expect(await sourcesInSpan(user)).toEqual(['57.65', '57.66'])
    })
  })

  describe('getRawLocationPoints', () => {
    test('excludes soft-deleted points', async () => {
      const user = getTestUser()
      await insertLocations(user, phonePoints)

      expect(await getRawLocationPoints(user, activityStart, activityEnd)).toHaveLength(2)

      await softDeleteOtherSourceLocations(user, 'garmin', activityStart, activityEnd)

      expect(await getRawLocationPoints(user, activityStart, activityEnd)).toEqual([])
    })
  })
})
