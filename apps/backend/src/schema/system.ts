/**
 * System / cross-cutting table SQL: OAuth, MCP sessions, outbound sync queue,
 * sync state, user settings, audit log, notes, goals, uploaded icons.
 */
export const systemTables: Record<string, string> = {
  // MCP session persistence for surviving backend restarts
  mcp_sessions: `
    CREATE TABLE IF NOT EXISTS mcp_sessions (
      session_id      UUID PRIMARY KEY,
      username        VARCHAR(255) NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_activity   TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  mcp_sessions_indexes: `
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_username ON mcp_sessions (username);
    CREATE INDEX IF NOT EXISTS idx_mcp_sessions_last_activity ON mcp_sessions (last_activity)
  `,

  // Notes/comments on any entity (polymorphic reference)
  notes: `
    CREATE TABLE IF NOT EXISTS notes (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type     VARCHAR(50) NOT NULL,
      entity_id       TEXT NOT NULL,
      content         TEXT NOT NULL,
      source          VARCHAR(50),
      start_time      TIMESTAMPTZ,
      end_time        TIMESTAMPTZ,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  notes_indexes: `
    CREATE INDEX IF NOT EXISTS idx_notes_entity ON notes (entity_type, entity_id);
    CREATE INDEX IF NOT EXISTS idx_notes_created ON notes (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_notes_time ON notes (start_time, end_time)
  `,

  // OAuth tokens for third-party APIs
  oauth_tokens: `
    CREATE TABLE IF NOT EXISTS oauth_tokens (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider        VARCHAR(50) NOT NULL,
      access_token    TEXT NOT NULL,
      refresh_token   TEXT,
      expires_at      TIMESTAMPTZ,
      scopes          VARCHAR[],
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_provider UNIQUE (provider)
    )
  `,

  // Outbound sync queue - tracks changes to push to Health Connect
  outbound_sync_queue: `
    CREATE TABLE IF NOT EXISTS outbound_sync_queue (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      entity_type     VARCHAR(50) NOT NULL,
      entity_id       VARCHAR(255) NOT NULL,
      operation       VARCHAR(20) NOT NULL,
      hc_record_type  VARCHAR(100) NOT NULL,
      payload         JSONB NOT NULL,
      hc_record_id    VARCHAR(255),
      status          VARCHAR(20) NOT NULL DEFAULT 'pending',
      fail_count      INT NOT NULL DEFAULT 0,
      fail_reason     TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      synced_at       TIMESTAMPTZ
    )
  `,
  outbound_sync_queue_indexes: `
    CREATE INDEX IF NOT EXISTS idx_outbound_sync_queue_status ON outbound_sync_queue (status) WHERE status = 'pending';
    CREATE INDEX IF NOT EXISTS idx_outbound_sync_queue_entity ON outbound_sync_queue (entity_type, entity_id)
  `,

  // User-defined goals for tracking metrics (extracted from user_settings JSONB)
  goals: `
    CREATE TABLE IF NOT EXISTS goals (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      goal_type       VARCHAR(10) NOT NULL DEFAULT 'metric',
      metric          VARCHAR(50),
      min_value       DOUBLE PRECISION,
      max_value       DOUBLE PRECISION,
      time_window     VARCHAR(10) DEFAULT '7d',
      source_type     VARCHAR(30),
      pattern         TEXT,
      half_life_days  INTEGER,
      display_period  VARCHAR(10),
      aggregation     VARCHAR(10),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  goals_indexes: `
    CREATE INDEX IF NOT EXISTS idx_goals_metric ON goals (metric)
  `,

  // Sync state tracking for incremental data pulls
  sync_state: `
    CREATE TABLE IF NOT EXISTS sync_state (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      provider        VARCHAR(50) NOT NULL,
      data_type       VARCHAR(100) NOT NULL,
      last_sync_time  TIMESTAMPTZ,
      sync_start_date DATE,
      status          VARCHAR(20) DEFAULT 'idle',
      error_message   TEXT,
      retry_after     TIMESTAMPTZ,
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT unique_sync_state UNIQUE (provider, data_type)
    )
  `,

  // Uploaded icon images (stored as binary blobs)
  uploaded_icons: `
    CREATE TABLE IF NOT EXISTS uploaded_icons (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      content_type    VARCHAR(50) NOT NULL,
      data            BYTEA NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // User settings (HR zones, birth date, etc.)
  user_settings: `
    CREATE TABLE IF NOT EXISTS user_settings (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      settings        JSONB NOT NULL DEFAULT '{}',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // Audit log for user-specific events (sync, auth, settings changes, etc.)
  audit_log: `
    CREATE TABLE IF NOT EXISTS audit_log (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      level           VARCHAR(10) NOT NULL DEFAULT 'info',
      category        VARCHAR(20) NOT NULL,
      message         TEXT NOT NULL,
      details         JSONB
    )
  `,

  audit_log_indexes: `
    CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log (timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_log_category ON audit_log (category);
    CREATE INDEX IF NOT EXISTS idx_audit_log_level ON audit_log (level)
  `,

  // WebAuthn / passkey credentials registered by this user
  webauthn_credentials: `
    CREATE TABLE IF NOT EXISTS webauthn_credentials (
      credential_id   TEXT PRIMARY KEY,
      public_key      BYTEA NOT NULL,
      counter         BIGINT NOT NULL DEFAULT 0,
      transports      TEXT[] NOT NULL DEFAULT '{}',
      device_type     VARCHAR(20),
      backed_up       BOOLEAN NOT NULL DEFAULT false,
      nickname        VARCHAR(64),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ
    )
  `,

  webauthn_credentials_indexes: `
    CREATE INDEX IF NOT EXISTS idx_webauthn_credentials_created ON webauthn_credentials (created_at DESC)
  `,

  // Long-running bulk imports (Livsmedelsverket food DB, etc.). The runner is
  // fire-and-forget — a small startup hook re-marks "running" jobs older than
  // 1 h as "failed" so a backend crash doesn't leave the UI stuck.
  import_jobs: `
    CREATE TABLE IF NOT EXISTS import_jobs (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source           VARCHAR(50) NOT NULL,
      status           VARCHAR(20) NOT NULL DEFAULT 'pending',
      started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      completed_at     TIMESTAMPTZ,
      total_items      INTEGER,
      processed_items  INTEGER NOT NULL DEFAULT 0,
      error            TEXT,
      started_by       VARCHAR(255)
    )
  `,
  import_jobs_indexes: `
    CREATE INDEX IF NOT EXISTS idx_import_jobs_source_started
      ON import_jobs (source, started_at DESC)
  `,
}
