/**
 * Social / sharing table SQL.
 *
 * `shared_dashboards` holds a user's published dashboards. It lives in the
 * user's own database (the config is the user's data); the `slug` is globally
 * disambiguated by the `username` in the public URL, so per-DB uniqueness is
 * sufficient.
 */
export const socialTables: Record<string, string> = {
  shared_dashboards: `
    CREATE TABLE IF NOT EXISTS shared_dashboards (
      id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug        VARCHAR(32) NOT NULL UNIQUE,
      name        TEXT NOT NULL,
      config      JSONB NOT NULL,
      is_public   BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  shared_dashboards_indexes: `
    CREATE INDEX IF NOT EXISTS idx_shared_dashboards_public
      ON shared_dashboards (is_public, created_at DESC)
  `,
}
