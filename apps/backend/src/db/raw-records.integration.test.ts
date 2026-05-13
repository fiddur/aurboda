import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getScrobbles, insertRawRecord, queryRawRecords } from './raw-records.ts'

const CONTAINER_TIMEOUT = 120_000

describe('Raw Records Integration Tests', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  describe('getScrobbles', () => {
    test('returns scrobbles within time range', async () => {
      const user = getTestUser()

      await insertRawRecord(user, {
        data: { album: 'Album A', artist: 'Artist A', track: 'Track A' },
        external_id: '1-Track A-Artist A',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T10:05:00Z'),
        source: 'lastfm',
      })
      await insertRawRecord(user, {
        data: { album: 'Album B', artist: 'Artist B', track: 'Track B' },
        external_id: '2-Track B-Artist B',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T10:10:00Z'),
        source: 'lastfm',
      })
      // Outside range
      await insertRawRecord(user, {
        data: { album: 'Album C', artist: 'Artist C', track: 'Track C' },
        external_id: '3-Track C-Artist C',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T11:00:00Z'),
        source: 'lastfm',
      })

      const result = await getScrobbles(
        user,
        new Date('2026-02-17T10:00:00Z'),
        new Date('2026-02-17T10:15:00Z'),
      )

      expect(result).toHaveLength(2)
      expect(result[0].track).toBe('Track A')
      expect(result[0].artist).toBe('Artist A')
      expect(result[0].album).toBe('Album A')
      expect(result[1].track).toBe('Track B')
    })

    test('returns empty array when no scrobbles in range', async () => {
      const user = getTestUser()
      const result = await getScrobbles(
        user,
        new Date('2026-02-17T10:00:00Z'),
        new Date('2026-02-17T11:00:00Z'),
      )
      expect(result).toEqual([])
    })

    test('only returns lastfm scrobbles, not other raw records', async () => {
      const user = getTestUser()

      await insertRawRecord(user, {
        data: { album: 'Album', artist: 'Artist', track: 'Track' },
        external_id: '1-Track-Artist',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T10:05:00Z'),
        source: 'lastfm',
      })
      await insertRawRecord(user, {
        data: { some: 'data' },
        external_id: 'other-record',
        record_type: 'heartrate',
        recorded_at: new Date('2026-02-17T10:05:00Z'),
        source: 'health_connect',
      })

      const result = await getScrobbles(
        user,
        new Date('2026-02-17T10:00:00Z'),
        new Date('2026-02-17T11:00:00Z'),
      )
      expect(result).toHaveLength(1)
      expect(result[0].track).toBe('Track')
    })

    test('returns results ordered by recorded_at ascending', async () => {
      const user = getTestUser()

      await insertRawRecord(user, {
        data: { album: '', artist: 'A', track: 'Second' },
        external_id: '2-Second-A',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T10:10:00Z'),
        source: 'lastfm',
      })
      await insertRawRecord(user, {
        data: { album: '', artist: 'A', track: 'First' },
        external_id: '1-First-A',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T10:05:00Z'),
        source: 'lastfm',
      })

      const result = await getScrobbles(
        user,
        new Date('2026-02-17T10:00:00Z'),
        new Date('2026-02-17T11:00:00Z'),
      )
      expect(result[0].track).toBe('First')
      expect(result[1].track).toBe('Second')
    })
  })

  describe('queryRawRecords', () => {
    const seed = async (user: string) => {
      await insertRawRecord(user, {
        data: { dailyNapDTOS: null, key: 'v1' },
        external_id: 'garmin-sleep-2026-02-17',
        record_type: 'garmin_sleep',
        recorded_at: new Date('2026-02-17T12:00:00Z'),
        source: 'garmin',
      })
      await insertRawRecord(user, {
        data: { calendarDate: '2026-02-18' },
        external_id: 'garmin-sleep-2026-02-18',
        record_type: 'garmin_sleep',
        recorded_at: new Date('2026-02-18T12:00:00Z'),
        source: 'garmin',
      })
      await insertRawRecord(user, {
        data: { calendarDate: '2026-02-17' },
        external_id: 'garmin-hrv-2026-02-17',
        record_type: 'garmin_hrv',
        recorded_at: new Date('2026-02-17T12:00:00Z'),
        source: 'garmin',
      })
      await insertRawRecord(user, {
        data: { album: 'A', artist: 'B', track: 'T' },
        external_id: 'lastfm-1',
        record_type: 'scrobble',
        recorded_at: new Date('2026-02-17T12:00:00Z'),
        source: 'lastfm',
      })
    }

    test('filters by source + record_type + date range, newest first', async () => {
      const user = getTestUser()
      await seed(user)

      const { rows, total } = await queryRawRecords(user, {
        end: new Date('2026-02-18T00:00:00Z'),
        record_type: 'garmin_sleep',
        source: 'garmin',
        start: new Date('2026-02-17T00:00:00Z'),
      })

      expect(total).toBe(1)
      expect(rows).toHaveLength(1)
      expect(rows[0].external_id).toBe('garmin-sleep-2026-02-17')
      expect(rows[0].data).toMatchObject({ key: 'v1' })
    })

    test('orders by recorded_at DESC', async () => {
      const user = getTestUser()
      await seed(user)

      const { rows } = await queryRawRecords(user, { source: 'garmin', record_type: 'garmin_sleep' })
      expect(rows.map((r) => r.external_id)).toEqual(['garmin-sleep-2026-02-18', 'garmin-sleep-2026-02-17'])
    })

    test('filters by external_id', async () => {
      const user = getTestUser()
      await seed(user)

      const { rows } = await queryRawRecords(user, { external_id: 'garmin-hrv-2026-02-17' })
      expect(rows).toHaveLength(1)
      expect(rows[0].record_type).toBe('garmin_hrv')
    })

    test('applies limit and offset and returns total unchanged', async () => {
      const user = getTestUser()
      await seed(user)

      const first = await queryRawRecords(user, { limit: 2, offset: 0 })
      const second = await queryRawRecords(user, { limit: 2, offset: 2 })

      expect(first.total).toBe(4)
      expect(second.total).toBe(4)
      expect(first.rows).toHaveLength(2)
      expect(second.rows).toHaveLength(2)
      // Pages don't overlap
      const ids = new Set(first.rows.map((r) => r.id))
      for (const row of second.rows) expect(ids.has(row.id)).toBe(false)
    })

    test('end bound is exclusive, start bound is inclusive', async () => {
      const user = getTestUser()
      await seed(user)

      const { rows } = await queryRawRecords(user, {
        end: new Date('2026-02-17T12:00:00Z'),
        start: new Date('2026-02-17T12:00:00Z'),
      })
      expect(rows).toEqual([])
    })
  })
})
