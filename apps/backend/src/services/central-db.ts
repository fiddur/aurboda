/**
 * Central database service for server-wide settings and admin management.
 *
 * Uses the shared 'aurboda' database (same as pg-boss queue) for:
 * - Server-wide configuration (signup mode, etc.)
 * - Admin user list
 */

import pg from 'pg'

// ============================================================================
// Types
// ============================================================================

export type SignupMode = 'open' | 'invite_only' | 'closed'

export interface ServerSettings {
  lastfm_api_key: string
  oura_webhook_enabled: boolean
  oura_webhook_verification_token: string
  signup_mode: SignupMode
}

export interface OuraUserMapping {
  oura_user_id: string
  username: string
  created_at: Date
  updated_at: Date
}

export interface OuraWebhookSubscription {
  oura_subscription_id: string
  data_type: string
  event_type: string
  callback_url: string
  expiration_time: Date | null
  created_at: Date
  updated_at: Date
}

export interface CentralDbDeps {
  getClient: () => Promise<pg.Client>
}

export interface CentralDb {
  initializeCentralDb: () => Promise<void>
  getServerSetting: <K extends keyof ServerSettings>(key: K) => Promise<ServerSettings[K] | null>
  setServerSetting: <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => Promise<void>
  getLastFmApiKey: () => Promise<string | null>
  setLastFmApiKey: (key: string | null) => Promise<void>
  getSignupMode: () => Promise<SignupMode>
  setSignupMode: (mode: SignupMode) => Promise<void>
  isAdmin: (username: string) => Promise<boolean>
  addAdmin: (username: string) => Promise<void>
  removeAdmin: (username: string) => Promise<boolean>
  getAdminCount: () => Promise<number>
  getAdmins: () => Promise<string[]>
  getOuraWebhookEnabled: () => Promise<boolean>
  setOuraWebhookEnabled: (enabled: boolean) => Promise<void>
  upsertOuraUserMapping: (ouraUserId: string, username: string) => Promise<void>
  getUsernameByOuraUserId: (ouraUserId: string) => Promise<string | null>
  deleteOuraUserMapping: (ouraUserId: string) => Promise<boolean>
  upsertOuraWebhookSubscription: (
    sub: Omit<OuraWebhookSubscription, 'created_at' | 'updated_at'>,
  ) => Promise<void>
  getOuraWebhookSubscriptions: () => Promise<OuraWebhookSubscription[]>
  deleteOuraWebhookSubscription: (ouraSubscriptionId: string) => Promise<boolean>
  deleteAllOuraWebhookSubscriptions: () => Promise<number>
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CENTRAL_DB = 'aurboda'

// ============================================================================
// Database helpers
// ============================================================================

/**
 * Get database connection parameters from environment.
 */
const getDbParams = () => ({
  database: process.env.CENTRAL_DB || DEFAULT_CENTRAL_DB,
  host: process.env.PGHOST || 'localhost',
  password: process.env.PGPASSWORD,
  port: parseInt(process.env.PGPORT || '5432', 10),
  user: process.env.PGUSER,
})

/**
 * Ensure the central database exists, creating it if necessary.
 */
const ensureDatabase = async (): Promise<boolean> => {
  const params = getDbParams()

  // First, try connecting directly to the target database (it might already exist)
  const targetClient = new pg.Client({ database: params.database })

  try {
    await targetClient.connect()
    await targetClient.end()
    return true
  } catch {
    await targetClient.end().catch(() => {})
  }

  // Connect to postgres database to create the target database
  const postgresClient = new pg.Client({ database: 'postgres' })

  try {
    await postgresClient.connect()
    await postgresClient.query(`CREATE DATABASE "${params.database}"`)
    console.log(`Created central database: ${params.database}`)
    return true
  } catch (error) {
    console.error(`Failed to create central database '${params.database}':`, error)
    return false
  } finally {
    await postgresClient.end()
  }
}

// ============================================================================
// Schema initialization
// ============================================================================

const CREATE_SERVER_SETTINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS server_settings (
    key VARCHAR(100) PRIMARY KEY,
    value JSONB NOT NULL,
    updated_at TIMESTAMP DEFAULT NOW()
  )
`

const CREATE_ADMINS_TABLE = `
  CREATE TABLE IF NOT EXISTS admins (
    username VARCHAR(255) PRIMARY KEY,
    created_at TIMESTAMP DEFAULT NOW()
  )
`

const CREATE_OURA_USER_MAPPINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS oura_user_mappings (
    oura_user_id VARCHAR(255) PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`

const CREATE_OURA_WEBHOOK_SUBSCRIPTIONS_TABLE = `
  CREATE TABLE IF NOT EXISTS oura_webhook_subscriptions (
    oura_subscription_id VARCHAR(255) PRIMARY KEY,
    data_type VARCHAR(100) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    callback_url TEXT NOT NULL,
    expiration_time TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`

// ============================================================================
// Factory
// ============================================================================

/**
 * Create a central database service instance.
 */
export const createCentralDb = (deps: CentralDbDeps): CentralDb => {
  const { getClient } = deps

  return {
    addAdmin: async (username: string): Promise<void> => {
      const client = await getClient()
      await client.query(`INSERT INTO admins (username) VALUES ($1) ON CONFLICT (username) DO NOTHING`, [
        username,
      ])
    },

    deleteAllOuraWebhookSubscriptions: async (): Promise<number> => {
      const client = await getClient()
      const result = await client.query('DELETE FROM oura_webhook_subscriptions')
      return result.rowCount ?? 0
    },

    deleteOuraUserMapping: async (ouraUserId: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('DELETE FROM oura_user_mappings WHERE oura_user_id = $1', [
        ouraUserId,
      ])
      return (result.rowCount ?? 0) > 0
    },

    deleteOuraWebhookSubscription: async (ouraSubscriptionId: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query(
        'DELETE FROM oura_webhook_subscriptions WHERE oura_subscription_id = $1',
        [ouraSubscriptionId],
      )
      return (result.rowCount ?? 0) > 0
    },

    getAdminCount: async (): Promise<number> => {
      const client = await getClient()
      const result = await client.query('SELECT COUNT(*)::integer as count FROM admins')
      return result.rows[0].count
    },

    getAdmins: async (): Promise<string[]> => {
      const client = await getClient()
      const result = await client.query('SELECT username FROM admins ORDER BY created_at')
      return result.rows.map((row) => row.username)
    },

    getLastFmApiKey: async (): Promise<string | null> => {
      const client = await getClient()
      const result = await client.query('SELECT value FROM server_settings WHERE key = $1', [
        'lastfm_api_key',
      ])
      if (result.rows.length === 0) return null
      return result.rows[0].value as string
    },

    getOuraWebhookEnabled: async (): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('SELECT value FROM server_settings WHERE key = $1', [
        'oura_webhook_enabled',
      ])
      if (result.rows.length === 0) return false
      return result.rows[0].value as boolean
    },

    getOuraWebhookSubscriptions: async (): Promise<OuraWebhookSubscription[]> => {
      const client = await getClient()
      const result = await client.query(
        'SELECT oura_subscription_id, data_type, event_type, callback_url, expiration_time, created_at, updated_at FROM oura_webhook_subscriptions ORDER BY created_at',
      )
      return result.rows
    },

    getServerSetting: async <K extends keyof ServerSettings>(key: K): Promise<ServerSettings[K] | null> => {
      const client = await getClient()
      const result = await client.query('SELECT value FROM server_settings WHERE key = $1', [key])
      if (result.rows.length === 0) return null
      return result.rows[0].value as ServerSettings[K]
    },

    getSignupMode: async (): Promise<SignupMode> => {
      const client = await getClient()
      const result = await client.query('SELECT value FROM server_settings WHERE key = $1', ['signup_mode'])
      if (result.rows.length === 0) return 'open'
      return result.rows[0].value as SignupMode
    },

    getUsernameByOuraUserId: async (ouraUserId: string): Promise<string | null> => {
      const client = await getClient()
      const result = await client.query('SELECT username FROM oura_user_mappings WHERE oura_user_id = $1', [
        ouraUserId,
      ])
      if (result.rows.length === 0) return null
      return result.rows[0].username
    },

    initializeCentralDb: async () => {
      const client = await getClient()
      await client.query(CREATE_SERVER_SETTINGS_TABLE)
      await client.query(CREATE_ADMINS_TABLE)
      await client.query(CREATE_OURA_USER_MAPPINGS_TABLE)
      await client.query(CREATE_OURA_WEBHOOK_SUBSCRIPTIONS_TABLE)

      // Set default signup_mode if not exists
      await client.query(
        `INSERT INTO server_settings (key, value)
         VALUES ('signup_mode', '"open"')
         ON CONFLICT (key) DO NOTHING`,
      )
    },

    isAdmin: async (username: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('SELECT 1 FROM admins WHERE username = $1', [username])
      return result.rows.length > 0
    },

    removeAdmin: async (username: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('DELETE FROM admins WHERE username = $1', [username])
      return (result.rowCount ?? 0) > 0
    },

    setLastFmApiKey: async (key: string | null): Promise<void> => {
      const client = await getClient()
      if (key === null) {
        await client.query('DELETE FROM server_settings WHERE key = $1', ['lastfm_api_key'])
      } else {
        await client.query(
          `INSERT INTO server_settings (key, value, updated_at)
           VALUES ('lastfm_api_key', $1, NOW())
           ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
          [JSON.stringify(key)],
        )
      }
    },

    setOuraWebhookEnabled: async (enabled: boolean): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO server_settings (key, value, updated_at)
         VALUES ('oura_webhook_enabled', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(enabled)],
      )
    },

    setServerSetting: async <K extends keyof ServerSettings>(
      key: K,
      value: ServerSettings[K],
    ): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO server_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = NOW()`,
        [key, JSON.stringify(value)],
      )
    },

    setSignupMode: async (mode: SignupMode): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO server_settings (key, value, updated_at)
         VALUES ('signup_mode', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(mode)],
      )
    },

