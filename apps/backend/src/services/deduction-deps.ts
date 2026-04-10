import type { DeductionEngineDeps, EvaluationWindow, TimeRange } from './deduction-engine.ts'

import { query } from '../db/connection.ts'
/**
 * Default dependencies for the deduction engine, wired to real DB functions.
 */
import { deleteStaleRuleActivities, insertActivity, insertDeductionRuleRun } from '../db/index.ts'
import { getPlaceVisits } from './locations.ts'

const getActivities = async (
  user: string,
  activityType: string,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time < $3
       AND (end_time > $2 OR end_time IS NULL)
     ORDER BY start_time`,
    [activityType, window.start, window.end],
  )
  return result.rows.map((r) => ({
    end: (r.end_time as Date) ?? new Date((r.start_time as Date).getTime() + 60 * 60 * 1000),
    start: r.start_time as Date,
  }))
}

const getTags = async (user: string, tagName: string, window: EvaluationWindow): Promise<TimeRange[]> => {
  // Tags have been absorbed into activities — query activities table instead
  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time < $3
       AND (end_time > $2 OR end_time IS NULL)
     ORDER BY start_time`,
    [tagName, window.start, window.end],
  )
  return result.rows.map((r) => ({
    end: (r.end_time as Date) ?? new Date((r.start_time as Date).getTime() + 60 * 1000),
    start: r.start_time as Date,
  }))
}

const getScreentime = async (
  user: string,
  category: string[],
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const result = await query(
    user,
    `SELECT start_time, end_time FROM productivity
     WHERE resolved_category @> $1
       AND deleted_at IS NULL
       AND start_time < $3
       AND end_time > $2
     ORDER BY start_time`,
    [category, window.start, window.end],
  )
  return result.rows.map((r) => ({
    end: r.end_time as Date,
    start: r.start_time as Date,
  }))
}

const getActivitiesWithData = async (
  user: string,
  activityType: string,
  field: string,
  operator: string,
  value: string | number | boolean | undefined,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  // Sanitize field name to prevent injection (only allow snake_case identifiers)
  if (!/^[a-z][a-z0-9_]*$/.test(field)) return []

  let whereClause: string
  const params: unknown[] = [activityType, window.start, window.end]

  switch (operator) {
    case 'eq':
      whereClause = `AND data->>'${field}' = $4`
      params.push(String(value))
      break
    case 'neq':
      whereClause = `AND (data->>'${field}' IS NULL OR data->>'${field}' != $4)`
      params.push(String(value))
      break
    case 'exists':
      whereClause = `AND data ? '${field}'`
      break
    case 'not_exists':
      whereClause = `AND (data IS NULL OR NOT data ? '${field}')`
      break
    default:
      return []
  }

  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time < $3
       AND (end_time > $2 OR end_time IS NULL)
       ${whereClause}
     ORDER BY start_time`,
    params,
  )
  return result.rows.map((r) => ({
    end: (r.end_time as Date) ?? new Date((r.start_time as Date).getTime() + 60 * 60 * 1000),
    start: r.start_time as Date,
  }))
}

const getLocationVisits = async (
  user: string,
  locationName: string,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const visits = await getPlaceVisits(user, window.start, window.end)
  return visits.filter((v) => v.name === locationName).map((v) => ({ end: v.end_time, start: v.start_time }))
}

const enrichActivities = async (
  user: string,
  activityType: string,
  ranges: TimeRange[],
  data: Record<string, unknown>,
  ruleId: string,
  ruleName: string,
): Promise<string[]> => {
  if (ranges.length === 0 || Object.keys(data).length === 0) return []

  // Find activities of the target type overlapping any of the ranges
  const enrichedIds: string[] = []

  for (const range of ranges) {
    const result = await query(
      user,
      `SELECT id, data FROM activities
       WHERE activity_type = $1
         AND deleted_at IS NULL
         AND start_time < $3
         AND (end_time > $2 OR end_time IS NULL)
       ORDER BY start_time`,
      [activityType, range.start, range.end],
    )

    for (const row of result.rows) {
      const activityId = row.id as string
      const existingData = (row.data as Record<string, unknown>) ?? {}

      // Only merge keys that are missing (null/undefined) in existing data
      const patch: Record<string, unknown> = {}
      for (const [key, val] of Object.entries(data)) {
        if (existingData[key] === undefined || existingData[key] === null) {
          patch[key] = val
        }
      }

      if (Object.keys(patch).length === 0) continue

      // Track enrichment provenance
      patch._enriched_by = { rule_id: ruleId, rule_name: ruleName }

      await query(
        user,
        `UPDATE activities SET data = COALESCE(data, '{}'::jsonb) || $2::jsonb WHERE id = $1`,
        [activityId, JSON.stringify(patch)],
      )
      enrichedIds.push(activityId)
    }
  }

  return enrichedIds
}

const getEarliestActivityTime = async (user: string): Promise<Date | null> => {
  const result = await query(
    user,
    `SELECT MIN(start_time) AS earliest FROM activities WHERE deleted_at IS NULL`,
  )
  return (result.rows[0]?.earliest as Date) ?? null
}

export const createDefaultEngineDeps = (): DeductionEngineDeps => ({
  deleteStaleRuleActivities,
  enrichActivities,
  getActivities,
  getActivitiesWithData,
  getEarliestActivityTime,
  getLocationVisits,
  getScreentime,
  getTags,
  insertActivity,
  insertRuleRun: insertDeductionRuleRun,
})
