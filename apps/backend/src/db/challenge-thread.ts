import type { ChallengeThreadAudience, ChallengeThreadEntryKind, TimelineImage } from '@aurboda/api-spec'

import { UUID_RE } from '../utils.ts'
import { query } from './connection.ts'

export interface ChallengeThreadEntryRecord {
  id: string
  challenge_id: string
  object_uri: string
  in_reply_to_uri: string | null
  root_entry_id: string | null
  kind: ChallengeThreadEntryKind
  audience: ChallengeThreadAudience
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  content: string
  images: TimelineImage[]
  url: string | null
  published_at: Date
  edited_at: Date | null
  hidden_at: Date | null
  created_at: Date
}

export interface ChallengeThreadEntryPageRow extends ChallengeThreadEntryRecord {
  /** `published_at` as Postgres text (µs precision), for the keyset cursor only. */
  cursor_ts: string
}

export interface ChallengeThreadEntryInput {
  challenge_id: string
  object_uri: string
  in_reply_to_uri: string | null
  root_entry_id: string | null
  kind: ChallengeThreadEntryKind
  audience: ChallengeThreadAudience
  actor_uri: string
  handle: string | null
  display_name: string | null
  avatar_url: string | null
  content: string
  images: TimelineImage[]
  url: string | null
  published_at: Date
  edited_at: Date | null
}

export interface ChallengeThreadCursor {
  published_at: string
  id: string
}

const COLUMNS =
  'id, challenge_id, object_uri, in_reply_to_uri, root_entry_id, kind, audience, actor_uri, handle, display_name, avatar_url, content, images, url, published_at, edited_at, hidden_at, created_at'

const qualified = (alias: string): string =>
  COLUMNS.split(', ')
    .map((column) => `${alias}.${column}`)
    .join(', ')

type Row = ChallengeThreadEntryRecord

const mapEntry = (row: Row): ChallengeThreadEntryRecord => ({ ...row, images: row.images ?? [] })

/**
 * Insert an entry, or update the one with the same `object_uri` when it belongs to the same
 * challenge and was written by the same actor. Null when a row with that `object_uri` exists for
 * another actor or another challenge: nothing is written then.
 */
export const upsertChallengeThreadEntry = async (
  user: string,
  input: ChallengeThreadEntryInput,
): Promise<{ entry: ChallengeThreadEntryRecord; inserted: boolean } | null> => {
  const result = await query<Row & { inserted: boolean }>(
    user,
    `INSERT INTO challenge_thread_entries
       (challenge_id, object_uri, in_reply_to_uri, root_entry_id, kind, audience, actor_uri, handle,
        display_name, avatar_url, content, images, url, published_at, edited_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13, $14, $15)
     ON CONFLICT (object_uri) DO UPDATE SET
       in_reply_to_uri = EXCLUDED.in_reply_to_uri,
       root_entry_id = EXCLUDED.root_entry_id,
       kind = EXCLUDED.kind,
       audience = EXCLUDED.audience,
       handle = EXCLUDED.handle,
       display_name = EXCLUDED.display_name,
       avatar_url = EXCLUDED.avatar_url,
       content = EXCLUDED.content,
       images = EXCLUDED.images,
       url = EXCLUDED.url,
       edited_at = EXCLUDED.edited_at
     WHERE challenge_thread_entries.actor_uri = EXCLUDED.actor_uri
       AND challenge_thread_entries.challenge_id = EXCLUDED.challenge_id
     RETURNING ${COLUMNS}, (xmax = 0) AS inserted`,
    [
      input.challenge_id,
      input.object_uri,
      input.in_reply_to_uri,
      input.root_entry_id,
      input.kind,
      input.audience,
      input.actor_uri,
      input.handle,
      input.display_name,
      input.avatar_url,
      input.content,
      JSON.stringify(input.images),
      input.url,
      input.published_at,
      input.edited_at,
    ],
  )
  const row = result.rows[0]
  if (row == null) return null
  const { inserted, ...entry } = row
  return { entry: mapEntry(entry), inserted }
}

