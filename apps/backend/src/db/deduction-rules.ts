import type { Condition, DeductionRule, DeductionRuleMode, OutputMediaField } from '@aurboda/api-spec'

import type { Queryable } from './pool.ts'

import { query } from './connection.ts'

const mapRow = (row: Record<string, unknown>): DeductionRule => ({
  conditions: row.conditions as Condition[],
  created_at: (row.created_at as Date)?.toISOString(),
  enabled: row.enabled as boolean,
  id: row.id as string,
  ...(row.merge_gap_seconds != null ? { merge_gap_seconds: row.merge_gap_seconds as number } : {}),
  ...(row.mode && row.mode !== 'create' ? { mode: row.mode as DeductionRuleMode } : {}),
  name: row.name as string,
  output_activity_type: row.output_activity_type as string,
  ...(row.output_category != null ? { output_category: row.output_category as string } : {}),
  ...(row.output_data != null ? { output_data: row.output_data as Record<string, unknown> } : {}),
  ...(row.output_media_field != null
    ? { output_media_field: row.output_media_field as OutputMediaField }
    : {}),
  ...(row.output_title != null ? { output_title: row.output_title as string } : {}),
  ...(row.output_title_field != null ? { output_title_field: row.output_title_field as string } : {}),
  priority: row.priority as number,
})

const SELECT_COLS =
  'id, name, enabled, priority, conditions, output_activity_type, output_title, merge_gap_seconds, mode, output_data, output_media_field, output_title_field, output_category, created_at'

export const getDeductionRules = async (user: string): Promise<DeductionRule[]> => {
  const result = await query(user, `SELECT ${SELECT_COLS} FROM deduction_rules ORDER BY priority, name`)
  return result.rows.map(mapRow)
}

export const getEnabledDeductionRules = async (user: string): Promise<DeductionRule[]> => {
  const result = await query(
    user,
    `SELECT ${SELECT_COLS} FROM deduction_rules WHERE enabled = true ORDER BY priority, name`,
  )
  return result.rows.map(mapRow)
}

export const getDeductionRule = async (user: string, id: string): Promise<DeductionRule | null> => {
  const result = await query(user, `SELECT ${SELECT_COLS} FROM deduction_rules WHERE id = $1`, [id])
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

export const getDeductionRulesByIds = async (user: string, ids: string[]): Promise<DeductionRule[]> => {
  if (ids.length === 0) return []
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await query(
    user,
    `SELECT ${SELECT_COLS} FROM deduction_rules WHERE id IN (${placeholders}) ORDER BY priority, name`,
    ids,
  )
  return result.rows.map(mapRow)
}

export const insertDeductionRule = async (
  db: Queryable | string,
  rule: {
    name: string
    conditions: Condition[]
    output_activity_type: string
    output_title?: string
    merge_gap_seconds?: number
    priority?: number
    enabled?: boolean
    mode?: DeductionRuleMode
    output_data?: Record<string, unknown>
    output_media_field?: OutputMediaField
    output_title_field?: string
    output_category?: string
  },
): Promise<DeductionRule> => {
  const result = await query(
    db,
    `INSERT INTO deduction_rules (name, enabled, priority, conditions, output_activity_type, output_title, merge_gap_seconds, mode, output_data, output_media_field, output_title_field, output_category)
     VALUES ($1, COALESCE($2, true), COALESCE($3, 0), $4, $5, $6, $7, COALESCE($8, 'create'), $9, $10, $11, $12)
     RETURNING ${SELECT_COLS}`,
    [
      rule.name,
      rule.enabled ?? null,
      rule.priority ?? null,
      JSON.stringify(rule.conditions),
      rule.output_activity_type,
      rule.output_title ?? null,
      rule.merge_gap_seconds ?? null,
      rule.mode ?? null,
      rule.output_data ? JSON.stringify(rule.output_data) : null,
      rule.output_media_field ? JSON.stringify(rule.output_media_field) : null,
      rule.output_title_field ?? null,
      rule.output_category ?? null,
    ],
  )
  return mapRow(result.rows[0])
}

interface DeductionRuleUpdates {
  name?: string
  enabled?: boolean
  priority?: number
  conditions?: Condition[]
  output_activity_type?: string
  output_title?: string | null
  merge_gap_seconds?: number | null
  mode?: DeductionRuleMode
  output_data?: Record<string, unknown> | null
  output_media_field?: OutputMediaField | null
  output_title_field?: string | null
  output_category?: string | null
}

const UPDATABLE_COLUMNS: { column: keyof DeductionRuleUpdates; json?: true }[] = [
  { column: 'name' },
  { column: 'enabled' },
  { column: 'priority' },
  { column: 'conditions', json: true },
  { column: 'output_activity_type' },
  { column: 'output_title' },
  { column: 'merge_gap_seconds' },
  { column: 'mode' },
  { column: 'output_data', json: true },
  { column: 'output_media_field', json: true },
  { column: 'output_title_field' },
  { column: 'output_category' },
]

export const updateDeductionRule = async (
  user: string,
  id: string,
  updates: DeductionRuleUpdates,
): Promise<DeductionRule | null> => {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const { column, json } of UPDATABLE_COLUMNS) {
    const value = updates[column]
    if (value === undefined) continue
    setClauses.push(`${column} = $${paramIndex++}`)
    values.push(json && value !== null ? JSON.stringify(value) : value)
  }
  if (setClauses.length === 0) return getDeductionRule(user, id)

  setClauses.push(`updated_at = NOW()`)
  values.push(id)

  const result = await query(
    user,
    `UPDATE deduction_rules SET ${setClauses.join(', ')} WHERE id = $${paramIndex}
     RETURNING ${SELECT_COLS}`,
    values,
  )
  if (result.rows.length === 0) return null
  return mapRow(result.rows[0])
}

