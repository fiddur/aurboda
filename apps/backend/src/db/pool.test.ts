import type { PoolClient, PoolConfig } from 'pg'

import { describe, expect, test, vi } from 'vitest'

import { createRolePool, type PoolLike, withTransaction } from './pool.ts'

interface FakeClient {
  id: number
  statements: string[]
  query: ReturnType<typeof vi.fn>
  release: ReturnType<typeof vi.fn>
}

/**
 * A pool that hands out physical clients in the order given by `checkouts`
 * (client ids), so tests control reuse. `failOn` makes any statement that
 * contains it throw.
 */
const fakePool = (opts: { checkouts: number[]; failOn?: string[] }) => {
  const clients = new Map<number, FakeClient>()
  const clientFor = (id: number): FakeClient => {
    const existing = clients.get(id)
    if (existing) return existing
    const client: FakeClient = {
      id,
      query: vi.fn(async (sql: string) => {
        client.statements.push(sql)
        if (opts.failOn?.some((f) => sql.includes(f))) throw new Error(`failed: ${sql}`)
        return { rowCount: 0, rows: [{ sql }] }
      }),
      release: vi.fn(),
      statements: [],
    }
    clients.set(id, client)
    return client
  }
  const queue = [...opts.checkouts]
  const pool: PoolLike = {
    connect: vi.fn(async () => {
      const id = queue.shift()
      if (id === undefined) throw new Error('no more checkouts')
      return clientFor(id) as unknown as PoolClient
    }),
    end: vi.fn(async () => {}),
    on: vi.fn(),
  }
  return { client: clientFor, pool }
}

const build = (fake: ReturnType<typeof fakePool>, role?: string) =>
  createRolePool({ database: 'aurboda_x' } satisfies PoolConfig, role, () => fake.pool)

describe('createRolePool', () => {
  test('registers an error listener so an idle-client error cannot crash the process', () => {
    const fake = fakePool({ checkouts: [] })
    build(fake, 'x')
    expect(fake.pool.on).toHaveBeenCalledWith('error', expect.any(Function))
  })

  test('applies SET ROLE once per physical client, before its first statement', async () => {
    const fake = fakePool({ checkouts: [1, 1, 2] })
    const db = build(fake, 'alice')

    await db.query('SELECT 1')
    await db.query('SELECT 2')
    await db.query('SELECT 3')

    expect(fake.client(1).statements).toEqual([`SET ROLE 'alice'`, 'SELECT 1', 'SELECT 2'])
    expect(fake.client(2).statements).toEqual([`SET ROLE 'alice'`, 'SELECT 3'])
  })

  test('applies no role when none is given', async () => {
    const fake = fakePool({ checkouts: [1] })
    await build(fake).query('SELECT 1')
    expect(fake.client(1).statements).toEqual(['SELECT 1'])
  })

  test('destroys a client whose SET ROLE failed and never runs the statement', async () => {
    const fake = fakePool({ checkouts: [1], failOn: ['SET ROLE'] })
    const db = build(fake, 'alice')

    await expect(db.query('SELECT secret')).rejects.toThrow('SET ROLE')

    expect(fake.client(1).statements).toEqual([`SET ROLE 'alice'`])
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
    expect(fake.client(1).release.mock.calls[0]![0]).toBeInstanceOf(Error)
  })

  test('connect() hands out a client with the role applied', async () => {
    const fake = fakePool({ checkouts: [1] })
    const client = await build(fake, 'alice').connect()
    await client.query('SELECT 1')
    expect(fake.client(1).statements).toEqual([`SET ROLE 'alice'`, 'SELECT 1'])
  })

  test('query releases the client on success', async () => {
    const fake = fakePool({ checkouts: [1] })
    const result = await build(fake, 'alice').query('SELECT 1')
    expect(result.rows).toEqual([{ sql: 'SELECT 1' }])
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
    expect(fake.client(1).release).toHaveBeenCalledWith()
  })

  test('query releases the client when the statement fails', async () => {
    const fake = fakePool({ checkouts: [1], failOn: ['BROKEN'] })
    await expect(build(fake, 'alice').query('SELECT BROKEN')).rejects.toThrow('BROKEN')
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
  })

  test('end() ends the pool', async () => {
    const fake = fakePool({ checkouts: [] })
    await build(fake).end()
    expect(fake.pool.end).toHaveBeenCalled()
  })
})

describe('withTransaction', () => {
  test('runs BEGIN, the statements and COMMIT on one client, released once', async () => {
    const fake = fakePool({ checkouts: [1] })
    const db = build(fake)

    const result = await withTransaction(db, async (tx) => {
      await tx.query('INSERT a')
      await tx.query('INSERT b')
      return 'done'
    })

    expect(result).toBe('done')
    expect(fake.client(1).statements).toEqual(['BEGIN', 'INSERT a', 'INSERT b', 'COMMIT'])
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
    expect(fake.client(1).release).toHaveBeenCalledWith()
  })

  test('rolls back, releases once and rethrows when fn throws', async () => {
    const fake = fakePool({ checkouts: [1] })
    const boom = new Error('boom')

    await expect(
      withTransaction(build(fake), async (tx) => {
        await tx.query('INSERT a')
        throw boom
      }),
    ).rejects.toBe(boom)

    expect(fake.client(1).statements).toEqual(['BEGIN', 'INSERT a', 'ROLLBACK'])
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
    expect(fake.client(1).release).toHaveBeenCalledWith()
  })

  test('destroys the client and rethrows the original error when ROLLBACK also fails', async () => {
    const fake = fakePool({ checkouts: [1], failOn: ['ROLLBACK'] })
    const boom = new Error('boom')

    await expect(
      withTransaction(build(fake), async () => {
        throw boom
      }),
    ).rejects.toBe(boom)

    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
    expect(fake.client(1).release.mock.calls[0]![0]).toBeInstanceOf(Error)
    expect((fake.client(1).release.mock.calls[0]![0] as Error).message).toContain('ROLLBACK')
  })

  test('rolls back when COMMIT fails', async () => {
    const fake = fakePool({ checkouts: [1], failOn: ['COMMIT'] })

    await expect(withTransaction(build(fake), async () => 'x')).rejects.toThrow('COMMIT')

    expect(fake.client(1).statements).toEqual(['BEGIN', 'COMMIT', 'ROLLBACK'])
    expect(fake.client(1).release).toHaveBeenCalledTimes(1)
  })

  test('applies the role before BEGIN on a fresh client', async () => {
    const fake = fakePool({ checkouts: [1] })
    await withTransaction(build(fake, 'alice'), async (tx) => tx.query('SELECT 1'))
    expect(fake.client(1).statements).toEqual([`SET ROLE 'alice'`, 'BEGIN', 'SELECT 1', 'COMMIT'])
  })
})
