import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, describe, expect, inject, test } from 'vitest'

import { getTestDbClient, startTestDb, stopTestDb } from '../test/db-test-helper.ts'
import { getLargestTables, getUserDatabaseSizes } from './database-sizes.ts'

const CONTAINER_TIMEOUT = 120_000

beforeAll(async () => {
  await startTestDb()
}, CONTAINER_TIMEOUT)

afterAll(async () => {
  await stopTestDb()
})

describe('getUserDatabaseSizes', () => {
  test('sizes every aurboda_ database by username and leaves other databases out', async () => {
    const admin = new Client({ connectionString: inject('pgAdminUri') })
    await admin.connect()
    const username = `sizes_${randomBytes(4).toString('hex')}`
    try {
      await admin.query(`CREATE DATABASE "aurboda_${username}"`)
      const sizes = await getUserDatabaseSizes(admin)

      expect(sizes.get(username)).toBeGreaterThan(0)
      expect([...sizes.keys()].every((name) => !name.startsWith('aurboda_'))).toBe(true)
      expect(sizes.has('postgres')).toBe(false)
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "aurboda_${username}"`)
      await admin.end()
    }
  })
})

describe('getLargestTables', () => {
  test('lists public tables largest first, up to the limit', async () => {
    const db = getTestDbClient()
    await db.query('CREATE TABLE size_probe (payload TEXT)')
    await db.query(
      `INSERT INTO size_probe SELECT md5(n::text) || repeat('x', 500) FROM generate_series(1, 4000) AS n`,
    )

    const tables = await getLargestTables(db, 5)

    expect(tables).toHaveLength(5)
    expect(tables[0]).toEqual({ bytes: expect.any(Number), table: 'size_probe' })
    const bytes = tables.map((t) => t.bytes)
    expect(bytes).toEqual([...bytes].sort((a, b) => b - a))
  })

  test('leaves out tables an extension owns', async () => {
    const tables = await getLargestTables(getTestDbClient(), 1000)
    expect(tables.map((t) => t.table)).not.toContain('spatial_ref_sys')
  })

  test('defaults to ten tables', async () => {
    expect(await getLargestTables(getTestDbClient())).toHaveLength(10)
  })
})
