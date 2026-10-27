import { randomBytes } from 'node:crypto'
import { Client } from 'pg'
import { inject } from 'vitest'

import { _setDbForUser } from '../db/index.ts'
import { createRolePool, type UserDb } from '../db/pool.ts'

export interface TestDatabase {
  uri: string
  drop: () => Promise<void>
}

let database: TestDatabase | null = null
let client: Client | null = null
let pool: UserDb | null = null

const TEST_USER = 'testuser'

const adminQuery = async (adminUri: string, sql: string): Promise<void> => {
  const admin = new Client({ connectionString: adminUri })
  await admin.connect()
  try {
    await admin.query(sql)
  } finally {
    await admin.end()
  }
}

/**
 * A fresh database on the run's shared server, copied from the schema template that
 * `global-setup.ts` prepared.
 */
export const createTestDatabase = async (): Promise<TestDatabase> => {
  const adminUri = inject('pgAdminUri')
  const template = inject('pgTemplateDb')
  if (!adminUri || !template) {
    throw new Error('Test database not available: this run started without the integration global setup')
  }

  const name = `t_${randomBytes(6).toString('hex')}`
  await adminQuery(adminUri, `CREATE DATABASE "${name}" TEMPLATE "${template}"`)
  const uri = new URL(adminUri)
  uri.pathname = `/${name}`

  return {
    // A lingering connection makes the drop fail; the container goes at the end of the run anyway.
    drop: () => adminQuery(adminUri, `DROP DATABASE IF EXISTS "${name}"`).catch(() => {}),
    uri: uri.toString(),
  }
}

/**
 * Call this in beforeAll().
 */
export const startTestDb = async (): Promise<void> => {
  database = await createTestDatabase()

  client = new Client({ connectionString: database.uri })
  await client.connect()

  // The user's queries go through a real pool, as in production, so parallel
  // statements and transactions run on separate connections.
  pool = createRolePool({ connectionString: database.uri, max: 5 })
  _setDbForUser(TEST_USER, pool)
}

/** Connection URI of this file's test database, for tests that open their own connections. */
export const getTestConnectionUri = (): string => {
  if (!database) throw new Error('Test DB not started — call startTestDb() first.')
  return database.uri
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
  if (database) {
    await database.drop()
    database = null
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
    'challenge_banner',
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
    'activity_routes',
    'routes',
    'activity_tracks',
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
    'custom_metrics',
    'goals',
    'item_value_aliases',
  ]

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`)
    } catch {
      // Table might not exist, ignore
    }
  }
}
