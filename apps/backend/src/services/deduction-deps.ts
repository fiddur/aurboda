import type { DeductionEngineDeps, EvaluationWindow, TimeRange } from './deduction-engine.ts'

import { query } from '../db/connection.ts'
/**
 * Default dependencies for the deduction engine, wired to real DB functions.
 */
import { deleteStaleRuleActivities, insertActivity, insertDeductionRuleRun } from '../db/index.ts'

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

export const createDefaultEngineDeps = (): DeductionEngineDeps => ({
  deleteStaleRuleActivities,
  getActivities,
  getScreentime,
  getTags,
  insertActivity,
  insertRuleRun: insertDeductionRuleRun,
})
