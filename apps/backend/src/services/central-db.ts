/**
 * Central database service for server-wide settings and admin management.
 *
 * Uses the shared 'aurboda' database (same as pg-boss queue) for:
 * - Server-wide configuration (signup mode, etc.)
 * - Admin user list
 */

import { NUTRIENT_FIELD_NAMES } from '@aurboda/api-spec'
import pg from 'pg'

import {
  createSharedFoodItemsApi,
  CREATE_SHARED_FOOD_ITEMS_INDEXES,
  CREATE_SHARED_FOOD_ITEMS_TABLE,
  type SharedFoodItemsApi,
} from './central-food-items.ts'
import {
  createCentralImportJobsApi,
  CREATE_IMPORT_JOBS_INDEXES,
  CREATE_IMPORT_JOBS_TABLE,
  type CentralImportJobsApi,
} from './central-import-jobs.ts'
import {
  createSharedNutrientRecommendationsApi,
  CREATE_SHARED_NUTRIENT_RECOMMENDATIONS_TABLE,
  seedSharedNutrientRecommendations,
  type SharedNutrientRecommendationsApi,
} from './central-nutrient-recommendations.ts'

// ============================================================================
// Types
// ============================================================================

export type SignupMode = 'open' | 'invite_only' | 'closed'

export interface ServerSettings {
  audit_log_retention_days: number
  lastfm_api_key: string
  oura_client_id: string
  oura_client_secret: string
  oura_webhook_enabled: boolean
  oura_webhook_verification_token: string
  sentry_dsn: string
  signup_mode: SignupMode
  strava_client_id: string
  strava_client_secret: string
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

export interface StravaAthleteMapping {
  strava_athlete_id: number
  username: string
  created_at: Date
  updated_at: Date
}

export interface OAuthClient {
  client_id: string
  client_name: string
  redirect_uris: string[]
  token_endpoint_auth_method: string
  created_at: Date
}

export interface OAuthAuthorizationCode {
  code: string
  client_id: string
  username: string
  redirect_uri: string
  code_challenge: string
  code_challenge_method: string
  expires_at: Date
  used: boolean
}

export interface OAuthToken {
  token: string
  token_type: 'access' | 'refresh'
  client_id: string
  username: string
  expires_at: Date
  revoked: boolean
  parent_token: string | null
  created_at: Date
}

export interface CentralDbDeps {
  getClient: () => Promise<pg.Client>
}

export interface CentralDb
  extends SharedFoodItemsApi, CentralImportJobsApi, SharedNutrientRecommendationsApi {
  initializeCentralDb: () => Promise<void>
  getServerSetting: <K extends keyof ServerSettings>(key: K) => Promise<ServerSettings[K] | null>
  setServerSetting: <K extends keyof ServerSettings>(key: K, value: ServerSettings[K]) => Promise<void>
  getAuditLogRetentionDays: () => Promise<number>
  setAuditLogRetentionDays: (days: number) => Promise<void>
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
  upsertStravaAthleteMapping: (stravaAthleteId: number, username: string) => Promise<void>
  getUsernameByStravaAthleteId: (stravaAthleteId: number) => Promise<string | null>
  deleteStravaAthleteMapping: (stravaAthleteId: number) => Promise<boolean>
  deleteStravaAthleteMappingByUsername: (username: string) => Promise<boolean>
  createOAuthClient: (client: Omit<OAuthClient, 'created_at'>) => Promise<void>
  getOAuthClient: (clientId: string) => Promise<OAuthClient | null>
  saveAuthorizationCode: (code: Omit<OAuthAuthorizationCode, 'used'>) => Promise<void>
  consumeAuthorizationCode: (code: string) => Promise<OAuthAuthorizationCode | null>
  saveOAuthToken: (token: OAuthToken) => Promise<void>
  getOAuthToken: (token: string) => Promise<OAuthToken | null>
  revokeOAuthToken: (token: string) => Promise<boolean>
  cleanupExpiredOAuth: () => Promise<void>
  /**
   * Get or create a stable random WebAuthn user handle for the given username.
   * The handle is what authenticators store as `userHandle` and is what the
   * server receives back on a discoverable-credential assertion.
   */
  getOrCreateWebAuthnUserHandle: (username: string) => Promise<string>
  /**
   * Insert a user-handle mapping with a *given* UUID. Used by passkey-only
   * signup so the same handle is bound through the entire ceremony.
   * Throws on conflict (i.e. username already mapped).
   */
  insertWebAuthnUserHandle: (username: string, userHandle: string) => Promise<void>
  /**
   * Remove a user-handle mapping. Used by signup rollback when something
   * fails after the row is inserted.
   */
  deleteWebAuthnUserHandle: (username: string) => Promise<void>
  getUsernameByWebAuthnUserHandle: (userHandle: string) => Promise<string | null>
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
    console.info(`Created central database: ${params.database}`)
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

const CREATE_STRAVA_ATHLETE_MAPPINGS_TABLE = `
  CREATE TABLE IF NOT EXISTS strava_athlete_mappings (
    strava_athlete_id BIGINT PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
  )
`

const CREATE_OAUTH_CLIENTS_TABLE = `
  CREATE TABLE IF NOT EXISTS oauth_clients (
    client_id VARCHAR(255) PRIMARY KEY,
    client_name VARCHAR(255) NOT NULL,
    redirect_uris JSONB NOT NULL DEFAULT '[]',
    token_endpoint_auth_method VARCHAR(50) NOT NULL DEFAULT 'none',
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`

const CREATE_OAUTH_AUTHORIZATION_CODES_TABLE = `
  CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
    code VARCHAR(255) PRIMARY KEY,
    client_id VARCHAR(255) NOT NULL REFERENCES oauth_clients(client_id),
    username VARCHAR(255) NOT NULL,
    redirect_uri TEXT NOT NULL,
    code_challenge VARCHAR(255) NOT NULL,
    code_challenge_method VARCHAR(10) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used BOOLEAN NOT NULL DEFAULT FALSE
  )
`

const CREATE_OAUTH_TOKENS_TABLE = `
  CREATE TABLE IF NOT EXISTS oauth_tokens (
    token VARCHAR(255) PRIMARY KEY,
    token_type VARCHAR(10) NOT NULL CHECK (token_type IN ('access', 'refresh')),
    client_id VARCHAR(255) NOT NULL REFERENCES oauth_clients(client_id),
    username VARCHAR(255) NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked BOOLEAN NOT NULL DEFAULT FALSE,
    parent_token VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW()
  )
`

const CREATE_WEBAUTHN_USER_HANDLES_TABLE = `
  CREATE TABLE IF NOT EXISTS webauthn_user_handles (
    user_handle UUID PRIMARY KEY,
    username VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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

    getAuditLogRetentionDays: async (): Promise<number> => {
      const client = await getClient()
      const result = await client.query('SELECT value FROM server_settings WHERE key = $1', [
        'audit_log_retention_days',
      ])
      if (result.rows.length === 0) return 3
      return result.rows[0].value as number
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
      await client.query(CREATE_STRAVA_ATHLETE_MAPPINGS_TABLE)
      await client.query(CREATE_OAUTH_CLIENTS_TABLE)
      await client.query(CREATE_OAUTH_AUTHORIZATION_CODES_TABLE)
      await client.query(CREATE_OAUTH_TOKENS_TABLE)
      await client.query(CREATE_WEBAUTHN_USER_HANDLES_TABLE)
      await client.query(CREATE_SHARED_FOOD_ITEMS_TABLE)
      // Idempotently bring shared_food_items in line with the current
      // NUTRIENT_FIELD_NAMES — `CREATE TABLE IF NOT EXISTS` doesn't add new
      // columns to an existing table, so each new nutrient field needs an
      // explicit ADD COLUMN here.
      for (const field of NUTRIENT_FIELD_NAMES) {
        await client.query(`ALTER TABLE shared_food_items ADD COLUMN IF NOT EXISTS ${field} DOUBLE PRECISION`)
      }
      for (const stmt of CREATE_SHARED_FOOD_ITEMS_INDEXES) await client.query(stmt)
      await client.query(CREATE_IMPORT_JOBS_TABLE)
      for (const stmt of CREATE_IMPORT_JOBS_INDEXES) await client.query(stmt)

      await client.query(CREATE_SHARED_NUTRIENT_RECOMMENDATIONS_TABLE)
      await seedSharedNutrientRecommendations(client)

      // Set default signup_mode if not exists
      await client.query(
        `INSERT INTO server_settings (key, value)
         VALUES ('signup_mode', '"open"')
         ON CONFLICT (key) DO NOTHING`,
      )
    },

    ...createSharedFoodItemsApi(getClient),
    ...createCentralImportJobsApi(getClient),
    ...createSharedNutrientRecommendationsApi(getClient),

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

    setAuditLogRetentionDays: async (days: number): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO server_settings (key, value, updated_at)
         VALUES ('audit_log_retention_days', $1, NOW())
         ON CONFLICT (key) DO UPDATE SET value = $1, updated_at = NOW()`,
        [JSON.stringify(days)],
      )
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

