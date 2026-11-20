import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import format from 'pg-format'
import { afterAll, beforeAll, beforeEach, describe, expect, inject, test } from 'vitest'

import { createRolePool, type UserDb, withTransaction } from '../db/pool.ts'
import { type CentralDb, createCentralDb } from './central-db.ts'

const CONTAINER_TIMEOUT = 120_000

const adminUri = () => {
  const uri = inject('pgAdminUri')
  if (!uri) {
    throw new Error('Test database not available: this run started without the integration global setup')
  }
  return new URL(uri)
}

const databaseUri = (database: string) => {
  const uri = adminUri()
  uri.pathname = `/${database}`
  return uri.toString()
}

const suffix = randomBytes(4).toString('hex')
const centralDatabase = `central_strava_${suffix}`
let admin: Client
let centralPool: UserDb
let centralDb: CentralDb

beforeAll(async () => {
  admin = new Client({ connectionString: adminUri().toString() })
  await admin.connect()
  await admin.query(format('CREATE DATABASE %I', centralDatabase))
  centralPool = createRolePool({ connectionString: databaseUri(centralDatabase), max: 3 })
  centralDb = createCentralDb({
    getClient: async () => centralPool,
    withTransaction: (fn) => withTransaction(centralPool, fn),
  })
  await centralDb.initializeCentralDb()
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await centralPool?.end()
  await admin?.query(format('DROP DATABASE IF EXISTS %I WITH (FORCE)', centralDatabase)).catch(() => {})
  await admin?.end()
})

beforeEach(async () => {
  await centralPool.query('TRUNCATE TABLE strava_athlete_mappings')
})

const ROUNDED = '9007199254740992'
const ABOVE_SAFE = '9007199254740993'
const INT64_MAX = '9223372036854775807'

describe('strava_athlete_mappings', () => {
  test('maps an athlete id to a user and deletes the mapping', async () => {
    await centralDb.upsertStravaAthleteMapping('4242', 'alice')
    await expect(centralDb.getUsernameByStravaAthleteId('4242')).resolves.toBe('alice')

    await expect(centralDb.deleteStravaAthleteMapping('4242')).resolves.toBe(true)
    await expect(centralDb.getUsernameByStravaAthleteId('4242')).resolves.toBeNull()
    await expect(centralDb.deleteStravaAthleteMapping('4242')).resolves.toBe(false)
  })

  test('keeps two ids apart that collide as JS numbers', async () => {
    expect(Number(ROUNDED)).toBe(Number(ABOVE_SAFE))

    await centralDb.upsertStravaAthleteMapping(ROUNDED, 'alice')
    await centralDb.upsertStravaAthleteMapping(ABOVE_SAFE, 'bob')

    await expect(centralDb.getUsernameByStravaAthleteId(ROUNDED)).resolves.toBe('alice')
    await expect(centralDb.getUsernameByStravaAthleteId(ABOVE_SAFE)).resolves.toBe('bob')
  })

  test('round-trips the int64 max', async () => {
    await centralDb.upsertStravaAthleteMapping(INT64_MAX, 'alice')

    await expect(centralDb.getUsernameByStravaAthleteId(INT64_MAX)).resolves.toBe('alice')
    const { rows } = await centralPool.query<{ id: string }>(
      'SELECT strava_athlete_id::text AS id FROM strava_athlete_mappings',
    )
    expect(rows).toEqual([{ id: INT64_MAX }])
  })

  test('an upsert on an existing id re-points the username', async () => {
    await centralDb.upsertStravaAthleteMapping(ABOVE_SAFE, 'alice')
    await centralDb.upsertStravaAthleteMapping(ABOVE_SAFE, 'bob')

    await expect(centralDb.getUsernameByStravaAthleteId(ABOVE_SAFE)).resolves.toBe('bob')
  })

  test('deletes every mapping of a username', async () => {
    await centralDb.upsertStravaAthleteMapping(ABOVE_SAFE, 'alice')
    await centralDb.upsertStravaAthleteMapping('4242', 'bob')

    await expect(centralDb.deleteStravaAthleteMappingByUsername('alice')).resolves.toBe(true)
    await expect(centralDb.getUsernameByStravaAthleteId(ABOVE_SAFE)).resolves.toBeNull()
    await expect(centralDb.getUsernameByStravaAthleteId('4242')).resolves.toBe('bob')
    await expect(centralDb.deleteStravaAthleteMappingByUsername('alice')).resolves.toBe(false)
  })
})
