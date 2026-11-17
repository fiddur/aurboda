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
const centralDatabase = `central_garmin_${suffix}`
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
  await centralPool.query('TRUNCATE TABLE garmin_user_mappings')
})

const GARMIN_A = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
const GARMIN_B = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb'

describe('garmin_user_mappings', () => {
  test('maps a Garmin user id both ways and answers no previous owner for a new mapping', async () => {
    await expect(centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')).resolves.toBeNull()
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_A)).resolves.toBe('alice')
    await expect(centralDb.getGarminUserIdByUsername('alice')).resolves.toBe(GARMIN_A)
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_B)).resolves.toBeNull()
    await expect(centralDb.getGarminUserIdByUsername('bob')).resolves.toBeNull()
  })

  test('reconnecting the same Garmin account to the same user answers no previous owner', async () => {
    await centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')
    await expect(centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')).resolves.toBeNull()
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_A)).resolves.toBe('alice')
  })

  test('a Garmin account connected from another user moves and answers the previous owner', async () => {
    await centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')
    await expect(centralDb.upsertGarminUserMapping(GARMIN_A, 'bob')).resolves.toBe('alice')
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_A)).resolves.toBe('bob')
    await expect(centralDb.getGarminUserIdByUsername('alice')).resolves.toBeNull()
  })

  test('a user reconnecting with a different Garmin account drops the old mapping', async () => {
    await centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')
    await expect(centralDb.upsertGarminUserMapping(GARMIN_B, 'alice')).resolves.toBeNull()
    await expect(centralDb.getGarminUserIdByUsername('alice')).resolves.toBe(GARMIN_B)
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_A)).resolves.toBeNull()
  })

  test('deletes a user’s mapping', async () => {
    await centralDb.upsertGarminUserMapping(GARMIN_A, 'alice')
    await expect(centralDb.deleteGarminUserMappingByUsername('alice')).resolves.toBe(true)
    await expect(centralDb.deleteGarminUserMappingByUsername('alice')).resolves.toBe(false)
    await expect(centralDb.getUsernameByGarminUserId(GARMIN_A)).resolves.toBeNull()
  })
})
