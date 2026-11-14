import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { singleLiftTypeNames, singleLiftTypes } from '../services/single-lift-types.ts'
import { cleanTestDb, getTestUser, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { insertActivity, retireSingleLiftTypes } from './activities/index.ts'
import { query } from './connection.ts'

const CONTAINER_TIMEOUT = 120_000

const seedLegacyType = async (user: string, name: string) => {
  await query(
    user,
    `INSERT INTO activity_type_definitions
       (name, display_name, display_category, color, is_builtin, health_connect_record_type,
        health_connect_exercise_type, parent_type)
     VALUES ($1, $2, 'exercise', '#22c55e', true, 'ExerciseSessionRecord', $3, 'exercise')`,
    [name, singleLiftTypes[name].display_name, singleLiftTypes[name].health_connect_exercise_type],
  )
}

const definition = async (user: string, name: string) =>
  (
    await query(
      user,
      `SELECT is_builtin, health_connect_exercise_type, health_connect_record_type
         FROM activity_type_definitions WHERE name = $1`,
      [name],
    )
  ).rows[0]

const activityRow = async (user: string, id: string) =>
  (
    await query(
      user,
      `SELECT activity_type, data, source, external_id, title, start_time, end_time, deleted_at, superseded_by
         FROM activities WHERE id = $1`,
      [id],
    )
  ).rows[0]

const demoted = { health_connect_exercise_type: null, health_connect_record_type: null, is_builtin: false }

const start = new Date('2024-03-01T10:00:00Z')
const end = new Date('2024-03-01T10:30:00Z')

describe('retireSingleLiftTypes (#1651)', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await stopTestDb()
  })

  beforeEach(async () => {
    await cleanTestDb()
    const user = getTestUser()
    await query(user, `DELETE FROM activity_type_definitions WHERE parent_type = ANY($1)`, [
      singleLiftTypeNames,
    ])
    await query(user, `DELETE FROM activity_type_definitions WHERE name = ANY($1)`, [singleLiftTypeNames])
  })

  test('changes nothing on a fresh database', async () => {
    const user = getTestUser()
    const before = await query(user, `SELECT name FROM activity_type_definitions ORDER BY name`)

    expect(await retireSingleLiftTypes(user)).toEqual({ converted: 0, deleted: [], kept: [] })

    const after = await query(user, `SELECT name FROM activity_type_definitions ORDER BY name`)
    expect(after.rows).toEqual(before.rows)
  })

  test('converts live and soft-deleted activities and deletes the unreferenced definition', async () => {
    const user = getTestUser()
    await seedLegacyType(user, 'bench_press')
    await seedLegacyType(user, 'crunch')
    const liveId = await insertActivity(user, {
      activity_type: 'bench_press',
      data: { calories: 40 },
      end_time: end,
      external_id: 'hc-bench-1',
      source: 'health_connect',
      start_time: start,
      title: 'Bench',
    })
    const deletedId = await insertActivity(user, {
      activity_type: 'bench_press',
      end_time: new Date('2024-03-02T10:30:00Z'),
      source: 'health_connect',
      start_time: new Date('2024-03-02T10:00:00Z'),
    })
    await query(user, `UPDATE activities SET deleted_at = NOW() WHERE id = $1`, [deletedId])
    const withSetsId = await insertActivity(user, {
      activity_type: 'crunch',
      data: { sets: [{ exercise: 'Sit-Up', reps: 20 }] },
      source: 'health_connect',
      start_time: new Date('2024-03-03T10:00:00Z'),
    })

    const result = await retireSingleLiftTypes(user)

    expect(result).toEqual({ converted: 3, deleted: ['bench_press', 'crunch'], kept: [] })
    expect(await activityRow(user, liveId!)).toMatchObject({
      activity_type: 'strength_training',
      data: { calories: 40, sets: [{ exercise: 'Bench Press' }] },
      end_time: end,
      external_id: 'hc-bench-1',
      source: 'health_connect',
      start_time: start,
      title: 'Bench',
    })
    const deleted = await activityRow(user, deletedId!)
    expect(deleted.activity_type).toBe('strength_training')
    expect(deleted.deleted_at).not.toBeNull()
    expect(deleted.data.sets).toEqual([{ exercise: 'Bench Press' }])
    expect((await activityRow(user, withSetsId!)).data.sets).toEqual([{ exercise: 'Sit-Up', reps: 20 }])
    expect(await definition(user, 'bench_press')).toBeUndefined()
    expect(await definition(user, 'crunch')).toBeUndefined()
  })

  test('stores a lift without a catalogue entry under its display name', async () => {
    const user = getTestUser()
    await seedLegacyType(user, 'jumping_jack')
    const id = await insertActivity(user, {
      activity_type: 'jumping_jack',
      source: 'health_connect',
      start_time: start,
    })

    await retireSingleLiftTypes(user)

    expect((await activityRow(user, id!)).data.sets).toEqual([{ exercise: 'Jumping Jack' }])
  })

  test('leaves a colliding activity on the type and keeps the definition as a custom type', async () => {
    const user = getTestUser()
    await seedLegacyType(user, 'bench_press')
    await insertActivity(user, {
      activity_type: 'strength_training',
      source: 'health_connect',
      start_time: start,
    })
    const id = await insertActivity(user, {
      activity_type: 'bench_press',
      source: 'health_connect',
      start_time: start,
    })

    const result = await retireSingleLiftTypes(user)

    expect(result).toEqual({ converted: 0, deleted: [], kept: ['bench_press'] })
    expect((await activityRow(user, id!)).activity_type).toBe('bench_press')
    expect(await definition(user, 'bench_press')).toEqual(demoted)
  })

  const references: [string, (user: string) => Promise<unknown>][] = [
    [
      'a child type',
      (user) =>
        query(
          user,
          `INSERT INTO activity_type_definitions (name, display_name, parent_type) VALUES ('incline_bench', 'Incline', 'bench_press')`,
        ),
    ],
    [
      'a deduction rule output',
      (user) =>
        query(
          user,
          `INSERT INTO deduction_rules (name, conditions, output_activity_type) VALUES ('r', '[]', 'bench_press')`,
        ),
    ],
    [
      'a deduction rule activity condition',
      (user) =>
        query(
          user,
          `INSERT INTO deduction_rules (name, conditions, output_activity_type)
           VALUES ('r', '[{"kind": "activity", "activity_type": "bench_press"}]', 'exercise')`,
        ),
    ],
    [
      'a measure goal',
      (user) => query(user, `INSERT INTO goals (goal_type, activity_type) VALUES ('measure', 'bench_press')`),
    ],
    [
      'a trend goal',
      (user) =>
        query(
          user,
          `INSERT INTO goals (goal_type, source_type, pattern) VALUES ('trend', 'activity_type', 'bench_press')`,
        ),
    ],
    [
      'an autoshare rule',
      (user) =>
        query(user, `INSERT INTO autoshare_rules (name, activity_types) VALUES ('a', ARRAY['bench_press'])`),
    ],
    [
      'user settings',
      (user) =>
        query(user, `INSERT INTO user_settings (settings) VALUES ($1)`, [
          { dashboard: { widgets: [{ activity_type: 'bench_press' }] } },
        ]),
    ],
  ]

  test.each(references)('keeps the definition as a custom type while %s refers to it', async (_, refer) => {
    const user = getTestUser()
    await seedLegacyType(user, 'bench_press')
    const id = await insertActivity(user, {
      activity_type: 'bench_press',
      source: 'health_connect',
      start_time: start,
    })
    await refer(user)

    const result = await retireSingleLiftTypes(user)

    expect(result).toEqual({ converted: 1, deleted: [], kept: ['bench_press'] })
    expect((await activityRow(user, id!)).activity_type).toBe('strength_training')
    expect(await definition(user, 'bench_press')).toEqual(demoted)
  })

  test('a second run changes nothing, and a custom type of a legacy name is never touched', async () => {
    const user = getTestUser()
    await seedLegacyType(user, 'bench_press')
    await query(user, `INSERT INTO autoshare_rules (name, activity_types) VALUES ('a', ARRAY['bench_press'])`)
    await retireSingleLiftTypes(user)
    const id = await insertActivity(user, {
      activity_type: 'bench_press',
      source: 'health_connect',
      start_time: start,
    })

    expect(await retireSingleLiftTypes(user)).toEqual({ converted: 0, deleted: [], kept: [] })
    expect((await activityRow(user, id!)).activity_type).toBe('bench_press')
    expect(await definition(user, 'bench_press')).toEqual(demoted)
  })

  test('merges a converted session with an overlapping strength session', async () => {
    const user = getTestUser()
    await seedLegacyType(user, 'bench_press')
    const strengthId = await insertActivity(user, {
      activity_type: 'strength_training',
      end_time: new Date('2024-03-01T10:31:00Z'),
      source: 'health_connect',
      start_time: new Date('2024-03-01T10:01:00Z'),
    })
    const benchId = await insertActivity(user, {
      activity_type: 'bench_press',
      end_time: end,
      source: 'health_connect',
      start_time: start,
    })
    const read = async () => [await activityRow(user, strengthId!), await activityRow(user, benchId!)]
    expect((await read()).map((r) => r.superseded_by)).toEqual([null, null])

    await retireSingleLiftTypes(user)

    const rows = await read()
    expect(rows.map((r) => r.activity_type)).toEqual(['strength_training', 'strength_training'])
    expect(rows.filter((r) => r.superseded_by !== null)).toHaveLength(1)
  })
})
