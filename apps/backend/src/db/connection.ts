/**
 * Database connection management and schema initialization.
 */
import { Client, type QueryResultRow } from 'pg'
import format from 'pg-format'

import { createTableStatements, tableCreationOrder } from '../schema.ts'

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
 * Check if an error is a PostgreSQL schema error that migration can fix.
 * Includes missing tables/columns and NOT NULL violations (from columns
 * that became nullable but the migration hasn't run yet).
 * @internal Exported for testing.
 */
export const _isSchemaError = (error: unknown): boolean => {
  if (!(error instanceof Error)) return false
  const code = (error as Error & { code?: string }).code
  // 42P01 = undefined_table, 42703 = undefined_column, 23502 = not_null_violation
  return code === '42P01' || code === '42703' || code === '23502'
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

/** Add an alias to an existing definition, or create a new one and link tags. */
const backfillCreateOrLinkDefinition = async (
  db: Client,
  createdByLowerName: Map<string, string>,
  name: string,
  icon: string | null,
  aliases: string[],
  linkQuery: string,
  linkParams: (defId: string) => unknown[],
) => {
  const lowerName = name.toLowerCase()
  if (createdByLowerName.has(lowerName)) {
    const existingId = createdByLowerName.get(lowerName)!
    for (const alias of aliases) {
      if (alias !== lowerName) {
        await query(
          db,
          `UPDATE tag_definitions SET aliases = array_append(aliases, $1) WHERE id = $2 AND NOT ($1 = ANY(aliases))`,
          [alias, existingId],
        )
      }
    }
    await query(db, linkQuery, linkParams(existingId))
    return
  }

  const allAliases = [lowerName, ...aliases.filter((a) => a !== lowerName)]
  const result = await query(
    db,
    `INSERT INTO tag_definitions (name, icon, aliases) VALUES ($1, $2, $3) RETURNING id`,
    [name, icon, allAliases],
  )
  const defId = result.rows[0].id as string
  createdByLowerName.set(lowerName, defId)
  await query(db, linkQuery, linkParams(defId))
}

/** Read tag_mappings and item_icons from user_settings. */
const readTagSettingsForBackfill = async (
  db: Client,
  existingTableNames: Set<string>,
): Promise<{ tagMappings: Record<string, string>; itemIcons: Record<string, string> }> => {
  if (!existingTableNames.has('user_settings')) return { itemIcons: {}, tagMappings: {} }
  const settingsResult = await query(db, `SELECT settings FROM user_settings LIMIT 1`)
  if (settingsResult.rows.length === 0) return { itemIcons: {}, tagMappings: {} }
  const settings = settingsResult.rows[0].settings as Record<string, unknown>
  return {
    itemIcons: ((settings.item_icons ?? settings.tag_icons) as Record<string, string>) ?? {},
    tagMappings: ((settings.tag_mappings ?? settings.tagMappings) as Record<string, string>) ?? {},
  }
}

/** Backfill definitions from tag_mappings entries. */
const backfillFromMappings = async (
  db: Client,
  createdByLowerName: Map<string, string>,
  tagMappings: Record<string, string>,
  itemIcons: Record<string, string>,
) => {
  for (const [tagKey, displayName] of Object.entries(tagMappings)) {
    const icon = itemIcons[displayName] ?? itemIcons[tagKey] ?? null
    const aliases = tagKey.toLowerCase() !== displayName.toLowerCase() ? [tagKey.toLowerCase()] : []
    await backfillCreateOrLinkDefinition(
      db,
      createdByLowerName,
      displayName,
      icon,
      aliases,
      `UPDATE tags SET tag_definition_id = $1 WHERE (tag_key = $2 OR (tag_definition_id IS NULL AND tag = $3 AND source IN ('aurboda', 'manual', 'oura')))`,
      (defId) => [defId, tagKey, displayName],
    )
  }
}

/** Backfill definitions from unmapped Oura tags. */
const backfillFromOuraTags = async (
  db: Client,
  createdByLowerName: Map<string, string>,
  itemIcons: Record<string, string>,
) => {
  const rows = await query(
    db,
    `SELECT tag_key, tag FROM tags
     WHERE tag_key IS NOT NULL AND tag_definition_id IS NULL AND deleted_at IS NULL AND source = 'oura'
     GROUP BY tag_key, tag ORDER BY MAX(start_time) DESC`,
  )
  for (const row of rows.rows) {
    const tagName = row.tag as string
    const tagKey = row.tag_key as string
    const icon = itemIcons[tagName] ?? null
    const aliases = tagKey.toLowerCase() !== tagName.toLowerCase() ? [tagKey.toLowerCase()] : []
    await backfillCreateOrLinkDefinition(
      db,
      createdByLowerName,
      tagName,
      icon,
      aliases,
      `UPDATE tags SET tag_definition_id = $1 WHERE tag_key = $2 AND tag_definition_id IS NULL`,
      (defId) => [defId, tagKey],
    )
  }
}

/** Backfill definitions from manual/aurboda tags without tag_key. */
const backfillFromManualTags = async (
  db: Client,
  createdByLowerName: Map<string, string>,
  itemIcons: Record<string, string>,
) => {
  const rows = await query(
    db,
    `SELECT tag FROM tags
     WHERE tag_definition_id IS NULL AND deleted_at IS NULL AND source IN ('aurboda', 'manual') AND tag_key IS NULL
     GROUP BY tag ORDER BY MAX(start_time) DESC`,
  )
  for (const row of rows.rows) {
    const tagName = row.tag as string
    const icon = itemIcons[tagName] ?? null
    await backfillCreateOrLinkDefinition(
      db,
      createdByLowerName,
      tagName,
      icon,
      [],
      `UPDATE tags SET tag_definition_id = $1 WHERE tag_definition_id IS NULL AND lower(tag) = $2 AND source IN ('aurboda', 'manual')`,
      (defId) => [defId, tagName.toLowerCase()],
    )
  }
}

/**
 * Backfill tag_definitions from existing tag data and user_settings tag_mappings.
 * Idempotent: skips if definitions already exist.
 */
const backfillTagDefinitions = async (db: Client, existingTableNames: Set<string>) => {
  if (!existingTableNames.has('tag_definitions') && !existingTableNames.has('tags')) return

  const countResult = await query(db, `SELECT count(*) FROM tag_definitions`)
  if (parseInt(countResult.rows[0].count, 10) > 0) return

  const { tagMappings, itemIcons } = await readTagSettingsForBackfill(db, existingTableNames)
  const createdByLowerName = new Map<string, string>()

  await backfillFromMappings(db, createdByLowerName, tagMappings, itemIcons)
  await backfillFromOuraTags(db, createdByLowerName, itemIcons)
  await backfillFromManualTags(db, createdByLowerName, itemIcons)
}

/** Add tag_definition_id FK column to tags table if not present. */
const migrateTagDefinitionFk = async (db: Client) => {
  await query(db, `ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_definition_id UUID`)
  await query(
    db,
    `DO $$ BEGIN
       IF NOT EXISTS (
         SELECT 1 FROM information_schema.table_constraints
         WHERE constraint_name = 'tags_tag_definition_id_fkey' AND table_name = 'tags'
       ) THEN
         ALTER TABLE tags ADD CONSTRAINT tags_tag_definition_id_fkey
           FOREIGN KEY (tag_definition_id) REFERENCES tag_definitions(id);
       END IF;
     END $$`,
  )
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
    await query(db, `ALTER TABLE tags ADD COLUMN IF NOT EXISTS tag_definition_id UUID`)
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
    await query(db, `ALTER TABLE productivity ADD COLUMN IF NOT EXISTS title TEXT`)
    await query(db, `ALTER TABLE productivity ADD COLUMN IF NOT EXISTS resolved_category TEXT[]`)
    // Update unique constraint to include device_name for multi-device support
    await query(db, `ALTER TABLE productivity DROP CONSTRAINT IF EXISTS unique_productivity`)
    await query(
      db,
      `ALTER TABLE productivity ADD CONSTRAINT unique_productivity UNIQUE (source, start_time, activity, device_name)`,
    )
  }

  if (existingTableNames.has('meals')) {
    await query(db, `ALTER TABLE meals ADD COLUMN IF NOT EXISTS sensitivities TEXT[]`)
  }

  if (existingTableNames.has('screentime_categories')) {
    await query(
      db,
      `ALTER TABLE screentime_categories ADD COLUMN IF NOT EXISTS exclude_from_screentime BOOLEAN DEFAULT FALSE`,
    )
  }

  if (existingTableNames.has('outbound_sync_queue')) {
    await query(
      db,
      `ALTER TABLE outbound_sync_queue ADD COLUMN IF NOT EXISTS fail_count INT NOT NULL DEFAULT 0`,
    )
    await query(db, `ALTER TABLE outbound_sync_queue ADD COLUMN IF NOT EXISTS fail_reason TEXT`)
  }

  // Migrate notes entity_id from UUID to TEXT (supports composite keys for metrics)
  if (existingTableNames.has('notes')) {
    await query(db, `ALTER TABLE notes ALTER COLUMN entity_id TYPE TEXT`)
    // Add time columns so notes can be queried by time range (inherited from parent entity)
    await query(db, `ALTER TABLE notes ADD COLUMN IF NOT EXISTS start_time TIMESTAMPTZ`)
    await query(db, `ALTER TABLE notes ADD COLUMN IF NOT EXISTS end_time TIMESTAMPTZ`)
    // Add source column to distinguish synced notes from user-created ones
    await query(db, `ALTER TABLE notes ADD COLUMN IF NOT EXISTS source VARCHAR(50)`)
  }

  // Drop NOT NULL on report_entries value/unit — values now live in time_series
  if (existingTableNames.has('report_entries')) {
    await query(db, `ALTER TABLE report_entries ALTER COLUMN value DROP NOT NULL`)
    await query(db, `ALTER TABLE report_entries ALTER COLUMN unit DROP NOT NULL`)
  }

  // Migrate source columns to support 'aurboda' (rename 'manual' -> 'aurboda' for new data)
  // Note: existing 'manual' data is preserved; new entries use 'aurboda'

  // Create missing tables and indexes (columns now exist for index creation)
  for (const key of tableCreationOrder) {
    const tableName = key.replace('_indexes', '')
    if (!existingTableNames.has(tableName) || key.endsWith('_indexes')) {
      // Always run index creation (IF NOT EXISTS handles duplicates)
      // Create tables only if they don't exist
      await query(db, createTableStatements[key])
    }
  }

  // Add FK constraint for tag_definition_id (after tag_definitions table is created)
  await migrateTagDefinitionFk(db)

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

  // Backfill tag_definitions from existing tags and tag_mappings
  await backfillTagDefinitions(db, existingTableNames)

  // Migrate goals and custom_metrics from user_settings JSONB to their own tables
  await migrateGoalsAndCustomMetrics(db, existingTableNames)
}

/**
 * Migrate goals from user_settings JSONB into the goals table.
 * Only runs if the JSONB contains goals and the table is empty.
 */
const migrateGoalsFromSettings = async (
  db: Client,
  settings: Record<string, unknown>,
  existingTableNames: Set<string>,
) => {
  if (!existingTableNames.has('goals') || !Array.isArray(settings.goals) || settings.goals.length === 0) {
    return
  }

  const goalsCount = await query(db, `SELECT COUNT(*) as count FROM goals`)
  if (parseInt(goalsCount.rows[0].count, 10) !== 0) return

  for (const goal of settings.goals as Array<Record<string, unknown>>) {
    await query(
      db,
      `INSERT INTO goals (id, metric, min_value, max_value, time_window)
       VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, $5)
       ON CONFLICT (id) DO NOTHING`,
      [goal.id ?? null, goal.metric, goal.min ?? null, goal.max ?? null, goal.window ?? '7d'],
    )
  }
  await query(db, `UPDATE user_settings SET settings = settings - 'goals', updated_at = NOW()`)
}

/**
 * Migrate custom_metrics from user_settings JSONB into the custom_metrics table.
 * Only runs if the JSONB contains custom_metrics and the table is empty.
 */
const migrateCustomMetricsFromSettings = async (
  db: Client,
  settings: Record<string, unknown>,
  existingTableNames: Set<string>,
) => {
  if (
    !existingTableNames.has('custom_metrics') ||
    !Array.isArray(settings.custom_metrics) ||
    settings.custom_metrics.length === 0
  ) {
    return
  }

  const metricsCount = await query(db, `SELECT COUNT(*) as count FROM custom_metrics`)
  if (parseInt(metricsCount.rows[0].count, 10) !== 0) return

  for (const def of settings.custom_metrics as Array<Record<string, unknown>>) {
    await query(
      db,
      `INSERT INTO custom_metrics (name, unit, description, min_value, max_value)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (name) DO NOTHING`,
      [def.name, def.unit, def.description ?? null, def.min_value ?? null, def.max_value ?? null],
    )
  }
  await query(db, `UPDATE user_settings SET settings = settings - 'custom_metrics', updated_at = NOW()`)
}

/**
 * Migrate goals and custom_metrics from user_settings JSONB into their own tables.
 */
const migrateGoalsAndCustomMetrics = async (db: Client, existingTableNames: Set<string>) => {
  if (!existingTableNames.has('user_settings')) return

  const settingsResult = await query(db, `SELECT settings FROM user_settings LIMIT 1`)
  if (settingsResult.rows.length === 0) return

  const settings = settingsResult.rows[0].settings as Record<string, unknown>
  await migrateGoalsFromSettings(db, settings, existingTableNames)
  await migrateCustomMetricsFromSettings(db, settings, existingTableNames)
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
