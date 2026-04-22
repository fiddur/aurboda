import type { DeductionEngineDeps, EvaluationWindow, TimeRange } from './deduction-engine.ts'
import type { ActivityNotifier } from './deduction-queue.ts'

import { query } from '../db/connection.ts'
/**
 * Default dependencies for the deduction engine, wired to real DB functions.
 */
import {
  deleteStaleRuleActivities,
  expandActivityTypes,
  insertActivity as dbInsertActivity,
  insertDeductionRuleRun,
} from '../db/index.ts'
import { getPlaceVisits } from './locations.ts'

const getActivities = async (
  user: string,
  activityType: string,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const types = await expandActivityTypes(user, [activityType])
  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = ANY($1)
       AND deleted_at IS NULL
       AND start_time < $3
       AND (end_time > $2 OR end_time IS NULL)
     ORDER BY start_time`,
    [types, window.start, window.end],
  )
  return result.rows.map((r) => ({
    end: (r.end_time as Date) ?? new Date((r.start_time as Date).getTime() + 60 * 60 * 1000),
    start: r.start_time as Date,
  }))
}

const getScreentime = async (
  user: string,
  category: string[],
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  // Read from the screentime activities populated by the sync/backfill
  // pipeline. Category hierarchy is matched via path-prefix on the joined
  // string: `category=['Work']` matches activities whose category_path is
  // 'Work' or begins with 'Work > '. This is safer than the old
  // productivity.resolved_category @> array-containment check, which could
  // accidentally match records where the category appeared mid-path.
  const categoryPath = category.join(' > ')
  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = 'screentime'
       AND deleted_at IS NULL
       AND superseded_by IS NULL
       AND end_time IS NOT NULL
       AND start_time < $3
       AND end_time > $2
       AND (
         data->>'category_path' = $1
         OR starts_with(data->>'category_path', $1 || ' > ')
       )
     ORDER BY start_time`,
    [categoryPath, window.start, window.end],
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

  const types = await expandActivityTypes(user, [activityType])
  let whereClause: string
  const params: unknown[] = [types, window.start, window.end]

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
     WHERE activity_type = ANY($1)
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

const getActivitiesWithDataFilters = async (
  user: string,
  activityType: string,
  filters: Array<{ field: string; operator: string; value?: string | number | boolean }>,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const types = await expandActivityTypes(user, [activityType])
  const params: unknown[] = [types, window.start, window.end]
  const whereClauses: string[] = []

  for (const filter of filters) {
    if (!/^[a-z][a-z0-9_]*$/.test(filter.field)) return []

    switch (filter.operator) {
      case 'eq':
        whereClauses.push(`AND data->>'${filter.field}' = $${params.length + 1}`)
        params.push(String(filter.value))
        break
      case 'neq':
        whereClauses.push(
          `AND (data->>'${filter.field}' IS NULL OR data->>'${filter.field}' != $${params.length + 1})`,
        )
        params.push(String(filter.value))
        break
      case 'exists':
        whereClauses.push(`AND data ? '${filter.field}'`)
        break
      case 'not_exists':
        whereClauses.push(`AND (data IS NULL OR NOT data ? '${filter.field}')`)
        break
    }
  }

  const result = await query(
    user,
    `SELECT start_time, end_time FROM activities
     WHERE activity_type = ANY($1)
       AND deleted_at IS NULL
       AND start_time < $3
       AND (end_time > $2 OR end_time IS NULL)
       ${whereClauses.join(' ')}
     ORDER BY start_time`,
    params,
  )
  return result.rows.map((r) => ({
    end: (r.end_time as Date) ?? new Date((r.start_time as Date).getTime() + 60 * 60 * 1000),
    start: r.start_time as Date,
  }))
}

const getScrobbles = async (
  user: string,
  artist: string[] | undefined,
  track: string | undefined,
  matchMode: 'exact' | 'contains',
  durationSeconds: number,
  window: EvaluationWindow,
): Promise<TimeRange[]> => {
  const params: unknown[] = [window.start, window.end]
  const whereClauses: string[] = [
    `source = 'lastfm'`,
    `record_type = 'scrobble'`,
    `recorded_at >= $1`,
    `recorded_at < $2`,
  ]

  const escapeLike = (s: string) => s.replaceAll('%', '\\%').replaceAll('_', '\\_')

  if (artist && artist.length > 0) {
    if (matchMode === 'exact') {
      params.push(artist.map((a) => a.toLowerCase().trim()))
      whereClauses.push(`LOWER(data->>'artist') = ANY($${params.length})`)
    } else {
      const artistClauses = artist.map((a) => {
        params.push(`%${escapeLike(a.toLowerCase().trim())}%`)
        return `LOWER(data->>'artist') LIKE $${params.length}`
      })
      whereClauses.push(`(${artistClauses.join(' OR ')})`)
    }
  }

  if (track) {
    if (matchMode === 'exact') {
      params.push(track.toLowerCase().trim())
      whereClauses.push(`LOWER(data->>'track') = $${params.length}`)
    } else {
      params.push(`%${escapeLike(track.toLowerCase().trim())}%`)
      whereClauses.push(`LOWER(data->>'track') LIKE $${params.length}`)
    }
  }

  const result = await query(
    user,
    `SELECT recorded_at FROM raw_records
     WHERE ${whereClauses.join(' AND ')}
     ORDER BY recorded_at ASC`,
    params,
  )

  const durationMs = durationSeconds * 1000
  return result.rows.map((r) => ({
    end: new Date((r.recorded_at as Date).getTime() + durationMs),
    start: r.recorded_at as Date,
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

      // Track enrichment provenance (just the ID — name resolved at query time)
      patch._enriched_by = ruleId

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

export const createDefaultEngineDeps = (notifier?: ActivityNotifier): DeductionEngineDeps => ({
  deleteStaleRuleActivities,
  enrichActivities,
  getActivities,
  getActivitiesWithData,
  getActivitiesWithDataFilters,
  getEarliestActivityTime,
  getLocationVisits,
  getScrobbles,
  getScreentime,
  insertActivity: async (user, activity) => {
    const id = await dbInsertActivity(user, activity)
    if (notifier) {
      const ruleId = (activity.data as Record<string, unknown> | undefined)?.rule_id as string | undefined
      notifier(
        user,
        activity.activity_type,
        activity.start_time,
        activity.end_time ?? activity.start_time,
        ruleId,
      )
    }
    return id
  },
  insertRuleRun: insertDeductionRuleRun,
})
