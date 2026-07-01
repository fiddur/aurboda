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

  // Challenges hosted by this user (federated competitions).
  challenges: `
    CREATE TABLE IF NOT EXISTS challenges (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      slug             VARCHAR(32) NOT NULL UNIQUE,
      name             TEXT NOT NULL,
      is_public        BOOLEAN NOT NULL DEFAULT false,
      source_type      VARCHAR(20) NOT NULL,
      pattern          TEXT NOT NULL,
      activity_type_id UUID,
      aggregation      VARCHAR(10) NOT NULL,
      unit             TEXT NOT NULL,
      bucket_size      VARCHAR(4) NOT NULL DEFAULT '1d',
      start_ts         TIMESTAMPTZ NOT NULL,
      end_ts           TIMESTAMPTZ NOT NULL,
      timezone         TEXT NOT NULL,
      join_token       VARCHAR(64) NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  challenges_indexes: `
    CREATE INDEX IF NOT EXISTS idx_challenges_public ON challenges (is_public, created_at DESC)
  `,

  // Members of challenges hosted by this user (local or remote).
  challenge_members: `
    CREATE TABLE IF NOT EXISTS challenge_members (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_id      UUID NOT NULL REFERENCES challenges(id) ON DELETE CASCADE,
      identity_base_url TEXT NOT NULL,
      display_name      TEXT NOT NULL,
      kind              VARCHAR(10) NOT NULL,
      local_user        TEXT,
      data_endpoint_url TEXT,
      status            VARCHAR(12) NOT NULL DEFAULT 'active',
      joined_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_fetched_at   TIMESTAMPTZ,
      cached_total      DOUBLE PRECISION,
      cached_buckets    JSONB,
      last_error        TEXT,
      UNIQUE (challenge_id, identity_base_url)
    )
  `,
  challenge_members_indexes: `
    CREATE INDEX IF NOT EXISTS idx_challenge_members_challenge ON challenge_members (challenge_id)
  `,

  // Challenges this user has joined on other (or the same) instances.
  challenge_participations: `
    CREATE TABLE IF NOT EXISTS challenge_participations (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      challenge_url    TEXT NOT NULL,
      host_identity    TEXT NOT NULL,
      name             TEXT NOT NULL,
      source_type      VARCHAR(20) NOT NULL,
      pattern          TEXT NOT NULL,
      activity_type_id UUID,
      aggregation      VARCHAR(10) NOT NULL,
      unit             TEXT NOT NULL,
      bucket_size      VARCHAR(4) NOT NULL DEFAULT '1d',
      start_ts         TIMESTAMPTZ NOT NULL,
      end_ts           TIMESTAMPTZ NOT NULL,
      timezone         TEXT NOT NULL,
      data_token       VARCHAR(64) NOT NULL UNIQUE,
      status           VARCHAR(12) NOT NULL DEFAULT 'active',
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  challenge_participations_indexes: `
    CREATE INDEX IF NOT EXISTS idx_challenge_participations_url ON challenge_participations (challenge_url)
  `,
}
