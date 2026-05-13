/**
 * Shared pg-boss instance for PostgreSQL-backed job queues.
 *
 * All job queues (geocoding, deduction evaluation, etc.) share a single
 * pg-boss instance connected to the shared 'aurboda' database.
 */

import pg from 'pg'
import * as PgBossModule from 'pg-boss'

// Re-export the PgBoss type for consumers
export type PgBoss = InstanceType<typeof PgBossModule.PgBoss>
export type { Job } from 'pg-boss'

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_DB = 'aurboda'

const getDbParams = () => ({
  database: process.env.PGBOSS_DB || process.env.GEOCODE_DB || DEFAULT_DB,
  host: process.env.PGHOST || 'localhost',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
})

const buildConnectionString = (database?: string): string | null => {
  const params = getDbParams()
  const db = database || params.database

  if (!params.user || !params.password) {
    console.warn('⚠️ PGUSER/PGPASSWORD not set, job queues disabled')
    return null
  }

  return `postgresql://${params.user}:${params.password}@${params.host}:${params.port}/${db}`
}

/**
 * Ensure the shared database exists, creating it if necessary.
 */
const ensureDatabase = async (): Promise<boolean> => {
  const params = getDbParams()

  const targetClient = new pg.Client({ database: params.database })
  try {
    await targetClient.connect()
    await targetClient.end()
    return true
  } catch {
    await targetClient.end().catch(() => {})
  }

  const postgresClient = new pg.Client({ database: 'postgres' })
  try {
    await postgresClient.connect()
    await postgresClient.query(`CREATE DATABASE "${params.database}"`)
    console.info(`🗄️ Created shared database: ${params.database}`)
    return true
  } catch (error) {
    console.error(`Failed to create shared database '${params.database}':`, error)
    return false
  } finally {
    await postgresClient.end()
  }
}

// ============================================================================
// Factory
// ============================================================================

/**
 * Create and start a shared pg-boss instance.
 *
 * Returns null if the database is not available or credentials are missing.
 */
/* v8 ignore start -- requires real PostgreSQL */
export const createPgBoss = async (): Promise<PgBoss | null> => {
  const dbReady = await ensureDatabase()
  if (!dbReady) return null

  const connectionString = buildConnectionString()
  if (!connectionString) return null

  const PgBossConstructor = PgBossModule.PgBoss
  const boss = new PgBossConstructor({
    connectionString,
    // Limit connection pool size. pg-boss default is 10, but we use 3 to leave
    // room for user database connections (PostgreSQL default max_connections is 100)
    max: 3,
    schema: 'pgboss',
  })

  boss.on('error', (error: Error) => {
    console.error('🔴 pg-boss error:', error)
  })

  await boss.start()
  console.info(`📋 pg-boss started (database: ${getDbParams().database})`)

  return boss
}
/* v8 ignore stop */
