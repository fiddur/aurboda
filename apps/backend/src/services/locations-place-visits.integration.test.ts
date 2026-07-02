/**
 * Integration test for getPlaceVisits — issue #811.
 *
 * A stale GPS fix on the way to an un-named destination used to be merged with
 * every later "unknown" fix (by the shared "Somewhere" name), producing one
 * long stay anchored at the first (travel) fix that swallowed the drive and the
 * real destination. getPlaceVisits must instead break unknown visits on
 * movement / long gaps, so the destination surfaces as its own stay at its own
 * coordinates (promotable to a named place).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import type { Location } from '../db/types.ts'

import { insertLocations, insertNamedLocation } from '../db/locations.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getPlaceVisits } from './locations.ts'

const CONTAINER_TIMEOUT = 120_000

const HOME = { lat: 57.66, lon: 12.6 } // "Hökås", named
const HOSPITAL = { lat: 57.72, lon: 12.92 } // un-named destination, ~25 km east

const at = (hour: number, minute: number, lat: number, lon: number): Location => ({
  lat,
  lon,
  regions: [],
  source: 'owntracks',
  time: new Date(Date.UTC(2026, 5, 14, hour, minute, 0)),
})

const haversine = (a: { lat: number; lon: number }, b: { lat: number; lon: number }): number => {
  const R = 6371000
  const dLat = ((b.lat - a.lat) * Math.PI) / 180
  const dLon = ((b.lon - a.lon) * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) * Math.cos((b.lat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h))
}

describe('getPlaceVisits — unknown stay segmentation (issue #811)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('a stale travel fix does not swallow the drive + real destination', async () => {
    const user = getTestUser()
    await insertNamedLocation(user, { lat: HOME.lat, lon: HOME.lon, name: 'Hökås', radius: 200 })

    await insertLocations(user, [
      // Morning at home.
      at(8, 0, HOME.lat, HOME.lon),
      at(9, 0, HOME.lat + 0.0002, HOME.lon),
      at(10, 0, HOME.lat, HOME.lon + 0.0002),
      at(11, 12, HOME.lat, HOME.lon),
      // Stale travel waypoint, then the drive east — each fix far from the last.
      at(14, 50, 57.665, 12.64),
      at(15, 0, 57.68, 12.72),
      at(15, 15, 57.7, 12.82),
      // ~7h dwell at the hospital — clustered, fixes < the 90-min gap cap apart.
      at(15, 30, HOSPITAL.lat, HOSPITAL.lon),
      at(16, 30, HOSPITAL.lat + 0.0003, HOSPITAL.lon - 0.0002),
      at(17, 30, HOSPITAL.lat - 0.0002, HOSPITAL.lon + 0.0003),
      at(18, 45, HOSPITAL.lat + 0.0001, HOSPITAL.lon),
      at(20, 0, HOSPITAL.lat, HOSPITAL.lon + 0.0001),
      at(21, 15, HOSPITAL.lat - 0.0001, HOSPITAL.lon),
      at(22, 30, HOSPITAL.lat + 0.0002, HOSPITAL.lon - 0.0001),
      // Drive back, then home in the evening.
      at(22, 45, 57.7, 12.82),
      at(23, 0, 57.68, 12.72),
      at(23, 46, HOME.lat, HOME.lon),
      at(23, 55, HOME.lat + 0.0001, HOME.lon),
    ])

    const visits = await getPlaceVisits(
      user,
      new Date(Date.UTC(2026, 5, 14, 0, 0, 0)),
      new Date(Date.UTC(2026, 5, 14, 23, 59, 59)),
    )

    const unknown = visits.filter((v) => v.source === 'unknown')
    // Exactly one substantial unknown stay — the hospital, not the waypoint.
    expect(unknown).toHaveLength(1)
    const hospital = unknown[0]
    expect(haversine(hospital, HOSPITAL)).toBeLessThan(200)
    // It is the destination cluster, not the stale 14:50 waypoint.
    expect(hospital.start_time.getTime()).toBeGreaterThanOrEqual(Date.UTC(2026, 5, 14, 15, 0, 0))
    // ~7h dwell, NOT the full 14:50 → 22:54 block.
    expect(hospital.duration_minutes).toBeGreaterThan(360)
    expect(hospital.duration_minutes).toBeLessThan(440)

    // No unknown stay sits at the travel waypoint longitude (~12.64).
    expect(unknown.some((v) => Math.abs(v.lon - 12.64) < 0.01)).toBe(false)

    // The morning home stay is not stretched across the drive — it ends ~11:12.
    const morningHome = visits.find((v) => v.name === 'Hökås')
    expect(morningHome).toBeDefined()
    expect(morningHome!.end_time.getTime()).toBeLessThanOrEqual(Date.UTC(2026, 5, 14, 11, 30, 0))
  })
})
