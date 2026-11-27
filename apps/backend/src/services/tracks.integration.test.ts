import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity, insertOverride } from '../db/activities/index.ts'
import { query } from '../db/connection.ts'
import { upsertActivityTrack } from '../db/tracks.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { findActivityTrack } from './tracks.ts'

const CONTAINER_TIMEOUT = 120_000

const start = new Date('2026-07-01T08:00:00Z')
const end = new Date('2026-07-01T09:00:00Z')

describe('findActivityTrack (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('an override shows the track of the synced row it overrides, under that row', async () => {
    const user = getTestUser()
    const synced = await insertActivity(user, {
      activity_type: 'running',
      end_time: end,
      external_id: 'garmin-1',
      source: 'garmin',
      start_time: start,
    })
    await upsertActivityTrack(user, {
      activity_id: synced,
      ewkt: 'SRID=4326;LINESTRING ZM(18 59 10 0, 18 59.01 12.5 60)',
      full_resolution: true,
      source: 'garmin',
    })
    const override = await insertOverride(user, [synced], {
      activity_type: 'running',
      end_time: end,
      start_time: start,
      title: 'Morning run',
    })

    expect(await findActivityTrack(user, override!.id!)).toMatchObject({
      activity_id: synced,
      source: 'garmin',
    })
    expect((await findActivityTrack(user, synced))?.activity_id).toBe(synced)

    await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [override!.id])
    expect(await findActivityTrack(user, override!.id!)).toBeNull()
    expect(await findActivityTrack(user, 'merged:x')).toBeNull()
  })
})
