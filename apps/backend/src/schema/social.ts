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
      bucket_size      VARCHAR(4) NOT NULL DEFAULT 'auto',
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
      data_last_updated TIMESTAMPTZ,
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
      bucket_size      VARCHAR(4) NOT NULL DEFAULT 'auto',
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

  // Federated feed posts: activities the user published to their public feed.
  // `included_metrics` is the shared scalar-summary set; `series_metrics` is the
  // explicit high-resolution opt-in that authorizes the public `/series`
  // endpoint. `activity_id` is a soft reference (no FK): activities are
  // soft-deleted, and the series endpoint re-checks `deleted_at` at query time,
  // so a removed activity simply stops resolving.
  // `image_token` is an unguessable per-post capability token. A `followers`-only
  // post's rendered chart/route image URLs carry it (`?token=…`), so a follower's
  // server can fetch them even though the endpoint is otherwise unauthenticated —
  // the fediverse fetches media without HTTP signatures, so a signed-request gate
  // wouldn't be exercised. `public`/`unlisted` images need no token.
  // `kind` discriminates an `activity` post (shares an activity — the default and
  // the only kind before articles) from an `article` post (long-form prose + inline
  // chart blocks). An article's content — title, default window, ordered blocks —
  // lives in the `article` JSONB and its `activity_id`/metric columns stay empty;
  // an activity post leaves `article` NULL. Modelled as a kind on the same table so
  // articles reuse the whole feed (visibility, federation, timeline, permalinks).
  feed_posts: `
    CREATE TABLE IF NOT EXISTS feed_posts (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      kind              VARCHAR(12) NOT NULL DEFAULT 'activity',
      activity_id       UUID,
      included_metrics  TEXT[] NOT NULL DEFAULT '{}',
      series_metrics    TEXT[] NOT NULL DEFAULT '{}',
      visibility        VARCHAR(12) NOT NULL DEFAULT 'public',
      include_map       BOOLEAN NOT NULL DEFAULT false,
      include_chart     BOOLEAN NOT NULL DEFAULT false,
      article           JSONB,
      message           TEXT,
      image_token       TEXT NOT NULL DEFAULT gen_random_uuid()::text,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Additive columns for feed_posts tables created before the article kind (all idempotent).
  feed_posts_article_columns: `
    ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS kind VARCHAR(12) NOT NULL DEFAULT 'activity';
    ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS article JSONB;
  `,
  // The author's personal message on a post (plain text; #995). Additive for
  // pre-existing tables (idempotent).
  feed_posts_message_column: `
    ALTER TABLE feed_posts ADD COLUMN IF NOT EXISTS message TEXT;
  `,
  // `idx_feed_posts_series` is a GIN index over the shared-series set — the hot
  // path for the public series endpoint's `metric = ANY(series_metrics)` check.
  feed_posts_indexes: `
    CREATE INDEX IF NOT EXISTS idx_feed_posts_created ON feed_posts (created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_feed_posts_series ON feed_posts USING GIN (series_metrics)
  `,

  // Tombstones for deleted public/unlisted feed posts. A post row is hard-deleted
  // on unshare, but a remote server may still dereference its object id; AS2 wants
  // a `410 Gone` Tombstone there (a `404` reads as transient/unknown). We record
  // only `public`/`unlisted` deletions — a `followers`-only object id never
  // resolved publicly, so tombstoning it would leak that a post once existed. The
  // pushed `Delete{Tombstone}` still handles timeline retraction; this backs only
  // the direct dereference of an already-known id.
  feed_tombstone: `
    CREATE TABLE IF NOT EXISTS feed_tombstone (
      post_id     UUID PRIMARY KEY,
      deleted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,

  // The user's ActivityPub actor keypair. Each per-user database has a single
  // actor (the user), so this is a singleton table: the `singleton` PK + CHECK
  // pins it to one row. The RSA keypair (PKCS#8 private / SPKI public PEM) signs
  // outbound federation traffic and is published in the actor document.
  feed_actor: `
    CREATE TABLE IF NOT EXISTS feed_actor (
      singleton        BOOLEAN PRIMARY KEY DEFAULT true,
      private_key_pem  TEXT NOT NULL,
      public_key_pem   TEXT NOT NULL,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (singleton)
    )
  `,

  // Remote actors that follow this user's ActivityPub actor. Keyed by the
  // follower's actor URI; we cache their (personal) inbox and optional shared
  // inbox so the delivery slice can fan posts out to them, plus their handle /
  // display name / avatar so a follow-request UI can show who is asking.
  // `accepted` records whether we answered their Follow with an Accept — in
  // manual-approval mode it stays false (pending) until the owner approves, and
  // pending followers are kept out of the followers collection + count and
  // receive no `followers`-only delivery. `follow_activity_uri` is the id of the
  // Follow they sent, echoed back in the deferred Accept/Reject so their server
  // matches it to the original request. `id` is a stable local handle for the
  // approve/reject API + UI (the actor_uri is unwieldy as a path param).
  feed_follower: `
    CREATE TABLE IF NOT EXISTS feed_follower (
      actor_uri           TEXT PRIMARY KEY,
      id                  UUID NOT NULL DEFAULT gen_random_uuid() UNIQUE,
      inbox_uri           TEXT NOT NULL,
      shared_inbox_uri    TEXT,
      handle              TEXT,
      display_name        TEXT,
      avatar_url          TEXT,
      follow_activity_uri TEXT,
      accepted            BOOLEAN NOT NULL DEFAULT false,
      created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Additive migrations for pre-existing feed_follower tables (all idempotent).
  feed_follower_columns: `
    ALTER TABLE feed_follower ADD COLUMN IF NOT EXISTS id UUID NOT NULL DEFAULT gen_random_uuid();
    ALTER TABLE feed_follower ADD COLUMN IF NOT EXISTS handle TEXT;
    ALTER TABLE feed_follower ADD COLUMN IF NOT EXISTS display_name TEXT;
    ALTER TABLE feed_follower ADD COLUMN IF NOT EXISTS avatar_url TEXT;
    ALTER TABLE feed_follower ADD COLUMN IF NOT EXISTS follow_activity_uri TEXT;
    CREATE UNIQUE INDEX IF NOT EXISTS feed_follower_id_key ON feed_follower (id);
  `,

  // Remote (or local) actors this user follows. Keyed by a local `id` (used to
  // build the outbound `Follow`/`Undo{Follow}` activity id and to unfollow from
  // the UI); `actor_uri` is UNIQUE so a re-follow upserts rather than duplicates.
  // We cache the followee's inbox (+ optional shared inbox) so an `Undo{Follow}`
  // can be delivered without re-resolving the actor, plus their handle / display
  // name / avatar for the following list. `accepted` flips to true when the
  // followee's server answers our Follow with an `Accept` (a `Reject` drops the
  // row). Pending (`accepted = false`) rows are shown to the owner but kept out
  // of the public `following` collection until confirmed.
  feed_following: `
    CREATE TABLE IF NOT EXISTS feed_following (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      actor_uri        TEXT NOT NULL UNIQUE,
      inbox_uri        TEXT NOT NULL,
      shared_inbox_uri TEXT,
      handle           TEXT,
      display_name     TEXT,
      avatar_url       TEXT,
      accepted         BOOLEAN NOT NULL DEFAULT false,
      notify_on_post   BOOLEAN NOT NULL DEFAULT true,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `,
  // Additive migration for pre-existing feed_following tables (idempotent).
  feed_following_notify: `
    ALTER TABLE feed_following ADD COLUMN IF NOT EXISTS notify_on_post BOOLEAN NOT NULL DEFAULT true
  `,

  // The user's home timeline: posts received from actors they follow (inbound
  // `Create`/`Update`/`Delete` on the feed). Keyed by a local `id`; `object_uri`
  // (the remote Note's id) is UNIQUE so a re-delivery / edit upserts. `content`
  // is the remote HTML AFTER server-side sanitisation (untrusted fediverse HTML);
  // `published_at` is the remote post's own timestamp and drives timeline order.
  timeline_entry: `
    CREATE TABLE IF NOT EXISTS timeline_entry (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      object_uri    TEXT NOT NULL UNIQUE,
      actor_uri     TEXT NOT NULL,
      handle        TEXT,
      display_name  TEXT,
      avatar_url    TEXT,
      content       TEXT NOT NULL DEFAULT '',
      url           TEXT,
      published_at  TIMESTAMPTZ NOT NULL,
      received_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      -- Native structured payload (typed metrics + series) fetched from Aurboda
      -- peers on ingest; NULL for Mastodon / non-Aurboda posts. Drives a native
      -- chart instead of the sanitised HTML.
      structured    JSONB,
      -- Image attachments (rendered chart / route map, or a Mastodon photo)
      -- captured from the delivered Note; shown when there's no native chart.
      images        JSONB,
      -- When a lazy retro-enrichment attempt ran for this entry (#996). NULL
      -- means eligible: an Aurboda-shaped entry with NULL structured gets one
      -- retry on timeline read (covers pre-enrichment entries and transient
      -- ingest-time failures), then is marked here regardless of outcome.
      enrich_attempted_at TIMESTAMPTZ
    )
  `,
  // Additive columns for DBs created before the structured-timeline / media features.
  timeline_entry_structured: `
    ALTER TABLE timeline_entry ADD COLUMN IF NOT EXISTS structured JSONB
  `,
  timeline_entry_images: `
    ALTER TABLE timeline_entry ADD COLUMN IF NOT EXISTS images JSONB
  `,
  timeline_entry_enrich_attempted: `
    ALTER TABLE timeline_entry ADD COLUMN IF NOT EXISTS enrich_attempted_at TIMESTAMPTZ
  `,
  // Timeline ordering / keyset pagination is by (published_at DESC, id DESC).
  timeline_entry_indexes: `
    CREATE INDEX IF NOT EXISTS idx_timeline_entry_published
      ON timeline_entry (published_at DESC, id DESC)
  `,

  // The user's public profile avatar. One per user (the profile owner), so a
  // `singleton` PK + CHECK pins it to a single row. Surfaced on the public
  // profile, shared-page OG cards, and the ActivityPub actor `icon`.
  profile_avatar: `
    CREATE TABLE IF NOT EXISTS profile_avatar (
      singleton     BOOLEAN PRIMARY KEY DEFAULT true,
      content_type  TEXT NOT NULL,
      data          BYTEA NOT NULL,
      updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CHECK (singleton)
    )
  `,
}
