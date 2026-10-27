import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createTestDatabase, type TestDatabase } from '../test/db-test-helper.ts'
import { createRolePool, type UserDb, withTransaction } from './pool.ts'

const SETUP_TIMEOUT = 120_000
// Roles are server-wide, and the server is shared by every file of the run.
const ROLE = `pool_role_${randomBytes(4).toString('hex')}`

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('role pool against real Postgres', () => {
  let database: TestDatabase
  let admin: Client
  let db: UserDb

  beforeAll(async () => {
    database = await createTestDatabase()
    admin = new Client({ connectionString: database.uri })
    await admin.connect()
    await admin.query(`CREATE ROLE ${ROLE} NOLOGIN`)
    await admin.query(`GRANT ${ROLE} TO CURRENT_USER`)
    await admin.query(`CREATE TABLE items (name TEXT PRIMARY KEY)`)
    await admin.query(`GRANT SELECT, INSERT, DELETE ON items TO ${ROLE}`)
    db = createRolePool({ connectionString: database.uri, max: 3 }, ROLE)
  }, SETUP_TIMEOUT)

  afterAll(async () => {
    await db?.end()
    await admin?.end()
    await database?.drop()
  })

  beforeEach(async () => {
    await admin.query('DELETE FROM items')
  })

  const names = async () => (await admin.query<{ name: string }>('SELECT name FROM items ORDER BY name')).rows

  test('runs concurrent statements on several connections, each with the role applied', async () => {
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        db.query<{ current_user: string; pid: number }>(
          'SELECT current_user, pg_backend_pid() AS pid, pg_sleep(0.05)',
        ),
      ),
    )
    const rows = results.map((r) => r.rows[0]!)

    expect(rows.every((r) => r.current_user === ROLE)).toBe(true)
    expect(new Set(rows.map((r) => r.pid)).size).toBeGreaterThan(1)
  })

  test('a statement outside an open transaction neither joins it nor sees its writes', async () => {
    const insideWrote = deferred()
    const outsideDone = deferred()

    const transaction = withTransaction(db, async (tx) => {
      await tx.query(`INSERT INTO items (name) VALUES ('a')`)
      insideWrote.resolve()
      await outsideDone.promise
      throw new Error('roll it back')
    })

    await insideWrote.promise
    await db.query(`INSERT INTO items (name) VALUES ('b')`)
    const seenOutside = await db.query<{ name: string }>('SELECT name FROM items ORDER BY name')
    outsideDone.resolve()

    await expect(transaction).rejects.toThrow('roll it back')
    expect(seenOutside.rows).toEqual([{ name: 'b' }])
    expect(await names()).toEqual([{ name: 'b' }])
  })

  test('a committed transaction persists', async () => {
    await withTransaction(db, async (tx) => {
      await tx.query(`INSERT INTO items (name) VALUES ('c')`)
      await tx.query(`INSERT INTO items (name) VALUES ('d')`)
    })

    expect(await names()).toEqual([{ name: 'c' }, { name: 'd' }])
  })

  test('statements inside a transaction run as the role', async () => {
    const user = await withTransaction(db, async (tx) => (await tx.query('SELECT current_user')).rows[0])
    expect(user).toEqual({ current_user: ROLE })
  })
})