    upsertStravaAthleteMapping: async (stravaAthleteId: number, username: string): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO strava_athlete_mappings (strava_athlete_id, username, updated_at)
         VALUES ($1, $2, NOW())
         ON CONFLICT (strava_athlete_id) DO UPDATE SET username = $2, updated_at = NOW()`,
        [stravaAthleteId, username],
      )
    },

    getUsernameByStravaAthleteId: async (stravaAthleteId: number): Promise<string | null> => {
      const client = await getClient()
      const result = await client.query(
        'SELECT username FROM strava_athlete_mappings WHERE strava_athlete_id = $1',
        [stravaAthleteId],
      )
      if (result.rows.length === 0) return null
      return result.rows[0].username
    },

    deleteStravaAthleteMapping: async (stravaAthleteId: number): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('DELETE FROM strava_athlete_mappings WHERE strava_athlete_id = $1', [
        stravaAthleteId,
      ])
      return (result.rowCount ?? 0) > 0
    },

    deleteStravaAthleteMappingByUsername: async (username: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('DELETE FROM strava_athlete_mappings WHERE username = $1', [username])
      return (result.rowCount ?? 0) > 0
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

    createOAuthClient: async (client_data: Omit<OAuthClient, 'created_at'>): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO oauth_clients (client_id, client_name, redirect_uris, token_endpoint_auth_method)
         VALUES ($1, $2, $3, $4)`,
        [
          client_data.client_id,
          client_data.client_name,
          JSON.stringify(client_data.redirect_uris),
          client_data.token_endpoint_auth_method,
        ],
      )
    },

    getOAuthClient: async (clientId: string): Promise<OAuthClient | null> => {
      const client = await getClient()
      const result = await client.query(
        'SELECT client_id, client_name, redirect_uris, token_endpoint_auth_method, created_at FROM oauth_clients WHERE client_id = $1',
        [clientId],
      )
      if (result.rows.length === 0) return null
      return result.rows[0]
    },

    saveAuthorizationCode: async (code: Omit<OAuthAuthorizationCode, 'used'>): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO oauth_authorization_codes (code, client_id, username, redirect_uri, code_challenge, code_challenge_method, expires_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          code.code,
          code.client_id,
          code.username,
          code.redirect_uri,
          code.code_challenge,
          code.code_challenge_method,
          code.expires_at,
        ],
      )
    },

    consumeAuthorizationCode: async (code: string): Promise<OAuthAuthorizationCode | null> => {
      const client = await getClient()
      const result = await client.query(
        `UPDATE oauth_authorization_codes
         SET used = TRUE
         WHERE code = $1 AND used = FALSE AND expires_at > NOW()
         RETURNING code, client_id, username, redirect_uri, code_challenge, code_challenge_method, expires_at, used`,
        [code],
      )
      if (result.rows.length === 0) return null
      return result.rows[0]
    },

    saveOAuthToken: async (token: OAuthToken): Promise<void> => {
      const client = await getClient()
      await client.query(
        `INSERT INTO oauth_tokens (token, token_type, client_id, username, expires_at, revoked, parent_token)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [
          token.token,
          token.token_type,
          token.client_id,
          token.username,
          token.expires_at,
          token.revoked,
          token.parent_token,
        ],
      )
    },

    getOAuthToken: async (token: string): Promise<OAuthToken | null> => {
      const client = await getClient()
      const result = await client.query(
        `SELECT token, token_type, client_id, username, expires_at, revoked, parent_token, created_at
         FROM oauth_tokens
         WHERE token = $1 AND revoked = FALSE AND expires_at > NOW()`,
        [token],
      )
      if (result.rows.length === 0) return null
      return result.rows[0]
    },

    revokeOAuthToken: async (token: string): Promise<boolean> => {
      const client = await getClient()
      const result = await client.query('UPDATE oauth_tokens SET revoked = TRUE WHERE token = $1', [token])
      return (result.rowCount ?? 0) > 0
    },

    cleanupExpiredOAuth: async (): Promise<void> => {
      const client = await getClient()
      await client.query('DELETE FROM oauth_authorization_codes WHERE expires_at < NOW()')
      await client.query('DELETE FROM oauth_tokens WHERE expires_at < NOW()')
    },

    getOrCreateWebAuthnUserHandle: async (username: string): Promise<string> => {
      const client = await getClient()
      const existing = await client.query<{ user_handle: string }>(
        'SELECT user_handle FROM webauthn_user_handles WHERE username = $1',
        [username],
      )
      if (existing.rows.length > 0) return existing.rows[0].user_handle
      const inserted = await client.query<{ user_handle: string }>(
        `INSERT INTO webauthn_user_handles (user_handle, username)
         VALUES (gen_random_uuid(), $1)
         ON CONFLICT (username) DO UPDATE SET username = EXCLUDED.username
         RETURNING user_handle`,
        [username],
      )
      return inserted.rows[0].user_handle
    },

    insertWebAuthnUserHandle: async (username: string, userHandle: string): Promise<void> => {
      const client = await getClient()
      await client.query(`INSERT INTO webauthn_user_handles (user_handle, username) VALUES ($1, $2)`, [
        userHandle,
        username,
      ])
    },

    deleteWebAuthnUserHandle: async (username: string): Promise<void> => {
      const client = await getClient()
      await client.query('DELETE FROM webauthn_user_handles WHERE username = $1', [username])
    },

    getUsernameByWebAuthnUserHandle: async (userHandle: string): Promise<string | null> => {
      const client = await getClient()
      const result = await client.query<{ username: string }>(
        'SELECT username FROM webauthn_user_handles WHERE user_handle = $1',
        [userHandle],
      )
      return result.rows[0]?.username ?? null
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
      console.info(`Migrated ALLOW_SIGNUP=${allowSignupEnv} to signup_mode=${newMode}`)
      console.info('DEPRECATION: ALLOW_SIGNUP env is deprecated. Use admin settings to control signup mode.')
    }
  }

  console.info('Central database initialized')
}
