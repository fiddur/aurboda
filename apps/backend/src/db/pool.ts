import { Pool, type PoolClient, type PoolConfig, type QueryResult, type QueryResultRow } from 'pg'
import format from 'pg-format'

/** Row type defaults to `any`, as in `pg` itself, so untyped call sites keep compiling. */
export interface Queryable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  query: <T extends QueryResultRow = any>(text: string, params?: unknown[]) => Promise<QueryResult<T>>
}

export interface UserDb extends Queryable {
  connect: () => Promise<PoolClient>
  end: () => Promise<void>
}

export interface PoolLike {
  connect: () => Promise<PoolClient>
  end: () => Promise<void>
  on: (event: 'error', listener: (err: Error) => void) => unknown
}

/**
 * A pool whose every physical connection runs `SET ROLE role` once before its
 * first use. A client whose role could not be applied is destroyed rather than
 * handed out, so no statement ever runs as the bare service role.
 */
export const createRolePool = (
  config: PoolConfig,
  role?: string,
  makePool: (config: PoolConfig) => PoolLike = (c) => new Pool(c),
): UserDb => {
  const pool = makePool(config)
  // Without a listener, an error on an idle client crashes the process.
  pool.on('error', (err) =>
    console.error(`⚠️ Idle Postgres client error (${config.database ?? 'pool'}):`, err),
  )

  const roleApplied = new WeakSet<PoolClient>()

  const connect = async (): Promise<PoolClient> => {
    const client = await pool.connect()
    if (role === undefined || roleApplied.has(client)) return client
    try {
      await client.query(format('SET ROLE %L', role))
    } catch (err) {
      client.release(err instanceof Error ? err : true)
      throw err
    }
    roleApplied.add(client)
    return client
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const query = async <T extends QueryResultRow = any>(text: string, params?: unknown[]) => {
    const client = await connect()
    try {
      return await client.query<T>(text, params)
    } finally {
      client.release()
    }
  }

  return { connect, end: () => pool.end(), query }
}

/**
 * Run `fn` inside a transaction on one checked-out client. Every statement of
 * the transaction must go through the `tx` handed to `fn`: anything else runs
 * on another connection, outside the transaction.
 */
export const withTransaction = async <T>(
  db: { connect: () => Promise<PoolClient> },
  fn: (tx: Queryable) => Promise<T>,
): Promise<T> => {
  const client = await db.connect()
  let result: T
  try {
    await client.query('BEGIN')
    result = await fn(client)
    await client.query('COMMIT')
  } catch (err) {
    try {
      await client.query('ROLLBACK')
      client.release()
    } catch (rollbackErr) {
      // The connection may still be mid-transaction; it must not go back to the pool.
      client.release(rollbackErr instanceof Error ? rollbackErr : true)
    }
    throw err
  }
  client.release()
  return result
}
