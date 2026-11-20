import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { insertActivity } from '../../db/activities/index.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../../test/db-test-helper.ts'
import { loadSessions } from './muscle-group-history.ts'

const CONTAINER_TIMEOUT = 120_000
const type = 'strength_training'
const field = 'sets.exercise'

const addSession = (externalId: string, start: Date) =>
  insertActivity(getTestUser(), {
    activity_type: type,
    data: { sets: [{ exercise: 'Barbell Bench Press', reps: 5 }] },
    end_time: new Date(start.getTime() + 3_600_000),
    external_id: externalId,
    source: 'gravl',
    start_time: start,
  })

const startsOf = async (period?: { end: Date; start: Date }) => {
  const loaded = await loadSessions(getTestUser(), type, field, period)
  if (!loaded.success) throw new Error(loaded.error)
  return loaded.data.sessions.map((s) => s.start_time.toISOString()).toSorted()
}

describe('loadSessions (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    await addSession('old', new Date('2026-01-10T07:00:00Z'))
    await addSession('recent', new Date('2026-06-10T07:00:00Z'))
  })

  test('a period loads only the sessions starting within it', async () => {
    expect(
      await startsOf({ end: new Date('2026-07-01T00:00:00Z'), start: new Date('2026-06-01T00:00:00Z') }),
    ).toEqual(['2026-06-10T07:00:00.000Z'])
  })

  test('without a period every session is loaded', async () => {
    expect(await startsOf()).toEqual(['2026-01-10T07:00:00.000Z', '2026-06-10T07:00:00.000Z'])
  })
})
