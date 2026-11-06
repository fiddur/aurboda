import type { Queryable } from './pool.ts'

const USER_DB_PREFIX = 'aurboda_'

/** Size in bytes of every per-user database, by username. Needs a connection on the cluster. */
export const getUserDatabaseSizes = async (cluster: Queryable): Promise<Map<string, number>> => {
  const result = await cluster.query<{ datname: string; bytes: string }>(
    `SELECT datname, pg_database_size(datname)::bigint AS bytes
     FROM pg_database
     WHERE datname LIKE $1`,
    [`${USER_DB_PREFIX.replace('_', '\\_')}%`],
  )
  return new Map(result.rows.map((row) => [row.datname.slice(USER_DB_PREFIX.length), Number(row.bytes)]))
}

export interface TableSize {
  table: string
  bytes: number
}

/**
 * The largest tables of the connected database's public schema, indexes and TOAST included.
 * Tables an extension owns (PostGIS's `spatial_ref_sys`) are the same in every database and left out.
 */
export const getLargestTables = async (db: Queryable, limit = 10): Promise<TableSize[]> => {
  const result = await db.query<{ table: string; bytes: string }>(
    `SELECT c.relname AS table, pg_total_relation_size(c.oid)::bigint AS bytes
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
       AND NOT EXISTS (
         SELECT 1 FROM pg_depend d
         WHERE d.classid = 'pg_class'::regclass AND d.objid = c.oid AND d.deptype = 'e'
       )
     ORDER BY 2 DESC, 1
     LIMIT $1`,
    [limit],
  )
  return result.rows.map((row) => ({ bytes: Number(row.bytes), table: row.table }))
}
