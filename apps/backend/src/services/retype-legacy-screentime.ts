/**
 * Legacy (v1) screentime spans were stored as `activity_type = 'screentime'`
 * before every category got its own type. This one-shot, per-user migration
 * retypes them to their category's `activity_type_name`, matched by the joined
 * category path. A legacy row that already has a v2 twin (same source, start
 * and target type) is soft-deleted instead. Rows whose path matches no
 * category, or sits under an excluded category, stay `screentime`.
 *
 * Completion is recorded via `sync_state` (provider='aurboda',
 * data_type='screentime_retype'), so subsequent calls short-circuit.
 */

import { query, withUserTransaction } from '../db/connection.ts'
import { getScreentimeCategories, getSyncState, upsertSyncState } from '../db/index.ts'
import { auditInfo } from './audit-log.ts'
import { ensureAllCategoriesHaveTypes } from './screentime-category-sync.ts'

export interface RetypeLegacyScreentimeResult {
  retyped: number
  deduplicated: number
  skipped: boolean
}

const RETYPE_DATA_TYPE = 'screentime_retype'

// Joined names are not unique in the schema; DISTINCT ON picks one category per path deterministically.
// Categories at or under an excluded one are skipped: their legacy rows stay `screentime`, where the
// daily summary's screentime branch still filters them out.
const CATEGORY_TYPES_CTE = `
  WITH cat AS (
    SELECT DISTINCT ON (array_to_string(c.name, ' > '))
           array_to_string(c.name, ' > ') AS path, c.activity_type_name
      FROM screentime_categories c
     WHERE c.activity_type_name IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM screentime_categories e
          WHERE e.exclude_from_screentime
            AND c.name[1:array_length(e.name, 1)] = e.name
       )
     ORDER BY array_to_string(c.name, ' > '), c.id
  )`

const markCompleted = (user: string) =>
  upsertSyncState(user, {
    data_type: RETYPE_DATA_TYPE,
    last_sync_time: new Date(),
    provider: 'aurboda',
    status: 'idle',
  })

export const retypeLegacyScreentime = async (user: string): Promise<RetypeLegacyScreentimeResult> => {
  const state = await getSyncState(user, 'aurboda', RETYPE_DATA_TYPE)
  if (state?.status === 'idle' && state.last_sync_time) {
    return { deduplicated: 0, retyped: 0, skipped: true }
  }

  const categories = await getScreentimeCategories(user)
  await ensureAllCategoriesHaveTypes(user, categories)

  const { deduplicated, retyped } = await withUserTransaction(user, async (tx) => {
    const dedup = await query(
      tx,
      `${CATEGORY_TYPES_CTE}
       UPDATE activities a SET deleted_at = NOW()
         FROM cat c
        WHERE a.activity_type = 'screentime' AND a.deleted_at IS NULL
          AND a.data->>'category_path' = c.path
          AND EXISTS (SELECT 1 FROM activities b
                       WHERE b.id <> a.id AND b.source = a.source AND b.start_time = a.start_time
                         AND b.activity_type = c.activity_type_name AND b.deleted_at IS NULL)`,
    )
    // The NOT EXISTS guard keeps a row that would collide with a soft-deleted
    // twin on idx_activities_type_time (which ignores deleted_at) as `screentime`.
    const retype = await query(
      tx,
      `${CATEGORY_TYPES_CTE}
       UPDATE activities a SET activity_type = c.activity_type_name
         FROM cat c
        WHERE a.activity_type = 'screentime' AND a.deleted_at IS NULL
          AND a.data->>'category_path' = c.path
          AND NOT (a.external_id IS NULL AND EXISTS (
                SELECT 1 FROM activities b
                 WHERE b.external_id IS NULL AND b.source = a.source
                   AND b.start_time = a.start_time AND b.activity_type = c.activity_type_name))`,
    )
    return { deduplicated: dedup.rowCount ?? 0, retyped: retype.rowCount ?? 0 }
  })

  await markCompleted(user)

  if (retyped > 0 || deduplicated > 0) {
    await auditInfo(user, 'data', `Retyped ${retyped} legacy screentime activities`, {
      deduplicated,
      retyped,
    })
  }

  return { deduplicated, retyped, skipped: false }
}
