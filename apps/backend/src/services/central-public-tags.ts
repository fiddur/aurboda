import type { TimelineImage } from '@aurboda/api-spec'

import type { Queryable } from '../db/pool.ts'
import type { KeysetCursor } from './keyset-cursor.ts'

/** The instance actor's follow of each public tag page's tag actor. */
export const CREATE_INSTANCE_TAG_FOLLOWS_TABLE = `
  CREATE TABLE IF NOT EXISTS instance_tag_follows (
    tag                TEXT PRIMARY KEY,
    actor_uri          TEXT NOT NULL,
    inbox_uri          TEXT NOT NULL,
    follow_activity_id TEXT NOT NULL UNIQUE,
    accepted           BOOLEAN NOT NULL DEFAULT false,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_PUBLIC_TAG_POSTS_TABLE = `
  CREATE TABLE IF NOT EXISTS public_tag_posts (
    id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    note_uri      TEXT NOT NULL UNIQUE,
    actor_uri     TEXT NOT NULL,
    handle        TEXT,
    display_name  TEXT,
    avatar_url    TEXT,
    content       TEXT NOT NULL,
    url           TEXT,
    images        JSONB NOT NULL DEFAULT '[]',
    tags          TEXT[] NOT NULL DEFAULT '{}',
    announce_uris TEXT[] NOT NULL DEFAULT '{}',
    local_user    TEXT,
    published_at  TIMESTAMPTZ NOT NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`

export const CREATE_PUBLIC_TAG_POSTS_INDEXES = [
  'CREATE INDEX IF NOT EXISTS idx_public_tag_posts_tags ON public_tag_posts USING GIN (tags)',
  'CREATE INDEX IF NOT EXISTS idx_public_tag_posts_published ON public_tag_posts (published_at DESC, id DESC)',
]

export interface InstanceTagFollowRecord {
  tag: string
  actor_uri: string
  inbox_uri: string
  follow_activity_id: string
  accepted: boolean
  created_at: Date
  updated_at: Date
}

export interface InstanceTagFollowInput {
  tag: string
  actor_uri: string
  inbox_uri: string
  follow_activity_id: string
}

export interface PublicTagPostInput {
  note_uri: string
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  content: string
  url: string | null
  images: TimelineImage[]
  tags: string[]
  /** The tag actors' `Announce` ids that brought the post in; empty for a local post. */
  announce_uris: string[]
  /** The local author of one of this server's own posts, else null. */
  local_user: string | null
  published_at: Date
}

export interface PublicTagPostRecord extends PublicTagPostInput {
  id: string
  created_at: Date
  updated_at: Date
  /** `published_at` as Postgres text, at the µs precision the page predicate compares. */
  cursor_ts: string
}

export interface PublicTagsApi {
  listInstanceTagFollows: () => Promise<InstanceTagFollowRecord[]>
  getInstanceTagFollow: (tag: string) => Promise<InstanceTagFollowRecord | null>
  getInstanceTagFollowByActor: (actorUri: string) => Promise<InstanceTagFollowRecord | null>
  getInstanceTagFollowByFollowId: (followActivityId: string) => Promise<InstanceTagFollowRecord | null>
  /** Inserts or replaces the follow of `tag`, pending again until its actor accepts. */
  upsertInstanceTagFollow: (input: InstanceTagFollowInput) => Promise<InstanceTagFollowRecord>
  setInstanceTagFollowAccepted: (
    followActivityId: string,
    accepted: boolean,
  ) => Promise<InstanceTagFollowRecord | null>
  deleteInstanceTagFollow: (tag: string) => Promise<boolean>
  /** Keyed on the Note's id: a re-announce or edit replaces it in place, gathering every Announce id. */
  upsertPublicTagPost: (input: PublicTagPostInput) => Promise<PublicTagPostRecord>
  /** Drops the Announce, and the post once nothing keeps it (no Announce left and not local). */
  removePublicTagAnnounce: (announceUri: string) => Promise<void>
  /** The author's own Delete: scoped to the sender like the timeline's. */
  deletePublicTagPost: (noteUri: string, actorUri: string) => Promise<boolean>
  deleteLocalPublicTagPost: (noteUri: string, localUser: string) => Promise<boolean>
  /** A remote actor deleting themselves: every remote post of theirs. */
  deletePublicTagPostsByActor: (actorUri: string) => Promise<number>
  /**
   * Newest first by `(published_at, id)`, after `before` when given, published within the last
   * `retentionDays` (so a lowered retention takes effect before the nightly prune).
   */
  listPublicTagPosts: (
    tag: string,
    limit: number,
    options: { retentionDays: number; before?: KeysetCursor },
  ) => Promise<PublicTagPostRecord[]>
  /**
   * The official feed's remote posts: by one of `handles` (`@user@host`, compared
   * case-insensitively), carrying one of `tags`, newest first by `(published_at, id)`
   * after `before` when given, with no retention limit.
   */
  listOfficialRemotePosts: (
    handles: string[],
    tags: string[],
    limit: number,
    before?: KeysetCursor,
  ) => Promise<PublicTagPostRecord[]>
  /** Drops the posts published before `olderThan`, except those `keep` matches. */
  prunePublicTagPosts: (olderThan: Date, keep?: PublicTagPruneKeep) => Promise<number>
  /** Drops the posts that carry none of `tags` (all of them when `tags` is empty). */
  prunePublicTagPostsNotTagged: (tags: string[]) => Promise<number>
}

/** Posts exempt from the retention prune: by one of `handles` and carrying one of `tags`. */
export interface PublicTagPruneKeep {
  /** `@user@host`, compared case-insensitively. */
  handles: string[]
  tags: string[]
}

const FOLLOW_COLUMNS = 'tag, actor_uri, inbox_uri, follow_activity_id, accepted, created_at, updated_at'

const POST_COLUMNS = `id, note_uri, actor_uri, handle, display_name, avatar_url, content, url, images, tags,
  announce_uris, local_user, published_at, created_at, updated_at, published_at::text AS cursor_ts`

const followWhere =
  (getClient: () => Promise<Queryable>, column: string) =>
  async (value: string): Promise<InstanceTagFollowRecord | null> => {
    const client = await getClient()
    const result = await client.query<InstanceTagFollowRecord>(
      `SELECT ${FOLLOW_COLUMNS} FROM instance_tag_follows WHERE ${column} = $1`,
      [value],
    )
    return result.rows[0] ?? null
  }

export const createPublicTagsApi = (getClient: () => Promise<Queryable>): PublicTagsApi => ({
  deleteInstanceTagFollow: async (tag) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM instance_tag_follows WHERE tag = $1', [tag])
    return (result.rowCount ?? 0) > 0
  },

  deleteLocalPublicTagPost: async (noteUri, localUser) => {
    const client = await getClient()
    const result = await client.query(
      'DELETE FROM public_tag_posts WHERE note_uri = $1 AND local_user = $2',
      [noteUri, localUser],
    )
    return (result.rowCount ?? 0) > 0
  },

  deletePublicTagPost: async (noteUri, actorUri) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM public_tag_posts WHERE note_uri = $1 AND actor_uri = $2', [
      noteUri,
      actorUri,
    ])
    return (result.rowCount ?? 0) > 0
  },

  deletePublicTagPostsByActor: async (actorUri) => {
    const client = await getClient()
    const result = await client.query(
      'DELETE FROM public_tag_posts WHERE actor_uri = $1 AND local_user IS NULL',
      [actorUri],
    )
    return result.rowCount ?? 0
  },

  getInstanceTagFollow: followWhere(getClient, 'tag'),
  getInstanceTagFollowByActor: followWhere(getClient, 'actor_uri'),
  getInstanceTagFollowByFollowId: followWhere(getClient, 'follow_activity_id'),

  listInstanceTagFollows: async () => {
    const client = await getClient()
    const result = await client.query<InstanceTagFollowRecord>(
      `SELECT ${FOLLOW_COLUMNS} FROM instance_tag_follows ORDER BY tag`,
    )
    return result.rows
  },

  listPublicTagPosts: async (tag, limit, { before, retentionDays }) => {
    const client = await getClient()
    const result = await client.query<PublicTagPostRecord>(
      `SELECT ${POST_COLUMNS} FROM public_tag_posts
       WHERE tags @> ARRAY[$1]::text[]
         AND published_at >= NOW() - make_interval(days => $5::int)
         AND ($3::timestamptz IS NULL OR (published_at, id) < ($3::timestamptz, $4::uuid))
       ORDER BY published_at DESC, id DESC
       LIMIT $2`,
      [tag, limit, before?.ts ?? null, before?.id ?? null, retentionDays],
    )
    return result.rows
  },

  listOfficialRemotePosts: async (handles, tags, limit, before) => {
    const client = await getClient()
    const result = await client.query<PublicTagPostRecord>(
      `SELECT ${POST_COLUMNS} FROM public_tag_posts
       WHERE lower(handle) = ANY($1::text[])
         AND tags && $2::text[]
         AND local_user IS NULL
         AND ($4::timestamptz IS NULL OR (published_at, id) < ($4::timestamptz, $5::uuid))
       ORDER BY published_at DESC, id DESC
       LIMIT $3`,
      [handles.map((handle) => handle.toLowerCase()), tags, limit, before?.ts ?? null, before?.id ?? null],
    )
    return result.rows
  },

  prunePublicTagPosts: async (olderThan, keep) => {
    const client = await getClient()
    const result = await client.query(
      `DELETE FROM public_tag_posts
       WHERE published_at < $1
         AND NOT COALESCE(lower(handle) = ANY($2::text[]) AND tags && $3::text[], false)`,
      [olderThan, (keep?.handles ?? []).map((handle) => handle.toLowerCase()), keep?.tags ?? []],
    )
    return result.rowCount ?? 0
  },

  prunePublicTagPostsNotTagged: async (tags) => {
    const client = await getClient()
    const result = await client.query('DELETE FROM public_tag_posts WHERE NOT (tags && $1::text[])', [tags])
    return result.rowCount ?? 0
  },

  removePublicTagAnnounce: async (announceUri) => {
    const client = await getClient()
    const result = await client.query<{ id: string }>(
      `UPDATE public_tag_posts
       SET announce_uris = array_remove(announce_uris, $1), updated_at = NOW()
       WHERE $1 = ANY(announce_uris)
       RETURNING id`,
      [announceUri],
    )
    if (result.rows.length === 0) return
    await client.query(
      `DELETE FROM public_tag_posts WHERE id = ANY($1::uuid[]) AND announce_uris = '{}' AND local_user IS NULL`,
      [result.rows.map((row) => row.id)],
    )
  },

  setInstanceTagFollowAccepted: async (followActivityId, accepted) => {
    const client = await getClient()
    const result = await client.query<InstanceTagFollowRecord>(
      `UPDATE instance_tag_follows SET accepted = $2, updated_at = NOW()
       WHERE follow_activity_id = $1
       RETURNING ${FOLLOW_COLUMNS}`,
      [followActivityId, accepted],
    )
    return result.rows[0] ?? null
  },

  upsertInstanceTagFollow: async (input) => {
    const client = await getClient()
    const result = await client.query<InstanceTagFollowRecord>(
      `INSERT INTO instance_tag_follows (tag, actor_uri, inbox_uri, follow_activity_id)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tag) DO UPDATE SET
         actor_uri = EXCLUDED.actor_uri,
         inbox_uri = EXCLUDED.inbox_uri,
         follow_activity_id = EXCLUDED.follow_activity_id,
         accepted = false,
         updated_at = NOW()
       RETURNING ${FOLLOW_COLUMNS}`,
      [input.tag, input.actor_uri, input.inbox_uri, input.follow_activity_id],
    )
    return result.rows[0]
  },

  upsertPublicTagPost: async (input) => {
    const client = await getClient()
    const result = await client.query<PublicTagPostRecord>(
      `INSERT INTO public_tag_posts (note_uri, actor_uri, handle, display_name, avatar_url, content, url,
         images, tags, announce_uris, local_user, published_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::text[], $10::text[], $11, $12)
       ON CONFLICT (note_uri) DO UPDATE SET
         actor_uri = EXCLUDED.actor_uri,
         handle = EXCLUDED.handle,
         display_name = EXCLUDED.display_name,
         avatar_url = EXCLUDED.avatar_url,
         content = EXCLUDED.content,
         url = EXCLUDED.url,
         images = EXCLUDED.images,
         tags = EXCLUDED.tags,
         announce_uris = ARRAY(
           SELECT DISTINCT unnest(public_tag_posts.announce_uris || EXCLUDED.announce_uris)
         ),
         local_user = COALESCE(EXCLUDED.local_user, public_tag_posts.local_user),
         published_at = EXCLUDED.published_at,
         updated_at = NOW()
       RETURNING ${POST_COLUMNS}`,
      [
        input.note_uri,
        input.actor_uri,
        input.handle,
        input.display_name,
        input.avatar_url,
        input.content,
        input.url,
        JSON.stringify(input.images),
        input.tags,
        input.announce_uris,
        input.local_user,
        input.published_at,
      ],
    )
    return result.rows[0]
  },
})