/** Drops the rule's entries from every activity's data.run_categories; other entries stay. */
export const removeRuleCategoryEntries = async (user: string, ruleId: string): Promise<number> => {
  const result = await query(
    user,
    `UPDATE activities SET data = jsonb_set(data, '{run_categories}', COALESCE(
       (SELECT jsonb_agg(e.entry ORDER BY e.ord)
        FROM jsonb_array_elements(data->'run_categories') WITH ORDINALITY AS e(entry, ord)
        WHERE (e.entry->>'rule_id') IS DISTINCT FROM $1),
       '[]'::jsonb))
     WHERE jsonb_typeof(data->'run_categories') = 'array'
       AND data->'run_categories' @> jsonb_build_array(jsonb_build_object('rule_id', $1::text))`,
    [ruleId],
  )
  return result.rowCount ?? 0
}

/** Deleting a rule also takes back the run categories it gave; disabling one keeps them. */
export const deleteDeductionRule = async (user: string, id: string): Promise<boolean> => {
  await removeRuleCategoryEntries(user, id)
  const result = await query(user, `DELETE FROM deduction_rules WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/** Used when re-evaluating a rule retroactively. */
export const deleteRuleActivities = async (user: string, ruleId: string): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM activities WHERE source = 'deduction-rule' AND (data->>'rule_id') = $1`,
    [ruleId],
  )
  return result.rowCount ?? 0
}

/**
 * Delete stale activities produced by a rule within a time window,
 * keeping only the ones produced in the current evaluation.
 */
export const deleteStaleRuleActivities = async (
  user: string,
  ruleId: string,
  windowStart: Date,
  windowEnd: Date,
  keepIds: string[],
): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM activities
     WHERE source = 'deduction-rule'
       AND (data->>'rule_id') = $1
       AND start_time >= $2
       AND start_time <= $3
       ${keepIds.length > 0 ? `AND id != ALL($4::uuid[])` : ''}`,
    keepIds.length > 0 ? [ruleId, windowStart, windowEnd, keepIds] : [ruleId, windowStart, windowEnd],
  )
  return result.rowCount ?? 0
}

export const pruneDeductionRuleRuns = async (user: string, retentionDays: number): Promise<number> => {
  const result = await query(
    user,
    `DELETE FROM deduction_rule_runs WHERE evaluated_at < NOW() - INTERVAL '1 day' * $1`,
    [retentionDays],
  )
  return result.rowCount ?? 0
}

export const insertDeductionRuleRun = async (
  user: string,
  run: {
    rule_id: string
    window_start: Date
    window_end: Date
    activities_created: number
    duration_ms: number
  },
): Promise<void> => {
  await query(
    user,
    `INSERT INTO deduction_rule_runs (rule_id, window_start, window_end, activities_created, duration_ms)
     VALUES ($1, $2, $3, $4, $5)`,
    [run.rule_id, run.window_start, run.window_end, run.activities_created, run.duration_ms],
  )
}
