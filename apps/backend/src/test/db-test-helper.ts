/**
 * Database test helper using testcontainers.
 *
 * Provides a real PostgreSQL instance for integration testing.
 * Uses PostGIS image to match production environment.
 */

import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import { Client } from 'pg'
import { createTableStatements, tableCreationOrder } from '../schema'

let container: StartedPostgreSqlContainer | null = null
let client: Client | null = null

/**
 * Start a PostgreSQL container for testing.
 * Call this in beforeAll().
 */
export const startTestDb = async (): Promise<Client> => {
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

  // Create all tables
  for (const tableName of tableCreationOrder) {
    const statement = createTableStatements[tableName]
    if (statement) {
      await client.query(statement)
    }
  }

  return client
}

/**
 * Stop the PostgreSQL container.
 * Call this in afterAll().
 */
export const stopTestDb = async (): Promise<void> => {
  if (client) {
    await client.end()
    client = null
  }
  if (container) {
    await container.stop()
    container = null
  }
}

/**
 * Get the test database client.
 * Must call startTestDb() first.
 */
export const getTestClient = (): Client => {
  if (!client) {
    throw new Error('Test database not started. Call startTestDb() first.')
  }
  return client
}

/**
 * Clean all data from tables (but keep schema).
 * Call this in beforeEach() for test isolation.
 */
export const cleanTestDb = async (): Promise<void> => {
  if (!client) return

  // Truncate tables in reverse order to handle foreign keys
  const tables = [
    'tags',
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
  ]

  for (const table of tables) {
    try {
      await client.query(`TRUNCATE TABLE ${table} CASCADE`)
    } catch {
      // Table might not exist, ignore
    }
  }
}

/**
 * Execute a query on the test database.
 */
export const testQuery = async <T = unknown>(
  sql: string,
  params?: unknown[],
): Promise<{ rows: T[]; rowCount: number }> => {
  const c = getTestClient()
  const result = await c.query(sql, params)
  return { rowCount: result.rowCount ?? 0, rows: result.rows as T[] }
}
