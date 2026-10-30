import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity } from './activities/index.ts'
import { getDbForUser, stripGravlSetsNotes } from './connection.ts'
import { getNotesForEntity, upsertSyncedNote } from './notes.ts'
import { insertRawRecord } from './raw-records.ts'

const CONTAINER_TIMEOUT = 120_000

const SETS_NOTE = 'Bench Press: 10×40 kg (w), 8×80 kg'

const gravlWorkout = async (user: string, workoutId: string, rawNotes: string | null | undefined) => {
  const externalId = `gravl-workout-${workoutId}`
  const id = await insertActivity(user, {
    activity_type: 'strength_training',
    data: { sets: [] },
    end_time: new Date('2026-09-03T05:45:00Z'),
    external_id: externalId,
    source: 'gravl',
    start_time: new Date('2026-09-03T05:16:00Z'),
  })
  if (rawNotes !== undefined) {
    await insertRawRecord(user, {
      data: { id: workoutId, notes: rawNotes },
      external_id: externalId,
      record_type: 'gravl_workout',
      recorded_at: new Date('2026-09-03T05:16:00Z'),
      source: 'gravl',
    })
  }
  await upsertSyncedNote(user, 'activity', id!, 'gravl', rawNotes ? `${rawNotes}\n\n${SETS_NOTE}` : SETS_NOTE)
  return id!
}

const noteContents = async (user: string, id: string) =>
  (await getNotesForEntity(user, 'activity', id)).map((n) => n.content)

describe('stripGravlSetsNotes', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('keeps only the workout notes, deletes set-only notes, and leaves unmatched notes alone', async () => {
    const user = getTestUser()
    const withNotes = await gravlWorkout(user, 'a1', '  Felt strong ')
    const withoutNotes = await gravlWorkout(user, 'b2', null)
    const blankNotes = await gravlWorkout(user, 'c3', '   ')
    const noRaw = await gravlWorkout(user, 'd4', undefined)

    const db = await getDbForUser(user)
    expect(await stripGravlSetsNotes(db)).toBe(3)

    expect(await noteContents(user, withNotes)).toEqual(['Felt strong'])
    expect(await noteContents(user, withoutNotes)).toEqual([])
    expect(await noteContents(user, blankNotes)).toEqual([])
    expect(await noteContents(user, noRaw)).toEqual([SETS_NOTE])

    expect(await stripGravlSetsNotes(db)).toBe(0)
  })
})
