import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, test, vi } from 'vitest'

import {
  _hashSchema,
  createTableStatements,
  MIGRATION_REVISION,
  schemaFingerprint,
  tableCreationOrder,
} from '../schema.ts'
import {
  previousStrengthTrainingDataSchemas,
  strengthTrainingDataSchema,
} from '../schema/builtin-data-schemas.ts'
import { getTestConnectionUri, getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { _setDbForUser, initializeSchema, migrateSchema, schemaUpToDate } from './connection.ts'
import { createRolePool, type UserDb } from './pool.ts'

const CONTAINER_TIMEOUT = 120_000
// Each test creates a database and runs every CREATE statement: well over vitest's
// 5 s default on a loaded runner.
const SCHEMA_TIMEOUT = 60_000

const pools: UserDb[] = []

// The test server is shared across files and runs: a retried run must not meet its own databases.
const suffix = randomUUID().slice(0, 8)
const FRESH = `fresh_${suffix}`
const LEGACY = `legacy_${suffix}`
const STRENGTH = `strength_${suffix}`
const NULL_NOTES = `null_notes_${suffix}`
const LEGACY_TAGS = `legacy_tags_${suffix}`
const FAILING_TAGS = `failing_tags_${suffix}`
const UNKNOWN_EXERCISE = `unknown_exercise_${suffix}`
const YOGA_DEFINITION = `yoga_definition_${suffix}`
const SLEEP_TIMES = `sleep_times_${suffix}`

/** A new database prepared the way `makeNewUserDb` prepares one, routed to `user`. */
const freshUserDb = async (user: string, database = `init_${user}`): Promise<UserDb> => {
  await getTestDbClient().query(`CREATE DATABASE ${database}`)
  const uri = new URL(getTestConnectionUri())
  uri.pathname = `/${database}`

  const setup = new Client({ connectionString: uri.toString() })
  await setup.connect()
  for (const extension of ['postgis', 'pg_trgm', 'unaccent']) {
    await setup.query(`CREATE EXTENSION IF NOT EXISTS ${extension}`)
  }
  await setup.end()

  const pool = createRolePool({ connectionString: uri.toString(), max: 2 })
  pools.push(pool)
  _setDbForUser(user, pool)
  return pool
}

describe('initializeSchema', () => {
  beforeAll(async () => {
    await startTestDb()
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await Promise.all(pools.map((pool) => pool.end()))
    await stopTestDb()
  })

  test(
    'records the schema fingerprint on a fresh database, so the first migration skips',
    async () => {
      const db = await freshUserDb(FRESH)
      await initializeSchema(FRESH)
      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
    },
    SCHEMA_TIMEOUT,
  )

  test(
    'records nothing on a database that already held tables',
    async () => {
      const db = await freshUserDb(LEGACY)
      await db.query(`CREATE TABLE hcdata (id SERIAL PRIMARY KEY, data JSONB)`)
      await initializeSchema(LEGACY)
      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(false)
    },
    SCHEMA_TIMEOUT,
  )

  const strengthSchema = async (db: UserDb): Promise<unknown> =>
    (await db.query(`SELECT data_schema FROM activity_type_definitions WHERE name = 'strength_training'`))
      .rows[0].data_schema

  test(
    'migration fills a missing strength_training data schema, upgrades an unedited earlier one and leaves a user-edited one alone',
    async () => {
      // migrateSchema finds the tables by the catalog name it derives from the user
      const db = await freshUserDb(STRENGTH, `aurboda_${STRENGTH}`)
      await initializeSchema(STRENGTH)
      expect(await strengthSchema(db)).toEqual(strengthTrainingDataSchema)

      await db.query(
        `UPDATE activity_type_definitions SET data_schema = NULL WHERE name = 'strength_training'`,
      )
      await migrateSchema(STRENGTH, { force: true })
      expect(await strengthSchema(db)).toEqual(strengthTrainingDataSchema)

      for (const previous of previousStrengthTrainingDataSchemas) {
        await db.query(
          `UPDATE activity_type_definitions SET data_schema = $1::jsonb WHERE name = 'strength_training'`,
          [JSON.stringify(previous)],
        )
        await migrateSchema(STRENGTH, { force: true })
        expect(await strengthSchema(db)).toEqual(strengthTrainingDataSchema)
      }

      const edited = { fields: [{ name: 'notes', type: 'string' }] }
      await db.query(
        `UPDATE activity_type_definitions SET data_schema = $1::jsonb WHERE name = 'strength_training'`,
        [JSON.stringify(edited)],
      )
      await migrateSchema(STRENGTH, { force: true })
      expect(await strengthSchema(db)).toEqual(edited)
    },
    SCHEMA_TIMEOUT * 2,
  )

  test(
    'migration drops the "null" Health Connect notes Waking Up wrote and keeps every other note (#1349)',
    async () => {
      const db = await freshUserDb(NULL_NOTES, `aurboda_${NULL_NOTES}`)
      await initializeSchema(NULL_NOTES)
      const insertNote = async (content: string, source: string | null, entityType = 'activity') =>
        (
          await db.query(
            `INSERT INTO notes (entity_type, entity_id, content, source) VALUES ($1, $2, $3, $4) RETURNING id`,
            [entityType, randomUUID(), content, source],
          )
        ).rows[0].id as string
      await insertNote('null', 'health_connect')
      await insertNote(' null ', 'health_connect')
      const real = await insertNote('felt calm', 'health_connect')
      const typed = await insertNote('null', null)
      const answered = await insertNote('null', 'health_connect')
      const reply = (
        await db.query(
          `INSERT INTO notes (entity_type, entity_id, content) VALUES ('note', $1, 'why null?') RETURNING id`,
          [answered],
        )
      ).rows[0].id as string

      await migrateSchema(NULL_NOTES, { force: true })

      const left = (await db.query(`SELECT id FROM notes`)).rows.map((r) => r.id as string)
      expect(left.sort()).toEqual([real, typed, answered, reply].sort())
    },
    SCHEMA_TIMEOUT,
  )

  test(
    'an unforced migration from the previous revision runs the Garmin sleep time repair (#1173)',
    async () => {
      const db = await freshUserDb(SLEEP_TIMES, `aurboda_${SLEEP_TIMES}`)
      await initializeSchema(SLEEP_TIMES)
      const previous = _hashSchema(
        MIGRATION_REVISION - 1,
        tableCreationOrder.map((key) => [key, createTableStatements[key]]),
      )
      await db.query(
        `DELETE FROM schema_migrations WHERE name LIKE 'schema@%' OR name LIKE 'repair_garmin_sleep_%'`,
      )
      await db.query(`INSERT INTO schema_migrations (name) VALUES ($1)`, [`schema@${previous}`])
      const sleep = (
        await db.query(
          `INSERT INTO activities (source, external_id, activity_type, start_time, end_time, data)
           VALUES ('garmin', 'garmin-sleep-2026-09-22', 'sleep', '2026-09-22T21:00:00Z', '2026-09-23T05:00:00Z', '{}')
           RETURNING id`,
        )
      ).rows[0].id as string
      await db.query(
        `INSERT INTO raw_records (source, record_type, external_id, recorded_at, data)
         VALUES ('garmin', 'garmin_sleep', 'garmin-sleep-2026-09-22', '2026-09-22T00:00:00Z', $1)`,
        [
          JSON.stringify({
            dailySleepDTO: {
              sleepEndTimestampGMT: Date.parse('2026-09-22T05:00:00Z'),
              sleepStartTimestampGMT: Date.parse('2026-09-21T21:00:00Z'),
            },
          }),
        ],
      )

      expect(await migrateSchema(SLEEP_TIMES)).toBe(true)

      const applied = await db.query(
        `SELECT 1 FROM schema_migrations WHERE name = 'repair_garmin_sleep_times_v1'`,
      )
      expect(applied.rowCount).toBe(1)
      const span = await db.query(`SELECT start_time, end_time FROM activities WHERE id = $1`, [sleep])
      expect(span.rows).toEqual([
        { end_time: new Date('2026-09-22T05:00:00Z'), start_time: new Date('2026-09-21T21:00:00Z') },
      ])
      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
    },
    SCHEMA_TIMEOUT,
  )

  /** A database whose last sweep predates this build, holding legacy `tags` rows still to migrate. */
  const legacyTagsDb = async (user: string): Promise<UserDb> => {
    const db = await freshUserDb(user, `aurboda_${user}`)
    await initializeSchema(user)
    await db.query(`DELETE FROM schema_migrations WHERE name LIKE 'schema@%'`)
    return db
  }

  const insertTag = async (db: UserDb, tag: string, deleted = false): Promise<string> =>
    (
      await db.query(
        `INSERT INTO tags (source, external_id, tag, start_time, end_time, deleted_at)
         VALUES ('oura', $1, $2, '2023-05-01T20:00:00Z', '2023-05-01T21:00:00Z', $3) RETURNING id`,
        [randomUUID(), tag, deleted ? new Date() : null],
      )
    ).rows[0].id as string

  test(
    'migration gives a legacy tag that names no activity type a type of its own (#1489)',
    async () => {
      const db = await legacyTagsDb(LEGACY_TAGS)
      const sauna = await insertTag(db, 'Sauna (hot)')
      const deleted = await insertTag(db, 'Cold plunge', true)
      const nameless = await insertTag(db, '!!!')

      expect(await migrateSchema(LEGACY_TAGS)).toBe(true)

      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
      const activities = await db.query(
        `SELECT id, activity_type FROM activities WHERE id = ANY($1::uuid[])`,
        [[sauna, deleted, nameless]],
      )
      expect(activities.rows.map((r) => [r.id, r.activity_type]).toSorted()).toEqual(
        [
          [sauna, 'sauna_hot'],
          [deleted, 'cold_plunge'],
        ].toSorted(),
      )
      const types = await db.query(
        `SELECT name, display_name, display_category FROM activity_type_definitions
          WHERE name IN ('sauna_hot', 'cold_plunge', '') ORDER BY name`,
      )
      expect(types.rows).toEqual([
        { display_category: 'other', display_name: 'Cold plunge', name: 'cold_plunge' },
        { display_category: 'other', display_name: 'Sauna (hot)', name: 'sauna_hot' },
      ])
    },
    SCHEMA_TIMEOUT,
  )

  test(
    'migration keeps a generic exercise whose Health Connect type name is no activity type, and still migrates the tags (#1489)',
    async () => {
      const db = await legacyTagsDb(UNKNOWN_EXERCISE)
      const tag = await insertTag(db, 'Sauna')
      const exercise = (
        await db.query(
          `INSERT INTO activities (source, activity_type, start_time, end_time, data)
           VALUES ('health_connect', 'exercise', '2023-05-01T08:00:00Z', '2023-05-01T09:00:00Z',
                   '{"exerciseTypeName": "unknown"}') RETURNING id`,
        )
      ).rows[0].id as string

      expect(await migrateSchema(UNKNOWN_EXERCISE)).toBe(true)

      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
      const rows = await db.query(`SELECT id, activity_type FROM activities WHERE id = ANY($1::uuid[])`, [
        [tag, exercise],
      ])
      expect(rows.rows.map((r) => [r.id, r.activity_type]).toSorted()).toEqual(
        [
          [tag, 'sauna'],
          [exercise, 'exercise'],
        ].toSorted(),
      )
    },
    SCHEMA_TIMEOUT,
  )

  test(
    'migration merges an alias-less tag definition into an alias-less type it names (#1489)',
    async () => {
      const db = await legacyTagsDb(YOGA_DEFINITION)
      const definition = (await db.query(`INSERT INTO tag_definitions (name) VALUES ('Yoga') RETURNING id`))
        .rows[0].id as string
      const tag = (
        await db.query(
          `INSERT INTO tags (source, external_id, tag, tag_definition_id, start_time, end_time)
           VALUES ('aurboda', $1, 'Yoga', $2, '2023-05-01T07:00:00Z', '2023-05-01T08:00:00Z') RETURNING id`,
          [randomUUID(), definition],
        )
      ).rows[0].id as string

      expect(await migrateSchema(YOGA_DEFINITION)).toBe(true)

      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
      const activity = await db.query(`SELECT activity_type FROM activities WHERE id = $1`, [tag])
      expect(activity.rows).toEqual([{ activity_type: 'yoga' }])
      const yoga = await db.query(`SELECT aliases FROM activity_type_definitions WHERE name = 'yoga'`)
      expect(yoga.rows).toEqual([{ aliases: [] }])
    },
    SCHEMA_TIMEOUT,
  )

  test(
    'a failing legacy tags step is logged, the rest of the sweep lands, and the fingerprint is withheld (#1496)',
    async () => {
      const db = await legacyTagsDb(FAILING_TAGS)
      const tag = await insertTag(db, 'Sauna')
      await db.query(`DELETE FROM schema_migrations WHERE name = 'gravl_sets_note_v1'`)
      // Only this step reads the column, so the rest of the sweep runs without it.
      await db.query(`ALTER TABLE tag_definitions DROP COLUMN show_on_timeline`)
      const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

      try {
        expect(await migrateSchema(FAILING_TAGS)).toBe(true)
        expect(warn).toHaveBeenCalledWith(
          expect.stringContaining(`legacy tags into activities failed for ${FAILING_TAGS}`),
          expect.objectContaining({ code: '42703' }),
        )
        expect(warn).toHaveBeenCalledWith(expect.stringContaining(`fingerprint withheld for ${FAILING_TAGS}`))
      } finally {
        warn.mockRestore()
      }

      expect(await schemaUpToDate(db, schemaFingerprint())).toBe(false)
      const lastStep = await db.query(`SELECT 1 FROM schema_migrations WHERE name = 'gravl_sets_note_v1'`)
      expect(lastStep.rowCount).toBe(1)
      expect((await db.query(`SELECT 1 FROM activities WHERE id = $1`, [tag])).rowCount).toBe(0)
    },
    SCHEMA_TIMEOUT,
  )
})
