/**
 * Persisted supersession: materialize winner/loser relationships into the
 * `superseded_by` column so chart/trend queries can exclude duplicates with a
 * simple SQL filter instead of re-running the merge algorithm on every query.
 */
import type { Activity, MergedActivity } from '../types.ts'

import { ensureSchemaMigrationsTable, getDbForUser, query } from '../connection.ts'
import { mapActivityRow } from '../row-mappers.ts'
import { mergeOverlappingActivities } from './merge.ts'
import { activityColumns, fetchCategoryMap } from './queries.ts'

/** Window (half-day) used when materializing supersession around a given time. */
const MATERIALIZE_WINDOW_MS = 12 * 60 * 60 * 1000

const computeDesiredSupersession = (
  raw: Activity[],
  merged: MergedActivity[],
): Map<string, string | null> => {
  const desired = new Map<string, string | null>()
  // Index every source_id → its owning merged activity so the fallback loop
  // below stays O(n) instead of O(n*m) on large backfill windows.
  const ownerBySourceId = new Map<string, MergedActivity>()
  for (const m of merged) {
    if (!m.id) continue
    desired.set(m.id, null)
    if (!m.source_ids) continue
    for (const sid of m.source_ids) {
      ownerBySourceId.set(sid, m)
      if (sid !== m.id) desired.set(sid, m.id)
    }
  }
  // Raw activities that weren't picked up by any merged group (e.g. generic
  // exercises absorbed into a different-type activity) get their winner too.
  for (const a of raw) {
    if (!a.id || desired.has(a.id)) continue
    const owner = ownerBySourceId.get(a.id)
    desired.set(a.id, owner?.id && owner.id !== a.id ? owner.id : null)
  }
  return desired
}

/** Diff desired against current state and collect the rows that need UPDATEs. */
const diffSupersessionChanges = (
  raw: Activity[],
  desired: Map<string, string | null>,
): { toClear: string[]; toLoserByWinner: Map<string, string[]> } => {
  const toLoserByWinner = new Map<string, string[]>()
  const toClear: string[] = []
  for (const a of raw) {
    if (!a.id) continue
    const want = desired.get(a.id) ?? null
    const have = a.superseded_by ?? null
    if (want === have) continue
    if (want === null) {
      toClear.push(a.id)
    } else {
      toLoserByWinner.getOrInsert(want, []).push(a.id)
    }
  }
  return { toClear, toLoserByWinner }
}

/**
 * Persist winner/loser relationships in `superseded_by` for all activities in the
 * merge window around `aroundTime`. Reuses the same merge pipeline as the
 * timeline/daily-summary view so the two stay consistent.
 *
 * Idempotent: running twice produces the same result. Safe to call after any
 * upsert/delete/update that could change the merge topology.
 *
 * Chart and trend queries exclude rows with `superseded_by IS NOT NULL`.
 */
export const materializeSuperseded = async (user: string, aroundTime: Date): Promise<void> => {
  // Biased forward (12h back, 24h ahead) so syncs arriving after the physical
  // activity still find their earlier counterparts from other sources, and a
  // session crossing midnight UTC is covered from either boundary.
  const windowStart = new Date(aroundTime.getTime() - MATERIALIZE_WINDOW_MS)
  const windowEnd = new Date(aroundTime.getTime() + 2 * MATERIALIZE_WINDOW_MS)

  const result = await query(
    user,
    `SELECT ${activityColumns()}
     FROM activities
     WHERE deleted_at IS NULL
       AND start_time >= $1
       AND start_time <= $2
     ORDER BY start_time`,
    [windowStart, windowEnd],
  )

  const raw = result.rows.map(mapActivityRow)
  if (raw.length === 0) return

  const categoryMap = await fetchCategoryMap(user)
  const merged = mergeOverlappingActivities(raw, categoryMap)
  const desired = computeDesiredSupersession(raw, merged)
  const { toClear, toLoserByWinner } = diffSupersessionChanges(raw, desired)

  for (const [winner, losers] of toLoserByWinner) {
    await query(user, `UPDATE activities SET superseded_by = $1 WHERE id = ANY($2::uuid[])`, [winner, losers])
  }
  if (toClear.length > 0) {
    await query(user, `UPDATE activities SET superseded_by = NULL WHERE id = ANY($1::uuid[])`, [toClear])
  }
}

/**
 * Backfill supersession for every day that contains activities for this user.
 * Intended as a one-off migration after the column is introduced, but safe to
 * re-run at any time — it calls `materializeSuperseded` per day.
 */
export const backfillSuperseded = async (user: string): Promise<{ days: number }> => {
  const result = await query(
    user,
    `SELECT DISTINCT date_trunc('day', start_time AT TIME ZONE 'UTC') AS day
       FROM activities
      WHERE deleted_at IS NULL
      ORDER BY day`,
  )
  let days = 0
  for (const row of result.rows) {
    const day = row.day as Date
    // Materialize at noon UTC so ±12h covers the full day.
    const noon = new Date(day.getTime() + 12 * 60 * 60 * 1000)
    await materializeSuperseded(user, noon)
    days++
  }
  return { days }
}

const REMATERIALIZE_MARKER = 'rematerialize_superseded_v1'

/**
 * #1490 changed which touching same-type sessions merge, and marks materialized under the old rule
 * stay until a write in their window re-materializes it. Runs `backfillSuperseded` once per user,
 * recorded in `schema_migrations`. Not part of `migrateSchema`, whose fingerprint gate would skip it
 * on databases already current; the marker is written only after a full backfill, so a failed run is
 * retried by the next caller.
 */
export const rematerializeSupersededOnce = async (
  user: string,
): Promise<{ days: number; skipped: boolean }> => {
  await ensureSchemaMigrationsTable(await getDbForUser(user))
  const applied = await query(user, `SELECT 1 FROM schema_migrations WHERE name = $1`, [REMATERIALIZE_MARKER])
  if (applied.rows.length > 0) return { days: 0, skipped: true }

  const { days } = await backfillSuperseded(user)
  await query(user, `INSERT INTO schema_migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [
    REMATERIALIZE_MARKER,
  ])
  return { days, skipped: false }
}
