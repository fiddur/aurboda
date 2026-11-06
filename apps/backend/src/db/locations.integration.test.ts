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
} from './locations.ts'

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
