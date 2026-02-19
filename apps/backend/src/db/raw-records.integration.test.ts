import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper'
import { getScrobbles, insertRawRecord } from './raw-records'

const CONTAINER_TIMEOUT = 60_000

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
})
