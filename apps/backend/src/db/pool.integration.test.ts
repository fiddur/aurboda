import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest'

import { createRolePool, type UserDb, withTransaction } from './pool.ts'

const CONTAINER_TIMEOUT = 120_000
const ROLE = 'pool_role'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>((res) => {
    resolve = res
  })
  return { promise, resolve }
}

describe('role pool against real Postgres', () => {
  let container: StartedPostgreSqlContainer
  let admin: Client
  let db: UserDb

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
      .withDatabase('pool_db')
      .withUsername('pool_owner')
      .withPassword('pool_pass')
      .start()
    admin = new Client({ connectionString: container.getConnectionUri() })
    await admin.connect()
    await admin.query(`CREATE ROLE ${ROLE} NOLOGIN`)
    await admin.query(`GRANT ${ROLE} TO pool_owner`)
    await admin.query(`CREATE TABLE items (name TEXT PRIMARY KEY)`)
    await admin.query(`GRANT SELECT, INSERT, DELETE ON items TO ${ROLE}`)
    db = createRolePool({ connectionString: container.getConnectionUri(), max: 3 }, ROLE)
  }, CONTAINER_TIMEOUT)

  afterAll(async () => {
    await db?.end()
    await admin?.end()
    await container?.stop()
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
