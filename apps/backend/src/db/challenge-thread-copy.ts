import type { ChallengeThreadAudience, ChallengeThreadEntryKind, TimelineImage } from '@aurboda/api-spec'

import type { ChallengeParticipationRecord, ParticipationRow } from './challenges.ts'
import type { Queryable } from './pool.ts'

import { UUID_RE } from '../utils.ts'
import { mapParticipation, PARTICIPATION_COLUMNS } from './challenges.ts'
import { query, withUserTransaction } from './connection.ts'

export interface ThreadCopyEntryRecord {
  id: string
  participation_id: string
  object_uri: string
  in_reply_to_uri: string | null
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
  created_at: Date
}

export type ThreadCopyEntryInput = Omit<ThreadCopyEntryRecord, 'created_at' | 'id' | 'participation_id'>

const COLUMNS =
  'id, participation_id, object_uri, in_reply_to_uri, kind, audience, actor_uri, handle, display_name, avatar_url, content, images, url, published_at, edited_at, created_at'

const mapEntry = (row: ThreadCopyEntryRecord): ThreadCopyEntryRecord => ({ ...row, images: row.images ?? [] })

const UPSERT_SQL = `INSERT INTO challenge_thread_copies
     (participation_id, object_uri, in_reply_to_uri, kind, audience, actor_uri, handle, display_name,
      avatar_url, content, images, url, published_at, edited_at)
   VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13, $14)
   ON CONFLICT (participation_id, object_uri) DO UPDATE SET
     in_reply_to_uri = EXCLUDED.in_reply_to_uri,
     kind = EXCLUDED.kind,
     audience = EXCLUDED.audience,
     actor_uri = EXCLUDED.actor_uri,
     handle = EXCLUDED.handle,
     display_name = EXCLUDED.display_name,
     avatar_url = EXCLUDED.avatar_url,
     content = EXCLUDED.content,
     images = EXCLUDED.images,
     url = EXCLUDED.url,
     published_at = EXCLUDED.published_at,
     edited_at = EXCLUDED.edited_at
   RETURNING ${COLUMNS}, (xmax = 0) AS inserted`

const upsertParams = (participationId: string, input: ThreadCopyEntryInput): unknown[] => [
  participationId,
  input.object_uri,
  input.in_reply_to_uri,
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
]

/** Make the copy of a participation's thread exactly `rows`, keeping the ids of rows already there. */
export const replaceThreadCopy = async (
  user: string,
  participationId: string,
  rows: readonly ThreadCopyEntryInput[],
): Promise<void> => {
  await withUserTransaction(user, async (tx: Queryable) => {
    for (const row of rows) await tx.query(UPSERT_SQL, upsertParams(participationId, row))
    await tx.query(
      `DELETE FROM challenge_thread_copies
        WHERE participation_id = $1 AND NOT (object_uri = ANY($2::text[]))`,
      [participationId, rows.map((row) => row.object_uri)],
    )
  })
}

export const upsertThreadCopyEntry = async (
  user: string,
  participationId: string,
  input: ThreadCopyEntryInput,
): Promise<{ entry: ThreadCopyEntryRecord; inserted: boolean }> => {
  const result = await query<ThreadCopyEntryRecord & { inserted: boolean }>(
    user,
    UPSERT_SQL,
    upsertParams(participationId, input),
  )
  const { inserted, ...entry } = result.rows[0]
  return { entry: mapEntry(entry), inserted }
}

export const listThreadCopy = async (
  user: string,
  participationId: string,
): Promise<ThreadCopyEntryRecord[]> => {
  const result = await query<ThreadCopyEntryRecord>(
    user,
    `SELECT ${COLUMNS} FROM challenge_thread_copies WHERE participation_id = $1
      ORDER BY published_at DESC, id DESC`,
    [participationId],
  )
  return result.rows.map(mapEntry)
}

export const getThreadCopyEntryById = async (
  user: string,
  id: string,
): Promise<ThreadCopyEntryRecord | null> => {
  if (!UUID_RE.test(id)) return null
  const result = await query<ThreadCopyEntryRecord>(
    user,
    `SELECT ${COLUMNS} FROM challenge_thread_copies WHERE id = $1`,
    [id],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

export const getThreadCopyEntryByObjectUri = async (
  user: string,
  participationId: string,
  objectUri: string,
): Promise<ThreadCopyEntryRecord | null> => {
  const result = await query<ThreadCopyEntryRecord>(
    user,
    `SELECT ${COLUMNS} FROM challenge_thread_copies WHERE participation_id = $1 AND object_uri = $2`,
    [participationId, objectUri],
  )
  return result.rows[0] ? mapEntry(result.rows[0]) : null
}

/** Delete the copies of `objectUri` that `actorUri` wrote, in every participation. The number deleted. */
export const deleteThreadCopyEntry = async (
  user: string,
  objectUri: string,
  actorUri: string,
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM challenge_thread_copies WHERE object_uri = $1 AND actor_uri = $2`,
    [objectUri, actorUri],
  )
  return result.rowCount ?? 0
}

export interface ParticipationThreadState {
  challenge_object_uri?: string | null
  host_actor_uri?: string | null
  thread_url?: string | null
  thread_synced_at?: Date | null
  thread_attendees?: readonly string[]
  thread_audiences?: readonly ChallengeThreadAudience[]
}

/** Patch what a participation remembers of the host's thread; null when there is no such row. */
export const updateParticipationThreadState = async (
  user: string,
  participationId: string,
  state: ParticipationThreadState,
): Promise<ChallengeParticipationRecord | null> => {
  const sets: string[] = []
  const params: unknown[] = []
  const set = (column: string, value: unknown, cast = '') => {
    params.push(value)
    sets.push(`${column} = $${params.length}${cast}`)
  }
  if (state.challenge_object_uri !== undefined) set('challenge_object_uri', state.challenge_object_uri)
  if (state.host_actor_uri !== undefined) set('host_actor_uri', state.host_actor_uri)
  if (state.thread_url !== undefined) set('thread_url', state.thread_url)
  if (state.thread_synced_at !== undefined) set('thread_synced_at', state.thread_synced_at)
  if (state.thread_attendees !== undefined) {
    set('thread_attendees', JSON.stringify(state.thread_attendees), '::jsonb')
  }
  if (state.thread_audiences !== undefined) {
    set('thread_audiences', JSON.stringify(state.thread_audiences), '::jsonb')
  }
  params.push(participationId)
  const result = await query<ParticipationRow>(
    user,
    sets.length === 0
      ? `SELECT ${PARTICIPATION_COLUMNS} FROM challenge_participations WHERE id = $1`
      : `UPDATE challenge_participations SET ${sets.join(', ')}
          WHERE id = $${params.length}
          RETURNING ${PARTICIPATION_COLUMNS}`,
    params,
  )
  return result.rows.length ? mapParticipation(result.rows[0]) : null
}

/** The active participation whose challenge has this object id. */
export const getParticipationByObjectUri = async (
  user: string,
  objectUri: string,
): Promise<ChallengeParticipationRecord | null> => {
  const result = await query<ParticipationRow>(
    user,
    `SELECT ${PARTICIPATION_COLUMNS} FROM challenge_participations
      WHERE challenge_object_uri = $1 AND status = 'active'
      ORDER BY created_at DESC LIMIT 1`,
    [objectUri],
  )
  return result.rows.length ? mapParticipation(result.rows[0]) : null
}
