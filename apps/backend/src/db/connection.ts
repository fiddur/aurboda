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
      console.info(`Schema error for user ${dbOrUser}, running migration and retrying: ${error}`)
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
  console.info(`New user ${user}`)
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
 * Convert a display string to snake_case identifier.
 * "Coffee" → "coffee", "Hot Bath" → "hot_bath", "[Work] Meeting" → "work_meeting"
 */
const toSnakeCase = (s: string): string =>
  s
    .replaceAll(/[[\]()]/g, '') // remove brackets/parens
    .trim()
    .toLowerCase()
    .replaceAll(/[^a-z0-9]+/g, '_') // non-alphanumeric → underscore
    .replaceAll(/^_|_$/g, '') // trim leading/trailing underscores
    .replaceAll(/_+/g, '_') || // collapse multiple underscores
  'unknown'

/**
 * Migrate tags into activities and tag_definitions into activity_type_definitions.
 * Idempotent: checks if migration already happened.
 */
const migrateTagsToActivities = async (db: Client, existingTableNames: Set<string>) => {
  if (!existingTableNames.has('tags')) return

  // Check if migration already happened (tags table is empty or activities already have external_id data)
  const tagCount = await query(db, `SELECT count(*) FROM tags WHERE deleted_at IS NULL`)
  if (parseInt(tagCount.rows[0].count, 10) === 0) return

  // Check if we already migrated (any activity has external_id)
  const migratedCheck = await query(db, `SELECT 1 FROM activities WHERE external_id IS NOT NULL LIMIT 1`)
  if (migratedCheck.rows.length > 0) return

  console.info('  🔄 Migrating tags into activities...')

  // Step 1: Merge tag_definitions into activity_type_definitions
  if (existingTableNames.has('tag_definitions') && existingTableNames.has('activity_type_definitions')) {
    // For each tag definition, create or update an activity_type_definition
    const defs = await query(db, `SELECT id, name, icon, aliases, show_on_timeline FROM tag_definitions`)
    for (const def of defs.rows) {
      const name = toSnakeCase(def.name as string)
      const displayName = def.name as string
      const icon = def.icon as string | null
      const aliases = (def.aliases as string[]) ?? []
      const showOnTimeline = (def.show_on_timeline as boolean) ?? true

      await query(
        db,
        `INSERT INTO activity_type_definitions (name, display_name, display_category, icon, aliases, show_on_timeline)
         VALUES ($1, $2, 'other', $3, $4, $5)
         ON CONFLICT (name) DO UPDATE SET
           icon = COALESCE(EXCLUDED.icon, activity_type_definitions.icon),
           aliases = (
             SELECT array_agg(DISTINCT elem)
             FROM unnest(activity_type_definitions.aliases || EXCLUDED.aliases) AS elem
           ),
           show_on_timeline = EXCLUDED.show_on_timeline,
           updated_at = NOW()`,
        [name, displayName, icon, aliases, showOnTimeline],
      )
    }
  }

  // Step 2: Flatten exercise subtypes in existing activities
  // exercise + exerciseTypeName → the exercise type directly
  await query(
    db,
    `UPDATE activities
     SET activity_type = data->>'exerciseTypeName'
     WHERE activity_type = 'exercise'
       AND data->>'exerciseTypeName' IS NOT NULL
       AND data->>'exerciseTypeName' != ''`,
  )

  // Step 3: Insert tags as activities
  // Use tag_definition name (snake_cased) as activity_type, or the tag text itself
  await query(
    db,
    `INSERT INTO activities (id, source, external_id, activity_type, start_time, end_time, title, data, deleted_at)
     SELECT
       t.id,
       t.source,
       t.external_id,
       COALESCE(
         (SELECT lower(regexp_replace(regexp_replace(trim(both '_' from regexp_replace(lower(td.name), '[^a-z0-9]+', '_', 'g')), '_+', '_', 'g'), '^_|_$', '', 'g'))
          FROM tag_definitions td WHERE td.id = t.tag_definition_id),
         lower(regexp_replace(regexp_replace(trim(both '_' from regexp_replace(lower(t.tag), '[^a-z0-9]+', '_', 'g')), '_+', '_', 'g'), '^_|_$', '', 'g'))
       ),
       t.start_time,
       t.end_time,
       CASE
         WHEN t.tag_definition_id IS NOT NULL THEN NULL
         WHEN t.tag ~ '\\[.*\\]' THEN regexp_replace(t.tag, '^\\[.*?\\]\\s*', '')
         ELSE NULL
       END,
       CASE
         WHEN t.tag_key IS NOT NULL THEN jsonb_build_object('tag_key', t.tag_key)
         ELSE NULL
       END,
       t.deleted_at
     FROM tags t
     ON CONFLICT DO NOTHING`,
  )

  // Step 4: Update notes entity_type from 'tag' to 'activity'
  if (existingTableNames.has('notes')) {
    await query(db, `UPDATE notes SET entity_type = 'activity' WHERE entity_type = 'tag'`)
  }

  console.info('  ✅ Tags migrated into activities')
}

