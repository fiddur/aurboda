/**
 * Auto-share rules (#903): CRUD for the per-user rules that automatically
 * publish a settled activity to the federated feed, plus the candidate query
 * the evaluation worker runs over a mutation window.
 *
 * Rules are created DISABLED; flipping `enabled` to true stamps `enabled_at`,
 * and evaluation only ever considers activities INGESTED after that stamp — so
 * enabling a rule never retroactively shares history.
 */
import type { FeedVisibility } from '@aurboda/api-spec'

import { query } from './connection.ts'

export interface AutoshareRuleRecord {
  id: string
  name: string
  enabled: boolean
  enabled_at: Date | null
  /** Activity types the rule matches; empty matches any. */
  activity_types: string[]
  min_duration_seconds: number | null
  max_duration_seconds: number | null
  min_distance_meters: number | null
  source: string | null
  included_metrics: string[]
  series_metrics: string[]
  include_chart: boolean
  include_map: boolean
  visibility: FeedVisibility
  /** Fixed personal message for auto-created posts, or null for none. */
  message: string | null
  created_at: Date
  updated_at: Date
}

export interface AutoshareRuleInput {
  name: string
  activity_types: string[]
  min_duration_seconds?: number | null
  max_duration_seconds?: number | null
  min_distance_meters?: number | null
  source?: string | null
  included_metrics: string[]
  series_metrics: string[]
  include_chart: boolean
  include_map: boolean
  visibility: FeedVisibility
  message?: string | null
}

export interface AutoshareRulePatch {
  name?: string
  enabled?: boolean
  activity_types?: string[]
  min_duration_seconds?: number | null
  max_duration_seconds?: number | null
  min_distance_meters?: number | null
  source?: string | null
  included_metrics?: string[]
  series_metrics?: string[]
  include_chart?: boolean
  include_map?: boolean
  visibility?: FeedVisibility
  message?: string | null
}

const COLS =
  'id, name, enabled, enabled_at, activity_types, min_duration_seconds, max_duration_seconds, min_distance_meters, source, included_metrics, series_metrics, include_chart, include_map, visibility, message, created_at, updated_at'

export const getAutoshareRules = async (user: string): Promise<AutoshareRuleRecord[]> => {
  const result = await query<AutoshareRuleRecord>(
    user,
    `SELECT ${COLS} FROM autoshare_rules ORDER BY created_at ASC, id ASC`,
  )
  return result.rows
}

export const getEnabledAutoshareRules = async (user: string): Promise<AutoshareRuleRecord[]> => {
  const result = await query<AutoshareRuleRecord>(
    user,
    `SELECT ${COLS} FROM autoshare_rules WHERE enabled ORDER BY created_at ASC, id ASC`,
  )
  return result.rows
}

/** Rules are always created DISABLED — enabling is a separate deliberate update. */
export const insertAutoshareRule = async (
  user: string,
  input: AutoshareRuleInput,
): Promise<AutoshareRuleRecord> => {
  const result = await query<AutoshareRuleRecord>(
    user,
    `INSERT INTO autoshare_rules
       (name, activity_types, min_duration_seconds, max_duration_seconds, min_distance_meters, source,
        included_metrics, series_metrics, include_chart, include_map, visibility, message)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING ${COLS}`,
    [
      input.name,
      input.activity_types,
      input.min_duration_seconds ?? null,
      input.max_duration_seconds ?? null,
      input.min_distance_meters ?? null,
      input.source ?? null,
      input.included_metrics,
      input.series_metrics,
      input.include_chart,
      input.include_map,
      input.visibility,
      input.message ?? null,
    ],
  )
  return result.rows[0]
}

/**
 * Patch a rule. Flipping `enabled` to true stamps `enabled_at = NOW()` (the
 * no-retroactive-sharing gate); disabling leaves the old stamp in place so a
 * disable/enable cycle moves the gate forward, never backwards.
 */
/** The directly patchable columns, in a fixed order (column name = patch key). */
const PATCH_COLUMNS = [
  'name',
  'enabled',
  'activity_types',
  'min_duration_seconds',
  'max_duration_seconds',
  'min_distance_meters',
  'source',
  'included_metrics',
  'series_metrics',
  'include_chart',
  'include_map',
  'visibility',
  'message',
] as const

