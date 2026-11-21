import type { EntityType, NoteRelatedEntityType } from '@aurboda/api-spec'

import type { Queryable } from './pool.ts'

import { UUID_RE } from '../utils.ts'
import { query } from './connection.ts'
import { PARENT_IS_LIVE, parentIdColumn } from './note-sql.ts'

export interface NoteLinkInput {
  entity_type: NoteRelatedEntityType
  entity_id: string
}

/** A visible link of a note, with what its label is made from. */
export interface NoteLinkRecord {
  entity_type: NoteRelatedEntityType
  entity_id: string
  /** The person's name; the activity's title, else its type's display name, else its type. */
  name: string
  /** An activity's start; null for a person. */
  start_time: Date | null
}

/** A note related to a target, with what a journal entry reference shows. */
export interface RelatedNoteRecord {
  id: string
  entity_type: EntityType
  title: string | null
  date: string | null
  start_time: Date | null
  content: string
}

/** Whether the target of the link aliased `l` is live: a soft-deleted person or activity hides it. */
const LINK_TARGET_IS_LIVE = `CASE l.entity_type
       WHEN 'person' THEN EXISTS (SELECT 1 FROM people p WHERE p.id = l.entity_id AND p.deleted_at IS NULL)
       ELSE EXISTS (SELECT 1 FROM activities a WHERE a.id = l.entity_id AND a.deleted_at IS NULL)
     END`

/** For the alias `n`: the note has a visible link to the target in the two parameters. */
export const relatedToCondition = (typeParam: string, idParam: string): string =>
  `EXISTS (SELECT 1 FROM note_links l
            WHERE l.note_id = n.id AND l.entity_type = ${typeParam} AND l.entity_id = ${idParam}::uuid
              AND ${LINK_TARGET_IS_LIVE})`

const dedupeLinks = (links: readonly NoteLinkInput[]): NoteLinkInput[] => {
  const seen = new Map<string, NoteLinkInput>()
  for (const link of links) {
    const entityId = link.entity_id.toLowerCase()
    seen.set(`${link.entity_type}:${entityId}`, { entity_id: entityId, entity_type: link.entity_type })
  }
  return [...seen.values()]
}

/** Replace a note's links with `links` (duplicates collapsed). Runs in the caller's transaction. */
export const replaceNoteLinks = async (
  tx: Queryable | string,
  noteId: string,
  links: readonly NoteLinkInput[],
): Promise<void> => {
  await query(tx, 'DELETE FROM note_links WHERE note_id = $1', [noteId])
  const unique = dedupeLinks(links)
  if (unique.length === 0) return
  await query(
    tx,
    `INSERT INTO note_links (note_id, entity_type, entity_id)
     SELECT $1, t.entity_type, t.entity_id
       FROM unnest($2::text[], $3::uuid[]) AS t(entity_type, entity_id)
     ON CONFLICT DO NOTHING`,
    [noteId, unique.map((l) => l.entity_type), unique.map((l) => l.entity_id)],
  )
}

/** The visible links of each note, people first, then by name; one query. */
export const getNoteLinksForNoteIds = async (
  user: string,
  noteIds: string[],
): Promise<Map<string, NoteLinkRecord[]>> => {
  if (noteIds.length === 0) return new Map()
  const result = await query<{
    note_id: string
    entity_type: NoteRelatedEntityType
    entity_id: string
    name: string
    start_time: Date | null
  }>(
    user,
    `SELECT l.note_id, l.entity_type, l.entity_id::text AS entity_id,
            COALESCE(p.name, NULLIF(a.title, ''), d.display_name, a.activity_type) AS name,
            a.start_time
       FROM note_links l
       LEFT JOIN people p ON l.entity_type = 'person' AND p.id = l.entity_id AND p.deleted_at IS NULL
       LEFT JOIN activities a ON l.entity_type = 'activity' AND a.id = l.entity_id AND a.deleted_at IS NULL
       LEFT JOIN activity_type_definitions d ON d.name = a.activity_type
      WHERE l.note_id = ANY($1::uuid[]) AND (p.id IS NOT NULL OR a.id IS NOT NULL)
      ORDER BY l.note_id, l.entity_type DESC, name, l.entity_id`,
    [noteIds],
  )
  const byNote = new Map<string, NoteLinkRecord[]>()
  for (const row of result.rows) {
    byNote.getOrInsert(row.note_id, []).push({
      entity_id: row.entity_id,
      entity_type: row.entity_type,
      name: row.name,
      start_time: row.start_time === null ? null : new Date(row.start_time),
    })
  }
  return byNote
}

