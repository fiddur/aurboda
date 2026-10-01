import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, test } from 'vitest'

import { schemaFingerprint } from '../schema.ts'
import { getTestConnectionUri, getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { _setDbForUser, initializeSchema, schemaUpToDate } from './connection.ts'
import { createRolePool, type UserDb } from './pool.ts'

const CONTAINER_TIMEOUT = 120_000

const pools: UserDb[] = []

/** A new database prepared the way `makeNewUserDb` prepares one, routed to `user`. */
const freshUserDb = async (user: string): Promise<UserDb> => {
  const database = `init_${user}`
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

  test('records the schema fingerprint on a fresh database, so the first migration skips', async () => {
    const db = await freshUserDb('fresh')
    await initializeSchema('fresh')
    expect(await schemaUpToDate(db, schemaFingerprint())).toBe(true)
  })

  test('records nothing on a database that already held tables', async () => {
    const db = await freshUserDb('legacy')
    await db.query(`CREATE TABLE hcdata (id SERIAL PRIMARY KEY, data JSONB)`)
    await initializeSchema('legacy')
    expect(await schemaUpToDate(db, schemaFingerprint())).toBe(false)
  })
})