export const updateAutoshareRule = async (
  user: string,
  id: string,
  patch: AutoshareRulePatch,
): Promise<AutoshareRuleRecord | null> => {
  const sets: string[] = ['updated_at = NOW()']
  const params: unknown[] = [id]
  for (const column of PATCH_COLUMNS) {
    const value = patch[column]
    if (value === undefined) continue
    params.push(value)
    sets.push(`${column} = $${params.length}`)
  }
  // Flipping enabled ON stamps the no-retroactive-sharing gate.
  if (patch.enabled === true) sets.push('enabled_at = NOW()')

  const result = await query<AutoshareRuleRecord>(
    user,
    `UPDATE autoshare_rules SET ${sets.join(', ')} WHERE id = $1 RETURNING ${COLS}`,
    params,
  )
  return result.rows.length ? result.rows[0] : null
}

export const deleteAutoshareRule = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM autoshare_rules WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/** How many feed posts each rule has auto-created (the "recently auto-shared" trail's counts). */
export const countAutosharePostsByRule = async (user: string): Promise<Record<string, number>> => {
  const result = await query<{ autoshare_rule_id: string; count: string }>(
    user,
    `SELECT autoshare_rule_id, COUNT(*) AS count FROM feed_posts
     WHERE autoshare_rule_id IS NOT NULL GROUP BY autoshare_rule_id`,
  )
  return Object.fromEntries(result.rows.map((row) => [row.autoshare_rule_id, Number(row.count)]))
}

/** The fields the auto-share evaluator needs from a candidate activity. */
export interface AutoshareCandidate {
  id: string
  activity_type: string
  source: string | null
  start_time: Date
  end_time: Date
  title: string | null
  /** When the row was INGESTED (not when the activity happened) — gates `enabled_at`. */
  created_at: Date
}

/**
 * Settled candidates for auto-sharing in a mutation window: non-deleted,
 * non-superseded, bounded activities (an open activity has no shareable window
 * yet). `superseded_by IS NULL` matters: cross-source/override merge groups are
 * CROSS-TYPE, so the same-type `getOverlappingActivities` grouping would see
 * the winner and the superseded row as two independent groups and publish two
 * posts for one physical session — filtering to winners (the same predicate the
 * chart/trend/deduction queries use) keeps one candidate per session.
 */
export const listAutoshareCandidates = async (
  user: string,
  start: Date,
  end: Date,
): Promise<AutoshareCandidate[]> => {
  const result = await query<AutoshareCandidate>(
    user,
    `SELECT id, activity_type, source, start_time, end_time, title, created_at
     FROM activities
     WHERE deleted_at IS NULL AND superseded_by IS NULL AND end_time IS NOT NULL
       AND start_time <= $2 AND end_time >= $1
     ORDER BY start_time ASC`,
    [start, end],
  )
  return result.rows
}

/** Ingest timestamps for a set of activity rows (gates `enabled_at` for merge-group anchors). */
export const getActivityIngestTimes = async (user: string, ids: string[]): Promise<Record<string, Date>> => {
  if (ids.length === 0) return {}
  const result = await query<{ id: string; created_at: Date }>(
    user,
    `SELECT id, created_at FROM activities WHERE id = ANY($1)`,
    [ids],
  )
  return Object.fromEntries(result.rows.map((row) => [row.id, row.created_at]))
}

/**
 * Which of the given activities are SUPPRESSED for auto-sharing: their feed
 * post was deleted by the user (#903). Recorded by `deleteFeedPost`, so the
 * dedupe survives the post row's hard delete.
 */
export const listAutoshareSuppressedIds = async (user: string, ids: string[]): Promise<string[]> => {
  if (ids.length === 0) return []
  const result = await query<{ activity_id: string }>(
    user,
    `SELECT activity_id FROM autoshare_suppressions WHERE activity_id = ANY($1)`,
    [ids],
  )
  return result.rows.map((row) => row.activity_id)
}