/**
 * The live thread roots with a visible link to any of `targetIds`, newest first by anchor (a `day`
 * note's is the start of its date in `tz`), at most `limit`.
 */
export const listNotesRelatedTo = async (
  user: string,
  targetType: NoteRelatedEntityType,
  targetIds: string[],
  limit: number,
  tz: string,
): Promise<RelatedNoteRecord[]> => {
  const ids = [...new Set(targetIds.filter((id) => UUID_RE.test(id)))]
  if (ids.length === 0) return []
  const result = await query<{
    id: string
    entity_type: EntityType
    title: string | null
    date: string | null
    start_time: Date | null
    content: string
  }>(
    user,
    `SELECT n.id, n.entity_type, n.title, to_char(n."date", 'YYYY-MM-DD') AS "date", n.start_time, n.content
       FROM (
         SELECT n.*, ${parentIdColumn('$5')}
           FROM notes n
          WHERE n.entity_type <> 'note' AND n.deleted_at IS NULL
            AND EXISTS (SELECT 1 FROM note_links l
                         WHERE l.note_id = n.id AND l.entity_type = $1 AND l.entity_id = ANY($2::uuid[])
                           AND ${LINK_TARGET_IS_LIVE})
       ) n
      WHERE ${PARENT_IS_LIVE}
      ORDER BY COALESCE(n.start_time, n."date"::timestamp AT TIME ZONE $4, n.created_at) DESC,
               n.created_at DESC, n.id DESC
      LIMIT $3`,
    [targetType, ids, limit, tz, UUID_RE.source],
  )
  return result.rows.map((row) => ({
    ...row,
    start_time: row.start_time === null ? null : new Date(row.start_time),
  }))
}

/** The ids among `ids` that are a live person or activity, as the database spells them. */
export const listLiveLinkTargetIds = async (
  user: string,
  targetType: NoteRelatedEntityType,
  ids: string[],
): Promise<string[]> => {
  const wellFormed = ids.filter((id) => UUID_RE.test(id))
  if (wellFormed.length === 0) return []
  const table = targetType === 'person' ? 'people' : 'activities'
  const result = await query<{ id: string }>(
    user,
    `SELECT id::text AS id FROM ${table} WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL`,
    [wellFormed],
  )
  return result.rows.map((row) => row.id)
}

/** Remove the links to targets removed for good. Runs in the caller's transaction. */
export const deleteNoteLinksOfTarget = async (
  tx: Queryable | string,
  targetType: NoteRelatedEntityType,
  ids: string[],
): Promise<number> => {
  if (ids.length === 0) return 0
  const result = await query(
    tx,
    'DELETE FROM note_links WHERE entity_type = $1 AND entity_id = ANY($2::uuid[])',
    [targetType, ids],
  )
  return result.rowCount ?? 0
}

/**
 * Relate the notes related to any of the activities `fromIds` to `toId` too, as a merge folds
 * those activities into it. The old links stay, hidden while their activities are deleted.
 */
export const copyActivityNoteLinksIn = async (
  tx: Queryable,
  fromIds: string[],
  toId: string,
): Promise<void> => {
  if (fromIds.length === 0) return
  await query(
    tx,
    `INSERT INTO note_links (note_id, entity_type, entity_id)
     SELECT DISTINCT note_id, 'activity', $2::uuid FROM note_links
      WHERE entity_type = 'activity' AND entity_id = ANY($1::uuid[])
     ON CONFLICT DO NOTHING`,
    [fromIds, toId],
  )
}
