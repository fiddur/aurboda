/**
 * `type` is TEXT rather than an enum: deploys overlap, and a new notification
 * type must be raisable without DDL.
 */
export const notificationsTables: Record<string, string> = {
  notification_preferences: `
    CREATE TABLE IF NOT EXISTS notification_preferences (
      type       TEXT PRIMARY KEY,
      in_app     BOOLEAN NOT NULL DEFAULT true,
      push       BOOLEAN NOT NULL DEFAULT true,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  notifications: `
    CREATE TABLE IF NOT EXISTS notifications (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      body        TEXT,
      link        TEXT,
      data        JSONB,
      dedupe_key  TEXT UNIQUE,
      in_app      BOOLEAN NOT NULL DEFAULT true,
      push        BOOLEAN NOT NULL DEFAULT true,
      read_at     TIMESTAMPTZ,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  notifications_actions: `
    ALTER TABLE notifications ADD COLUMN IF NOT EXISTS actions JSONB NOT NULL DEFAULT '[]'
  `,
  notifications_indexes: `
    CREATE INDEX IF NOT EXISTS idx_notifications_created ON notifications (created_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_notifications_unread ON notifications (created_at DESC) WHERE read_at IS NULL
  `,
  push_subscriptions: `
    CREATE TABLE IF NOT EXISTS push_subscriptions (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      endpoint        TEXT NOT NULL UNIQUE,
      p256dh          TEXT NOT NULL,
      auth            TEXT NOT NULL,
      user_agent      TEXT,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_success_at TIMESTAMPTZ,
      failure_count   INTEGER NOT NULL DEFAULT 0
    )
  `,
}
