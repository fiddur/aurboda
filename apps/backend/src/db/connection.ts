/**
 * Database connection management and schema initialization.
 */
import { Client, type QueryResultRow } from 'pg'
import format from 'pg-format'
import { createTableStatements, tableCreationOrder } from '../schema'

const dbByUser: Record<string, Client> = {}

const userDbName = (user: string) => `aurboda_${user}`

/**
 * Inject a database client for a user. Used for testing with testcontainers.
 * @internal
 */
export const _setClientForUser = (user: string, client: Client) => {
  dbByUser[user] = client
}

/**
 * Check if an error is a PostgreSQL schema error (missing table or column).
 * Only these errors should trigger automatic migration retry.
 * @internal Exported for testing.
 */
export const _isSchemaError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  return code === '42P01' || code === '42703' // undefined_table, undefined_column
}

const migrationInProgress: Record<string, Promise<void> | undefined> = {}

/**
 * Run migration for a user, coalescing concurrent calls.
 * If a migration is already in progress for the user, returns the existing promise.
 * @internal Exported for testing — pass a custom migrate function in tests.
 */
export const _runMigrationOnce = (
  user: string,
  migrate: (user: string) => Promise<void> = migrateSchema,
): Promise<void> => {
  const existing = migrationInProgress[user]
  if (existing) return existing

  const promise = migrate(user).finally(() => {
    delete migrationInProgress[user]
  })
  migrationInProgress[user] = promise
  return promise
}

export const query = async <T extends QueryResultRow = QueryResultRow>(
  dbOrUser: Client | string,
  queryStr: string,
  params?: unknown[],
  /** @internal Override migration function for testing. */
  migrate?: (user: string) => Promise<void>,
) => {
  const db = typeof dbOrUser === 'string' ? await getDbForUser(dbOrUser) : dbOrUser

  try {
    return await db.query<T>(queryStr, params)
  } catch (error) {
    // Only retry with migration when called with a username (not a Client directly)
    if (typeof dbOrUser === 'string' && _isSchemaError(error)) {
      console.log(`Schema error for user ${dbOrUser}, running migration and retrying: ${error}`)
      await _runMigrationOnce(dbOrUser, migrate)
      return await db.query<T>(queryStr, params)
    }
    throw error
  }
}

export const loginToUserDb = async (user: string, password: string) => {
  // Check if we already have a connection for this user
  const existing = dbByUser[user]
  if (existing) {
    // Already connected - auth is handled by tokens, no need to re-verify password
    // This avoids storing passwords in memory while maintaining security via token auth
    return
  }

  const database = userDbName(user)
  const client = new Client({ database, password, user })
  await client.connect()
  dbByUser[user] = client
}

export const makeNewUserDb = async (adminClient: Client, user: string, password: string) => {
  const database = userDbName(user)
  console.log(`New user ${user}`)
  await query(adminClient, format('CREATE USER %I WITH ENCRYPTED PASSWORD %L', user, password))
  await query(adminClient, format('GRANT %I TO %I', user, process.env.PGUSER))
  await query(adminClient, format('CREATE DATABASE %I OWNER %I', database, user))

  // Connect to the new database to create PostGIS extension (requires superuser privileges)
  // We need a separate connection because CREATE EXTENSION operates on the current database
  const newDbClient = new Client({ database })
  await newDbClient.connect()
  await query(newDbClient, 'CREATE EXTENSION IF NOT EXISTS postgis')
  await newDbClient.end()

  const client = new Client({ database, password, user })
  await client.connect()
  dbByUser[user] = client
  await initializeSchema(user)
}

export const getDbForUser = async (user: string) => {
  if (dbByUser[user]) return dbByUser[user]
  const client = new Client({ database: userDbName(user) })
  await client.connect()
  await query(client, format('SET ROLE %L', user))
  dbByUser[user] = client
  return client
}

/**
 * Initialize the database schema for a user.
 * Creates all tables and indexes if they don't exist.
 * Note: PostGIS extension is created in makeNewUserDb before this is called.
 */
export const initializeSchema = async (user: string) => {
  const db = await getDbForUser(user)

  for (const key of tableCreationOrder) {
    await query(db, createTableStatements[key])
  }
}

/**
 * Backfill tag_key for Oura tags that were already mapped via tag_mappings in user settings.
 * Reverses the mapping (display name -> programmatic key) to populate tag_key.
 */