    upsertOuraUserMapping: async (ouraUserId: string, username: string): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO oura_user_mappings (oura_user_id, username, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (oura_user_id) DO UPDATE SET username = $2, updated_at = NOW()`,
        [ouraUserId, username],
      )
    },

    upsertOuraWebhookSubscription: async (
      sub: Omit<OuraWebhookSubscription, 'created_at' | 'updated_at'>,
    ): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO oura_webhook_subscriptions (oura_subscription_id, data_type, event_type, callback_url, expiration_time, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (oura_subscription_id) DO UPDATE SET
           data_type = $2, event_type = $3, callback_url = $4, expiration_time = $5, updated_at = NOW()`,
        [sub.oura_subscription_id, sub.data_type, sub.event_type, sub.callback_url, sub.expiration_time],
      )
    },
  }
}

// ============================================================================
// Singleton instance for use in api.ts
// ============================================================================

let centralDbClient: pg.Client | null = null
let centralDbInstance: CentralDb | null = null

/**
 * Get or create the singleton central database client.
 */
const getCentralDbClient = async (): Promise<pg.Client> => {
  if (centralDbClient) return centralDbClient

  // Ensure database exists
  const dbReady = await ensureDatabase()
  if (!dbReady) {
    throw new Error('Failed to initialize central database')
  }

  const params = getDbParams()
  centralDbClient = new pg.Client({ database: params.database })
  await centralDbClient.connect()
  return centralDbClient
}

/**
 * Get the singleton central database instance.
 * Call initializeCentralDb() before using other methods.
 */
export const getCentralDb = (): CentralDb => {
  if (!centralDbInstance) {
    centralDbInstance = createCentralDb({ getClient: getCentralDbClient })
  }
  return centralDbInstance
}

/**
 * Initialize the central database (create tables and default settings).
 * Should be called once at server startup.
 */
export const initializeCentralDb = async (): Promise<void> => {
  const db = getCentralDb()
  await db.initializeCentralDb()

  // Check for ALLOW_SIGNUP env for backwards compatibility
  const allowSignupEnv = process.env.ALLOW_SIGNUP
  if (allowSignupEnv !== undefined) {
    const currentMode = await db.getSignupMode()
    // Only migrate if still at default 'open' mode
    if (currentMode === 'open') {
      const newMode: SignupMode = allowSignupEnv === 'true' ? 'open' : 'closed'
      await db.setSignupMode(newMode)
      console.log(`Migrated ALLOW_SIGNUP=${allowSignupEnv} to signup_mode=${newMode}`)
      console.log('DEPRECATION: ALLOW_SIGNUP env is deprecated. Use admin settings to control signup mode.')
    }
  }

  console.log('Central database initialized')
}
