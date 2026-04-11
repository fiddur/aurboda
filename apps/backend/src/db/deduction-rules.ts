/**
 * Deduction rule CRUD operations.
 */
import type { Condition, DeductionRule, DeductionRuleMode } from '@aurboda/api-spec'

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
  ...(row.output_data != null ? { output_data: row.output_data as Record<string, unknown> } : {}),
  ...(row.output_title != null ? { output_title: row.output_title as string } : {}),
  priority: row.priority as number,
})

const SELECT_COLS =
  'id, name, enabled, priority, conditions, output_activity_type, output_title, merge_gap_seconds, mode, output_data, created_at'

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
  user: string,
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
  },
): Promise<DeductionRule> => {
  const result = await query(
    user,
    `INSERT INTO deduction_rules (name, enabled, priority, conditions, output_activity_type, output_title, merge_gap_seconds, mode, output_data)
     VALUES ($1, COALESCE($2, true), COALESCE($3, 0), $4, $5, $6, $7, COALESCE($8, 'create'), $9)
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
    ],
  )
  return mapRow(result.rows[0])
}

export const updateDeductionRule = async (
  user: string,
  id: string,
  updates: {
    name?: string
    enabled?: boolean
    priority?: number
    conditions?: Condition[]
    output_activity_type?: string
    output_title?: string | null
    merge_gap_seconds?: number | null
    mode?: DeductionRuleMode
    output_data?: Record<string, unknown> | null
  },
): Promise<DeductionRule | null> => {
  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  if (updates.name !== undefined) {
    setClauses.push(`name = $${paramIndex++}`)
    values.push(updates.name)
  }
  if (updates.enabled !== undefined) {
    setClauses.push(`enabled = $${paramIndex++}`)
    values.push(updates.enabled)
  }
  if (updates.priority !== undefined) {
    setClauses.push(`priority = $${paramIndex++}`)
    values.push(updates.priority)
  }
  if (updates.conditions !== undefined) {
    setClauses.push(`conditions = $${paramIndex++}`)
    values.push(JSON.stringify(updates.conditions))
  }
  if (updates.output_activity_type !== undefined) {
    setClauses.push(`output_activity_type = $${paramIndex++}`)
    values.push(updates.output_activity_type)
  }
  if (updates.output_title !== undefined) {
    setClauses.push(`output_title = $${paramIndex++}`)
    values.push(updates.output_title)
  }
  if (updates.merge_gap_seconds !== undefined) {
    setClauses.push(`merge_gap_seconds = $${paramIndex++}`)
    values.push(updates.merge_gap_seconds)
  }
  if (updates.mode !== undefined) {
    setClauses.push(`mode = $${paramIndex++}`)
    values.push(updates.mode)
  }
  if (updates.output_data !== undefined) {
    setClauses.push(`output_data = $${paramIndex++}`)
    values.push(updates.output_data ? JSON.stringify(updates.output_data) : null)
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

export const deleteDeductionRule = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM deduction_rules WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/**
 * Delete all activities produced by a specific deduction rule.
 * Used when re-evaluating a rule retroactively.
 */
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

/**
 * Insert a deduction rule run audit record.
 */
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
