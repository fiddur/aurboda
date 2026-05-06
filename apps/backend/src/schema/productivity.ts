/**
 * Productivity / screentime category table SQL.
 */
export const productivityTables: Record<string, string> = {
  // Productivity data (RescueTime, ActivityWatch, etc.)
  productivity: `
    CREATE TABLE IF NOT EXISTS productivity (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      source          VARCHAR(50) NOT NULL DEFAULT 'rescuetime',
      start_time      TIMESTAMPTZ NOT NULL,
      end_time        TIMESTAMPTZ NOT NULL,
      activity        VARCHAR(255) NOT NULL,
      title           TEXT,
      category        VARCHAR(100),
      productivity    SMALLINT,
      duration_sec    INTEGER NOT NULL,
      is_mobile       BOOLEAN DEFAULT FALSE,
      device_name     VARCHAR(100) NOT NULL DEFAULT '',
      resolved_category TEXT[],
      deleted_at      TIMESTAMPTZ,
      CONSTRAINT unique_productivity UNIQUE (source, start_time, activity, device_name)
    )
  `,
  productivity_indexes: `
    CREATE INDEX IF NOT EXISTS idx_productivity_time ON productivity (start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_category ON productivity (category, start_time DESC);
    CREATE INDEX IF NOT EXISTS idx_productivity_not_deleted ON productivity (start_time DESC) WHERE deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_productivity_resolved_category ON productivity (resolved_category) WHERE resolved_category IS NOT NULL
  `,

  // Screentime category rules for categorizing productivity records.
  // activity_type_name links the category to its derived activity_type_definitions row;
  // it is set once on first sync and never auto-changed (renames/moves don't touch it).
  screentime_categories: `
    CREATE TABLE IF NOT EXISTS screentime_categories (
      id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name            TEXT[] NOT NULL,
      rule_type       VARCHAR(20) NOT NULL DEFAULT 'none',
      rule_regex      TEXT,
      ignore_case     BOOLEAN DEFAULT TRUE,
      color           VARCHAR(20),
      score           SMALLINT,
      exclude_from_screentime BOOLEAN DEFAULT FALSE,
      sort_order      INTEGER DEFAULT 0,
      activity_type_name VARCHAR(100),
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  screentime_categories_indexes: `
    CREATE INDEX IF NOT EXISTS idx_screentime_categories_name ON screentime_categories USING GIN (name);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_screentime_categories_activity_type_name
      ON screentime_categories (activity_type_name) WHERE activity_type_name IS NOT NULL
  `,
}