export const getChallengeThreadEntryById = async (
  user: string,
  id: string,
): Promise<ChallengeThreadEntryRecord | null> => {
  if (!UUID_RE.test(id)) return null
  const result = await query<Row>(user, `SELECT ${COLUMNS} FROM challenge_thread_entries WHERE id = $1`, [id])
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export const getChallengeThreadEntryByObjectUri = async (
  user: string,
  objectUri: string,
): Promise<ChallengeThreadEntryRecord | null> => {
  const result = await query<Row>(
    user,
    `SELECT ${COLUMNS} FROM challenge_thread_entries WHERE object_uri = $1`,
    [objectUri],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export interface ThreadVisibility {
  audiences: readonly ChallengeThreadAudience[]
  include_hidden: boolean
}

/** A keyset page of a challenge's top-level entries, newest first. */
export const listChallengeThreadTopLevel = async (
  user: string,
  challengeId: string,
  visibility: ThreadVisibility,
  limit: number,
  before?: ChallengeThreadCursor,
): Promise<ChallengeThreadEntryPageRow[]> => {
  const result = await query<Row & { cursor_ts: string }>(
    user,
    `SELECT ${COLUMNS}, published_at::text AS cursor_ts FROM challenge_thread_entries
      WHERE challenge_id = $1 AND root_entry_id IS NULL
        AND audience = ANY($2::text[])
        AND ($3::boolean OR hidden_at IS NULL)
        AND ($4::timestamptz IS NULL OR (published_at, id) < ($4::timestamptz, $5::uuid))
      ORDER BY published_at DESC, id DESC
      LIMIT $6`,
    [
      challengeId,
      visibility.audiences,
      visibility.include_hidden,
      before?.published_at ?? null,
      before?.id ?? null,
      limit,
    ],
  )
  return result.rows.map((row) => ({ ...mapEntry(row), cursor_ts: row.cursor_ts }))
}

/** The replies under each of `rootIds`, oldest first, at most `perRoot` per root. */
export const listChallengeThreadReplies = async (
  user: string,
  rootIds: readonly string[],
  visibility: ThreadVisibility,
  perRoot: number,
): Promise<ChallengeThreadEntryRecord[]> => {
  if (rootIds.length === 0) return []
  const result = await query<Row>(
    user,
    `SELECT ${COLUMNS} FROM (
       SELECT ${qualified('e')},
              row_number() OVER (PARTITION BY e.root_entry_id ORDER BY e.published_at ASC, e.id ASC) AS n
         FROM challenge_thread_entries e
        WHERE e.root_entry_id = ANY($1::uuid[])
          AND e.audience = ANY($2::text[])
          AND ($3::boolean OR e.hidden_at IS NULL)
     ) ranked
     WHERE n <= $4
     ORDER BY published_at ASC, id ASC`,
    [rootIds, visibility.audiences, visibility.include_hidden, perRoot],
  )
  return result.rows.map(mapEntry)
}

/** Every entry of a challenge's thread, hidden or not: what the cap counts. */
export const countChallengeThreadEntries = async (user: string, challengeId: string): Promise<number> => {
  const result = await query<{ count: number }>(
    user,
    `SELECT count(*)::int AS count FROM challenge_thread_entries WHERE challenge_id = $1`,
    [challengeId],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** The entries a viewer can see: the audiences given, and without hidden ones unless included. */
export const countVisibleChallengeThreadEntries = async (
  user: string,
  challengeId: string,
  visibility: ThreadVisibility,
): Promise<number> => {
  const result = await query<{ count: number }>(
    user,
    `SELECT count(*)::int AS count
       FROM challenge_thread_entries e
       LEFT JOIN challenge_thread_entries root ON root.id = e.root_entry_id
      WHERE e.challenge_id = $1
        AND e.audience = ANY($2::text[])
        AND ($3::boolean OR (e.hidden_at IS NULL AND root.hidden_at IS NULL))
        AND (root.id IS NULL OR root.audience = ANY($2::text[]))`,
    [challengeId, visibility.audiences, visibility.include_hidden],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/**
 * Delete the entry with this `object_uri` when `actorUri` wrote it; its replies go with it. The
 * deleted row, or null when there was none for that actor.
 */
export const deleteChallengeThreadEntry = async (
  user: string,
  objectUri: string,
  actorUri: string,
): Promise<ChallengeThreadEntryRecord | null> => {
  const result = await query<Row>(
    user,
    `DELETE FROM challenge_thread_entries WHERE object_uri = $1 AND actor_uri = $2 RETURNING ${COLUMNS}`,
    [objectUri, actorUri],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

/** The entries `actorUri` added to a challenge's thread since `since`: what the inbound rate limit counts. */
export const countChallengeThreadEntriesByActorSince = async (
  user: string,
  challengeId: string,
  actorUri: string,
  since: Date,
): Promise<number> => {
  const result = await query<{ count: number }>(
    user,
    `SELECT count(*)::int AS count FROM challenge_thread_entries
      WHERE challenge_id = $1 AND actor_uri = $2 AND created_at >= $3`,
    [challengeId, actorUri, since],
  )
  return Number(result.rows[0]?.count ?? 0)
}

/** Delete every entry `actorUri` wrote, in every thread (an actor deleting itself). The number deleted. */
export const deleteChallengeThreadEntriesByActor = async (
  user: string,
  actorUri: string,
): Promise<number> => {
  const result = await query(user, `DELETE FROM challenge_thread_entries WHERE actor_uri = $1`, [actorUri])
  return result.rowCount ?? 0
}

/** Hide (stamp `hidden_at`, keeping an earlier stamp) or unhide an entry of a challenge. */
export const setChallengeThreadEntryHidden = async (
  user: string,
  challengeId: string,
  id: string,
  hidden: boolean,
): Promise<ChallengeThreadEntryRecord | null> => {
  if (!UUID_RE.test(id)) return null
  const result = await query<Row>(
    user,
    `UPDATE challenge_thread_entries
        SET hidden_at = CASE WHEN $3::boolean THEN COALESCE(hidden_at, NOW()) ELSE NULL END
      WHERE id = $1 AND challenge_id = $2
      RETURNING ${COLUMNS}`,
    [id, challengeId, hidden],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

/**
 * The visible entries of a challenge's thread for the given audiences, replies included as
 * ordinary rows, newest first: no hidden entry and no reply under a hidden or unreadable root.
 */
export const listChallengeThreadDocumentEntries = async (
  user: string,
  challengeId: string,
  audiences: readonly ChallengeThreadAudience[],
  limit: number,
): Promise<ChallengeThreadEntryRecord[]> => {
  if (audiences.length === 0) return []
  const result = await query<Row>(
    user,
    `SELECT ${qualified('e')}
       FROM challenge_thread_entries e
       LEFT JOIN challenge_thread_entries root ON root.id = e.root_entry_id
      WHERE e.challenge_id = $1
        AND e.audience = ANY($2::text[])
        AND e.hidden_at IS NULL
        AND (root.id IS NULL OR (root.hidden_at IS NULL AND root.audience = ANY($2::text[])))
      ORDER BY e.published_at DESC, e.id DESC
      LIMIT $3`,
    [challengeId, audiences, limit],
  )
  return result.rows.map(mapEntry)
}
