/**
 * Rebuilds every screentime span activity from the productivity records'
 * current `resolved_category`, so a recategorization reaches the timeline:
 * spans are upserted under their v2 identity (reviving a soft-deleted one
 * the records produce again) and spans no longer produced by any record are
 * soft-deleted. Retyped v1 spans (external_id ending in the
 * joined category path) are folded into the v2 identity first, so the upsert
 * lands on them instead of creating a duplicate.
 */

import type { ProductivityRecord } from '../db/types.ts'

import { query, withUserTransaction } from '../db/connection.ts'
import { getScreentimeCategories, insertActivities } from '../db/index.ts'
import { auditInfo } from './audit-log.ts'
import { buildScreentimeActivitySpans, spansToActivities } from './screentime-activities.ts'
import { ensureAllCategoriesHaveTypes } from './screentime-category-sync.ts'

export interface RebuildScreentimeSpansResult {
  upserted: number
  removed: number
  deduplicated: number
}

const SCREENTIME_SOURCES = ['rescuetime', 'activitywatch']

const INSERT_BATCH_SIZE = 1000

const startMs = (alias: string) => `floor(extract(epoch from ${alias}.start_time) * 1000)::bigint`
const v1ExternalId = (alias: string) =>
  `${alias}.source || '_' || ${startMs(alias)} || '_' || (${alias}.data->>'category_path')`
const v2ExternalId = (alias: string) =>
  `${alias}.source || '_' || ${startMs(alias)} || '_' || ${alias}.activity_type`

const V1_EXTERNAL_ID = v1ExternalId('a')
const V2_EXTERNAL_ID = v2ExternalId('a')

// A top-level category whose name already is its slug (`games`) gives both identities the
// same string, so a v2 row would match the v1 predicate; such rows are left alone.

const foldV1Spans = (user: string): Promise<number> =>
  withUserTransaction(user, async (tx) => {
    const dedup = await query(
      tx,
      `UPDATE activities a SET deleted_at = NOW()
        WHERE a.deleted_at IS NULL AND a.source = ANY($1::text[])
          AND a.external_id = ${V1_EXTERNAL_ID} AND a.external_id <> ${V2_EXTERNAL_ID}
          AND EXISTS (SELECT 1 FROM activities b
                       WHERE b.id <> a.id AND b.deleted_at IS NULL AND b.source = a.source
                         AND b.external_id = ${V2_EXTERNAL_ID})`,
      [SCREENTIME_SOURCES],
    )
    // idx_activities_ext_id ignores deleted_at, so a v2 tombstone the rebuild does not produce, or a
    // second v1 row folding onto the same v2 id, would abort the rewrite; those v1 rows are left for
    // the stale sweep. Tombstones the rebuild does produce were revived already, so the dedup caught them.
    await query(
      tx,
      `UPDATE activities a SET external_id = ${V2_EXTERNAL_ID}
        WHERE a.deleted_at IS NULL AND a.source = ANY($1::text[])
          AND a.external_id = ${V1_EXTERNAL_ID} AND a.external_id <> ${V2_EXTERNAL_ID}
          AND NOT EXISTS (SELECT 1 FROM activities b
                           WHERE b.source = a.source AND b.external_id = ${V2_EXTERNAL_ID})
          AND NOT EXISTS (SELECT 1 FROM activities c
                           WHERE c.id < a.id AND c.deleted_at IS NULL AND c.source = a.source
                             AND c.start_time = a.start_time AND c.activity_type = a.activity_type
                             AND c.external_id = ${v1ExternalId('c')})`,
      [SCREENTIME_SOURCES],
    )
    return dedup.rowCount ?? 0
  })

