import { randomUUID } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { schemaFingerprint } from '../schema.ts'
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
})