const backfillTagKeysFromMappings = async (db: Client, existingTableNames: Set<string>) => {
  if (!existingTableNames.has('user_settings')) return

  const settingsResult = await query(db, `SELECT settings FROM user_settings LIMIT 1`)
  if (settingsResult.rows.length === 0) return

  const settings = settingsResult.rows[0].settings as Record<string, unknown>
  const tagMappings = (settings.tag_mappings ?? settings.tagMappings) as Record<string, string> | undefined
  if (!tagMappings) return

  for (const [tagKey, displayName] of Object.entries(tagMappings)) {
    // Match tags stored with the mapped display name
    await query(
      db,
      `UPDATE tags SET tag_key = $1, tag = $2
       WHERE tag_key IS NULL AND source = 'oura' AND tag = $3`,
      [tagKey, displayName, displayName],
    )
    // Also catch tags still stored with the raw programmatic key as tag name
    await query(
      db,
      `UPDATE tags SET tag_key = $1, tag = $2
       WHERE tag_key IS NULL AND source = 'oura' AND tag = $3`,
      [tagKey, displayName, tagKey],
    )
  }
}

/**
 * Run database migrations for a user.
 * Checks which tables exist and creates missing ones.
 */
export const migrateSchema = async (user: string) => {
  const db = await getDbForUser(user)
  const database = `aurboda_${user}`

  // Check which tables exist
  const existingTables = await query(
    db,
    `SELECT table_name FROM information_schema.tables WHERE table_catalog = $1 AND table_schema = 'public'`,
    [database],
  )
  const existingTableNames = new Set(existingTables.rows.map((r) => r.table_name))

  // Column migrations BEFORE index creation (indexes may reference new columns)
  if (existingTableNames.has('lastfm_tag_rules')) {
    await query(db, `ALTER TABLE lastfm_tag_rules ADD COLUMN IF NOT EXISTS merge_gap_seconds INTEGER`)
    await query(db, `ALTER TABLE lastfm_tag_rules ADD COLUMN IF NOT EXISTS artist_names JSONB`)
  }
  if (existingTableNames.has('tags')) {
    await query(db, `ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_key VARCHAR(255)`)
    await query(db, `ALTER TABLE tags ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  }
  if (existingTableNames.has('activities')) {
    await query(db, `ALTER TABLE activities ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  }
  if (existingTableNames.has('productivity')) {
    await query(db, `ALTER TABLE productivity ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
    await query(
      db,
      `ALTER TABLE productivity ADD COLUMN IF NOT EXISTS device_name VARCHAR(100) NOT NULL DEFAULT ''`,
    )
    // Update unique constraint to include device_name for multi-device support
    await query(db, `ALTER TABLE productivity DROP CONSTRAINT IF EXISTS unique_productivity`)
    await query(
      db,
      `ALTER TABLE productivity ADD CONSTRAINT unique_productivity UNIQUE (source, start_time, activity, device_name)`,
    )
  }

  // Migrate notes entity_id from UUID to TEXT (supports composite keys for metrics)
  if (existingTableNames.has('notes')) {
    await query(db, `ALTER TABLE notes ALTER COLUMN entity_id TYPE TEXT`)
  }

  // Create missing tables and indexes (columns now exist for index creation)
  for (const key of tableCreationOrder) {
    const tableName = key.replace('_indexes', '')
    if (!existingTableNames.has(tableName) || key.endsWith('_indexes')) {
      // Always run index creation (IF NOT EXISTS handles duplicates)
      // Create tables only if they don't exist
      await query(db, createTableStatements[key])
    }
  }

  // Backfill tag_key for existing Oura tags
  if (existingTableNames.has('tags')) {
    // Tags that still have programmatic names (UUID/tag_*) get tag_key = tag
    await query(
      db,
      `UPDATE tags SET tag_key = tag
       WHERE tag_key IS NULL
         AND (tag ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
              OR tag LIKE 'tag\\_%')`,
    )

    // Tags that were already mapped (tag = display name) — reverse-lookup from tag_mappings
    await backfillTagKeysFromMappings(db, existingTableNames)
  }
}

/**
 * Check if schema is initialized (has required tables).
 */
export const schemaInitialized = async (user: string) => {
  const database = userDbName(user)
  const db = await getDbForUser(user)
  const result = await query(
    db,
    `SELECT 1 FROM information_schema.tables WHERE table_catalog = $1 AND table_name = $2`,
    [database, 'raw_records'],
  )
  return result.rowCount !== 0
}