// ORDER BY start_time is load-bearing: buildScreentimeActivitySpans merges adjacent records sequentially.
const loadCategorizedRecords = async (user: string): Promise<ProductivityRecord[]> => {
  const result = await query(
    user,
    `SELECT source, start_time, end_time, activity, title, duration_sec, resolved_category
       FROM productivity
      WHERE resolved_category IS NOT NULL
        AND deleted_at IS NULL
      ORDER BY start_time`,
  )
  return result.rows.map((row) => ({
    activity: row.activity as string,
    duration_sec: row.duration_sec as number,
    end_time: new Date(row.end_time as string),
    resolved_category: row.resolved_category as string[],
    source: row.source as ProductivityRecord['source'],
    start_time: new Date(row.start_time as string),
    ...(row.title ? { title: row.title as string } : {}),
  }))
}

const reviveProducedSpans = async (user: string, externalIds: string[]): Promise<void> => {
  for (let i = 0; i < externalIds.length; i += INSERT_BATCH_SIZE) {
    await query(
      user,
      `UPDATE activities a SET deleted_at = NULL
         FROM unnest($2::text[]) k(external_id)
        WHERE a.deleted_at IS NOT NULL AND a.source = ANY($1::text[])
          AND a.external_id = k.external_id`,
      [SCREENTIME_SOURCES, externalIds.slice(i, i + INSERT_BATCH_SIZE)],
    )
  }
}

// Derived per-category types outlive a deleted category, so they are matched by their
// type definition too; otherwise an orphaned span would double-count its records' time.
// A span created after the cutoff came from a sync that landed after the record
// snapshot; the snapshot never saw its records, so it is left to the next rebuild.
const removeStaleSpans = async (user: string, keepIds: string[], cutoff: Date): Promise<number> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW()
      WHERE deleted_at IS NULL AND source = ANY($1::text[])
        AND external_id IS NOT NULL AND created_at < $3
        AND (activity_type = 'screentime'
             OR activity_type IN (SELECT activity_type_name FROM screentime_categories
                                   WHERE activity_type_name IS NOT NULL)
             OR activity_type IN (SELECT name FROM activity_type_definitions
                                   WHERE display_category = 'productivity' AND NOT is_builtin))
        AND NOT EXISTS (SELECT 1 FROM unnest($2::uuid[]) k(id) WHERE k.id = activities.id)`,
    [SCREENTIME_SOURCES, keepIds, cutoff],
  )
  return result.rowCount ?? 0
}

const rebuild = async (
  user: string,
  { now = () => new Date() }: { now?: () => Date } = {},
): Promise<RebuildScreentimeSpansResult> => {
  const categories = await getScreentimeCategories(user)
  await ensureAllCategoriesHaveTypes(user, categories)

  const cutoff = now()
  const records = await loadCategorizedRecords(user)
  const activities = spansToActivities(buildScreentimeActivitySpans(records, categories))

  await reviveProducedSpans(
    user,
    activities.flatMap((a) => (a.external_id ? [a.external_id] : [])),
  )
  const deduplicated = await foldV1Spans(user)

  const keepIds: string[] = []
  for (let i = 0; i < activities.length; i += INSERT_BATCH_SIZE) {
    const inserted = await insertActivities(user, activities.slice(i, i + INSERT_BATCH_SIZE))
    for (const key of inserted) keepIds.push(key.id)
  }

  const removed = await removeStaleSpans(user, keepIds, cutoff)
  const upserted = keepIds.length

  if (deduplicated > 0 || removed > 0 || upserted > 0) {
    await auditInfo(user, 'data', 'Rebuilt screentime spans', { deduplicated, removed, upserted })
  }

  return { deduplicated, removed, upserted }
}

const inFlight = new Map<string, Promise<unknown>>()

/**
 * Rebuilds run one at a time per user: a second rebuild started while one is
 * still sweeping would otherwise have its upserts swept as stale by the first.
 */
export const rebuildScreentimeSpans = (
  user: string,
  options: { now?: () => Date } = {},
): Promise<RebuildScreentimeSpansResult> => {
  const previous = inFlight.get(user) ?? Promise.resolve()
  const run = previous.then(
    () => rebuild(user, options),
    () => rebuild(user, options),
  )
  inFlight.set(user, run)
  void run.finally(() => {
    if (inFlight.get(user) === run) inFlight.delete(user)
  })
  return run
}