/**
 * Run database migrations for a user.
 * Checks which tables exist and creates missing ones.
 */
// eslint-disable-next-line complexity -- migration functions inherently have many conditional branches
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
    await query(db, `ALTER TABLE activities ADD COLUMN IF NOT EXISTS external_id VARCHAR(255)`)
    // Widen activity_type from VARCHAR(50) to VARCHAR(100) for longer type names
    await query(db, `ALTER TABLE activities ALTER COLUMN activity_type TYPE VARCHAR(100)`)
    // Replace old unique constraint and non-unique index with partial unique indexes
    await query(db, `ALTER TABLE activities DROP CONSTRAINT IF EXISTS unique_activity`)
    // Drop old non-unique idx_activities_type_time so we can recreate as UNIQUE with WHERE clause
    await query(db, `DROP INDEX IF EXISTS idx_activities_type_time`)
    await query(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_ext_id ON activities (source, external_id) WHERE external_id IS NOT NULL`,
    )
    await query(
      db,
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_activities_type_time ON activities (source, activity_type, start_time) WHERE external_id IS NULL`,
    )
  }
  if (existingTableNames.has('activity_type_definitions')) {
    await query(
      db,
      `ALTER TABLE activity_type_definitions ADD COLUMN IF NOT EXISTS aliases TEXT[] NOT NULL DEFAULT '{}'`,
    )
    await query(
      db,
      `ALTER TABLE activity_type_definitions ADD COLUMN IF NOT EXISTS health_connect_record_type VARCHAR(100)`,
    )
    await query(
      db,
      `ALTER TABLE activity_type_definitions ADD COLUMN IF NOT EXISTS health_connect_exercise_type INTEGER`,
    )
    // Widen icon from VARCHAR(50) to TEXT to support URLs
    await query(db, `ALTER TABLE activity_type_definitions ALTER COLUMN icon TYPE TEXT`)
    await query(db, `ALTER TABLE activity_type_definitions ADD COLUMN IF NOT EXISTS data_schema JSONB`)
  }
  if (existingTableNames.has('locations')) {
    await query(db, `ALTER TABLE locations ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
  }
  if (existingTableNames.has('time_series')) {
    await query(db, `ALTER TABLE time_series ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ`)
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

  if (existingTableNames.has('deduction_rules')) {
    await query(
      db,
      `ALTER TABLE deduction_rules ADD COLUMN IF NOT EXISTS mode VARCHAR(10) NOT NULL DEFAULT 'create'`,
    )
    await query(db, `ALTER TABLE deduction_rules ADD COLUMN IF NOT EXISTS output_data JSONB`)
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

  // Migrate tags into activities and tag_definitions into activity_type_definitions
  await migrateTagsToActivities(db, existingTableNames)

  // Migrate generic 'exercise' activities to their specific type.
  // (idempotent — only updates activities that still have the generic type)
  // Must run BEFORE the definition backfill so new exercise types get definitions created.
  if (existingTableNames.has('activities')) {
    // Step 1: Migrate activities that have activity_type_key in data (legacy path)
    await query(
      db,
      `UPDATE activities
       SET activity_type = data->>'activity_type_key',
           data = data - 'activity_type_key'
       WHERE activity_type = 'exercise'
         AND data->>'activity_type_key' IS NOT NULL
         AND data->>'activity_type_key' != 'unknown'
         AND deleted_at IS NULL`,
    )

    // Step 2: Migrate activities that have exerciseTypeName in data (Health Connect path)
    // Skips generic types (other_workout, unknown) and avoids unique constraint conflicts.
    await query(
      db,
      `UPDATE activities
       SET activity_type = data->>'exerciseTypeName'
       WHERE activity_type = 'exercise'
         AND data->>'exerciseTypeName' IS NOT NULL
         AND data->>'exerciseTypeName' NOT IN ('other_workout', 'unknown')
         AND deleted_at IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM activities a2
           WHERE a2.source = activities.source
             AND a2.activity_type = activities.data->>'exerciseTypeName'
             AND a2.start_time = activities.start_time
             AND a2.external_id IS NULL
             AND a2.id != activities.id
         )`,
    )
  }

  // Step 3: Align Garmin typeKey names with HC exercise type names.
  // Garmin uses modifier_noun (e.g., treadmill_running), HC uses noun_modifier (running_treadmill).
  if (existingTableNames.has('activities')) {
    const garminNameAliases: [string, string][] = [
      ['indoor_rowing', 'rowing_machine'],
      ['open_water_swimming', 'swimming_open_water'],
      ['pool_swimming', 'swimming_pool'],
      ['stair_stepper', 'stair_climbing_machine'],
      ['stationary_biking', 'biking_stationary'],
      ['treadmill_running', 'running_treadmill'],
    ]
    for (const [oldName, newName] of garminNameAliases) {
      await query(db, `UPDATE activities SET activity_type = $1 WHERE activity_type = $2 AND deleted_at IS NULL`, [
        newName,
        oldName,
      ])
    }
  }

  // Fix display_category for activity types that were auto-created as 'other' but should be wellness
  if (existingTableNames.has('activity_type_definitions')) {
    const wellnessTypes = ['breathwork', 'cold_exposure', 'hot_bath', 'sauna']
    for (const name of wellnessTypes) {
      await query(
        db,
        `UPDATE activity_type_definitions SET display_category = 'wellness'
         WHERE name = $1 AND display_category = 'other'`,
        [name],
      )
    }
  }

  // Ensure every activity_type in use has a corresponding definition (idempotent)
  if (existingTableNames.has('activity_type_definitions') && existingTableNames.has('activities')) {
    await query(
      db,
      `INSERT INTO activity_type_definitions (name, display_name, display_category)
       SELECT DISTINCT a.activity_type,
         initcap(replace(a.activity_type, '_', ' ')),
         'other'
       FROM activities a
       WHERE NOT EXISTS (
         SELECT 1 FROM activity_type_definitions atd WHERE atd.name = a.activity_type
       )
         AND a.activity_type ~ '^[a-z][a-z0-9_]*$'
         AND a.deleted_at IS NULL
       ON CONFLICT (name) DO NOTHING`,
    )
  }

  // Copy icons from old tag_definitions to activity_type_definitions (idempotent)
  if (existingTableNames.has('tag_definitions') && existingTableNames.has('activity_type_definitions')) {
    await query(
      db,
      `UPDATE activity_type_definitions atd
       SET icon = td.icon, updated_at = NOW()
       FROM tag_definitions td
       WHERE lower(regexp_replace(regexp_replace(trim(both '_' from regexp_replace(lower(td.name), '[^a-z0-9]+', '_', 'g')), '_+', '_', 'g'), '^_|_$', '', 'g')) = atd.name
         AND td.icon IS NOT NULL
         AND atd.icon IS NULL`,
    )
  }

  // Migrate goals and custom_metrics from user_settings JSONB to their own tables
  await migrateGoalsAndCustomMetrics(db, existingTableNames)

  // Fix activities with invalid activity_type names (e.g. UUID-like values starting with a digit).
  // Prefix with 't_' to make them valid, then create definitions for them.
  if (existingTableNames.has('activities') && existingTableNames.has('activity_type_definitions')) {
    await query(
      db,
      `UPDATE activities SET activity_type = 't_' || activity_type
       WHERE activity_type !~ '^[a-z][a-z0-9_]*$'
         AND ('t_' || activity_type) ~ '^[a-z][a-z0-9_]*$'`,
    )
    // Create definitions for the newly prefixed types
    await query(
      db,
      `INSERT INTO activity_type_definitions (name, display_name, display_category)
       SELECT DISTINCT a.activity_type,
         initcap(replace(a.activity_type, '_', ' ')),
         'other'
       FROM activities a
       WHERE NOT EXISTS (
         SELECT 1 FROM activity_type_definitions atd WHERE atd.name = a.activity_type
       )
         AND a.activity_type ~ '^[a-z][a-z0-9_]*$'
       ON CONFLICT (name) DO NOTHING`,
    )
  }

  // Add foreign key constraints (idempotent)
  if (existingTableNames.has('activities') && existingTableNames.has('activity_type_definitions')) {
    await query(
      db,
      `DO $$ BEGIN
         ALTER TABLE activities ADD CONSTRAINT fk_activities_type
           FOREIGN KEY (activity_type) REFERENCES activity_type_definitions(name) ON UPDATE CASCADE;
       EXCEPTION WHEN duplicate_object THEN NULL;
       END $$`,
    )
  }
  if (existingTableNames.has('deduction_rules') && existingTableNames.has('activity_type_definitions')) {
    await query(
      db,
      `DO $$ BEGIN
         ALTER TABLE deduction_rules ADD CONSTRAINT fk_deduction_rules_type
           FOREIGN KEY (output_activity_type) REFERENCES activity_type_definitions(name) ON UPDATE CASCADE;
       EXCEPTION WHEN duplicate_object THEN NULL;
       END $$`,
    )
  }
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
