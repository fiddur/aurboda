import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'

import { _setDbForUser } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'
import { createTableStatements, tableCreationOrder } from '../schema.ts'

let container: StartedPostgreSqlContainer | null = null
let client: Client | null = null
let pool: UserDb | null = null

const TEST_USER = 'testuser'

/**
 * Call this in beforeAll().
 */
export const startTestDb = async (): Promise<void> => {
  // Use PostGIS image to match production
  container = await new PostgreSqlContainer('postgis/postgis:16-3.4-alpine')
    .withDatabase('test_db')
    .withUsername('test_user')
    .withPassword('test_pass')
    .start()

  client = new Client({
    connectionString: container.getConnectionUri(),
  })
  await client.connect()

  for (const tableName of tableCreationOrder) {
    const statement = createTableStatements[tableName]
    if (statement) {
      await client.query(statement)
    }
  }

  // The user's queries go through a real pool, as in production, so parallel
  // statements and transactions run on separate connections.
  pool = createRolePool({ connectionString: container.getConnectionUri(), max: 5 })
  _setDbForUser(TEST_USER, pool)
}

/** Connection URI of the test container, for tests that open their own connections. */
export const getTestConnectionUri = (): string => {
  if (!container) throw new Error('Test DB not started — call startTestDb() first.')
  return container.getConnectionUri()
}

/**
 * Get the underlying pg client for tests that need to bypass the per-user
 * routing — used by central-DB tests, which talk to a singleton client.
 */
export const getTestDbClient = (): Client => {
  if (!client) throw new Error('Test DB not started — call startTestDb() first.')
  return client
}

/**
 * Call this in afterAll().
 */
export const stopTestDb = async (): Promise<void> => {
  if (pool) {
    await pool.end()
    pool = null
  }
  if (client) {
    await client.end()
    client = null
  }
  if (container) {
    await container.stop()
    container = null
  }
}

export const getTestUser = (): string => TEST_USER

/**
 * Call this in beforeEach() for test isolation.
 */
export const cleanTestDb = async (): Promise<void> => {
  if (!client) return

  // Truncate tables in reverse order to handle foreign keys
  const tables = [
    'food_item_sensitivities',
    'sensitivity_flags',
    'shared_food_item_overrides',
    'user_nutrient_recommendations',
    'meal_food_items',
    'food_item_portions',
    'food_items',
    'report_entries',
    'reports',
    'meals',
    'notes',
    'challenge_members',
    'challenge_participations',
    'challenge_left',
    'challenges',
    'shared_dashboards',
    'autoshare_rules',
    'autoshare_suppressions',
    'feed_posts',
    'feed_actor',
    'feed_follower',
    'feed_following',
    'feed_reaction',
    'feed_post_reaction',
    'timeline_entry',
    'profile_avatar',
    'tags',
    'tag_definitions',
    'time_series',
    'activities',
    'productivity',
    'places',
    'locations',
    'named_locations',
    'detected_locations',
    'raw_records',
    'lab_results',
    'oauth_tokens',
    'sync_state',
    'user_settings',
    'mcp_sessions',
    'lastfm_tag_rules',
    'deduction_rules',
    'outbound_sync_queue',
    'screentime_categories',
    'import_jobs',
  ]

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`)
    } catch {
      // Table might not exist, ignore
    }
  }
}
