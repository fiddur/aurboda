import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

/**
 * `mergeActivities` against a real DB: the merged aurboda row takes the earliest
 * original's (type, start_time), the very key `idx_activities_type_time` guards
 * for rows without an external_id, so two manually created activities of the
 * same type must merge without a unique violation (#1251).
 */
import { getActivities, getActivityById, insertActivity } from '../db/activities/index.ts'
import { getNotesForEntity, insertNote } from '../db/notes.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { mergeActivities } from './mutations.ts'

const CONTAINER_TIMEOUT = 120_000

const FIRST_START = new Date('2026-10-04T08:00:00Z')
const FIRST_END = new Date('2026-10-04T09:00:00Z')
const SECOND_START = new Date('2026-10-04T09:05:00Z')
const SECOND_END = new Date('2026-10-04T10:00:00Z')
const DAY_START = new Date('2026-10-04T00:00:00Z')
const DAY_END = new Date('2026-10-05T00:00:00Z')

describe('mergeActivities (integration)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
  })

  test('merges two manually created activities of the same type (#1251)', async () => {
    const user = getTestUser()
    const first = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: FIRST_END,
      source: 'aurboda',
      start_time: FIRST_START,
      title: 'm1',
    })
    const second = await insertActivity(user, {
      activity_type: 'exercise',
      data: { calories: 120 },
      end_time: SECOND_END,
      source: 'aurboda',
      start_time: SECOND_START,
      title: 'm2',
    })
    await insertNote(user, 'activity', second, 'note on the second half')

    const result = await mergeActivities(user, { activity_ids: [first, second] })

    expect(result).toMatchObject({ activity_type: 'exercise', success: true })
    const merged = await getActivityById(user, result.id!)
    expect(merged).toMatchObject({
      activity_type: 'exercise',
      end_time: SECOND_END,
      source: 'aurboda',
      start_time: FIRST_START,
      title: 'm1',
    })
    expect(merged?.data).toMatchObject({ calories: 120 })
    expect(merged?.data?.merged_from).toHaveLength(2)

    const live = await getActivities(user, 'exercise', DAY_START, DAY_END)
    expect(live.map((a) => a.id)).toEqual([result.id])
    expect((await getActivityById(user, second, true))?.deleted_at).toBeInstanceOf(Date)

    const notes = await getNotesForEntity(user, 'activity', result.id!)
    expect(notes.map((n) => n.content)).toEqual(['note on the second half'])
  })

  test('merges synced activities that carry an external_id into a new aurboda row', async () => {
    const user = getTestUser()
    const first = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: FIRST_END,
      external_id: 'garmin-1',
      source: 'garmin',
      start_time: FIRST_START,
      title: 'g1',
    })
    const second = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: SECOND_END,
      external_id: 'garmin-2',
      source: 'garmin',
      start_time: SECOND_START,
      title: 'g2',
    })

    const result = await mergeActivities(user, { activity_ids: [first, second], title: 'Long run' })

    expect(result.success).toBe(true)
    expect(result.id).not.toBe(first)
    expect(result.id).not.toBe(second)
    expect(await getActivityById(user, result.id!)).toMatchObject({
      end_time: SECOND_END,
      source: 'aurboda',
      start_time: FIRST_START,
      title: 'Long run',
    })

    const live = await getActivities(user, 'exercise', DAY_START, DAY_END)
    expect(live.map((a) => a.id)).toEqual([result.id])
    expect((await getActivityById(user, first, true))?.deleted_at).toBeInstanceOf(Date)
    expect((await getActivityById(user, second, true))?.deleted_at).toBeInstanceOf(Date)
  })

  test('merges a manual activity into an earlier synced one without touching the index key', async () => {
    const user = getTestUser()
    const synced = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: FIRST_END,
      external_id: 'garmin-3',
      source: 'garmin',
      start_time: FIRST_START,
    })
    const manual = await insertActivity(user, {
      activity_type: 'exercise',
      end_time: SECOND_END,
      source: 'aurboda',
      start_time: SECOND_START,
    })

    const result = await mergeActivities(user, { activity_ids: [manual, synced] })

    expect(result.success).toBe(true)
    const live = await getActivities(user, 'exercise', DAY_START, DAY_END)
    expect(live.map((a) => a.id)).toEqual([result.id])
    expect(live[0]).toMatchObject({ end_time: SECOND_END, source: 'aurboda', start_time: FIRST_START })
  })
})
