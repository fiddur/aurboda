/**
 * Activity read operations. Uses pure merge logic from `./merge.ts` to collapse
 * cross-source and same-type duplicates at query time.
 */
import type { ActivityType } from '../../schema.ts'
import type { Activity, MergedActivity } from '../types.ts'

import { query } from '../connection.ts'
import { mapActivityRow } from '../row-mappers.ts'
import { findMergedGroupForActivity, mergeOverlappingActivities } from './merge.ts'

/**
 * SELECT column list for an activities row. The `override_target_ids` is
 * built from the `activity_override_targets` join table via a correlated
 * subquery; NULL when the row has no targets and is normalised to
 * `undefined` by the row mapper.
 *
 * `alias` defaults to the unqualified table name; pass `'a'` (or any other
 * alias) when joining.
 */
export const activityColumns = (alias: string = 'activities'): string =>
  `${alias}.id, ${alias}.source, ${alias}.external_id, ${alias}.activity_type, ${alias}.start_time, ${alias}.end_time, ${alias}.title, ${alias}.notes, ${alias}.data, ${alias}.deleted_at, ${alias}.superseded_by,
  (SELECT array_agg(target_id) FROM activity_override_targets WHERE override_id = ${alias}.id) AS override_target_ids`

const ACTIVITY_COLUMNS_BARE = activityColumns()
const ACTIVITY_COLUMNS_ALIAS = activityColumns('a')

/**
 * Find all non-deleted activities of the same type that belong to the same merge group
 * as the given activity. Uses transitive merge logic (via mergeOverlappingActivities +
 * findMergedGroupForActivity) to guarantee consistency with the day view.
 *
 * Queries a wide time window (activity's day +/- 12h) and runs the merge algorithm
 * to find the full transitive chain.
 */
export const getOverlappingActivities = async (user: string, activity: Activity): Promise<Activity[]> => {
  // Query a wide window around the activity to catch all transitively-connected activities
  const activityTime = activity.start_time.getTime()
  const windowStart = new Date(activityTime - 12 * 60 * 60 * 1000)
  const windowEnd = new Date(activityTime + 24 * 60 * 60 * 1000)

  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time >= $2
       AND start_time <= $3
     ORDER BY start_time`,
    [activity.activity_type, windowStart, windowEnd],
  )

  const rawActivities = result.rows.map(mapActivityRow)
  const merged = mergeOverlappingActivities(rawActivities)

  return findMergedGroupForActivity(merged, rawActivities, activity.id!)
}

export const getActivityById = async (
  user: string,
  id: string,
  includeDeleted = false,
): Promise<Activity | null> => {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE id = $1${deletedClause}`,
    [id],
  )

  if (result.rows.length === 0) {
    return null
  }

  return mapActivityRow(result.rows[0])
}

/**
 * Fetch the `source` for each given activity id (deleted rows included).
 * Lightweight lookup used by services to validate override-target shape
 * before insert. Returns rows in arbitrary order; missing ids are simply
 * absent from the result.
 */
export const getActivitySourcesByIds = async (
  user: string,
  ids: readonly string[],
): Promise<{ id: string; source: string }[]> => {
  if (ids.length === 0) return []
  const result = await query<{ id: string; source: string }>(
    user,
    `SELECT id, source FROM activities WHERE id = ANY($1)`,
    [ids],
  )
  return result.rows
}

/**
 * Find the active aurboda override row that targets the given synced
 * activity, if any. Used by updateActivity to update an existing override in
 * place instead of creating duplicates.
 */
export const getOverrideForActivity = async (user: string, targetId: string): Promise<Activity | null> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE id = (SELECT override_id FROM activity_override_targets WHERE target_id = $1 LIMIT 1)
       AND deleted_at IS NULL
     LIMIT 1`,
    [targetId],
  )
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
}

export const getActivities = async (
  user: string,
  activityType: ActivityType | ActivityType[],
  start: Date,
  end: Date,
  dataFilters?: Array<{ field: string; value: string | null }>,
  deductionRuleId?: string,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const types = Array.isArray(activityType) ? activityType : [activityType]
  const params: unknown[] = [types, start, end]

  let filterClauses = ''
  if (dataFilters?.length) {
    for (const filter of dataFilters) {
      if (!/^[a-z][a-z0-9_]*$/.test(filter.field)) continue
      if (filter.value === null) {
        filterClauses += `\n       AND (data->>'${filter.field}' IS NULL OR data->>'${filter.field}' = '')`
      } else {
        params.push(filter.value)
        filterClauses += `\n       AND data->>'${filter.field}' = $${params.length}`
      }
    }
  }

  if (deductionRuleId) {
    params.push(deductionRuleId)
    filterClauses += `\n       AND (data->>'rule_id' = $${params.length} OR data->>'_enriched_by' = $${params.length})`
  }

  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = ANY($1) AND start_time >= $2 AND start_time <= $3
       AND deleted_at IS NULL${filterClauses}
     ORDER BY start_time`,
    params,
  )

  const activities = result.rows.map(mapActivityRow)

  return mergeOverlappingActivities(activities, categoryMap)
}

/**
 * Get sleep sessions that overlap with a date range.
 * Uses date overlap logic so overnight sleep (starting 11pm, ending 7am)
 * appears on the wake-up day rather than the start day.
 */
export const getSleepSessions = async (user: string, start: Date, end: Date): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = 'sleep'
       AND start_time < $2
       AND (end_time >= $1 OR end_time IS NULL)
       AND deleted_at IS NULL
     ORDER BY start_time`,
    [start, end],
  )

  const activities = result.rows.map(mapActivityRow)

  return mergeOverlappingActivities(activities)
}

/**
 * Get activities that have a garmin_activity_id but haven't had their
 * per-second detail data synced yet. Includes merged activities (source may be
 * 'health_connect' or 'aurboda' after merging).
 */
export const getActivitiesNeedingDetail = async (
  user: string,
  { forceAll = false, limit = 10 }: { forceAll?: boolean; limit?: number } = {},
): Promise<Activity[]> => {
  const detailFilter = forceAll ? '' : "AND (a.data->>'detail_synced') IS NULL"
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_ALIAS}
     FROM activities a
     JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE atd.display_category IN ('exercise', 'meditation')
       AND a.data->>'garmin_activity_id' IS NOT NULL
       ${detailFilter}
       AND a.deleted_at IS NULL
     ORDER BY a.start_time DESC
     LIMIT $1`,
    [limit],
  )

  return result.rows.map(mapActivityRow)
}

/**
 * Find nearby same-type activities for merge suggestions.
 * Returns non-deleted activities of the same type within ±hoursWindow of the given time range,
 * excluding the given activity ID.
 */
export const getNearbyActivities = async (
  user: string,
  activityId: string,
  activityType: string,
  startTime: Date,
  endTime: Date | undefined,
  hoursWindow: number,
): Promise<Activity[]> => {
  const windowMs = hoursWindow * 60 * 60 * 1000
  const windowStart = new Date(startTime.getTime() - windowMs)
  const windowEnd = new Date((endTime ?? startTime).getTime() + windowMs)

  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = $1
       AND id != $2
       AND deleted_at IS NULL
       AND start_time >= $3
       AND start_time <= $4
     ORDER BY start_time`,
    [activityType, activityId, windowStart, windowEnd],
  )

  return result.rows.map(mapActivityRow)
}

/**
 * Check if an activity with the same (source, activity_type, start_time) already exists,
 * excluding the given activity ID. Used to preemptively detect unique constraint violations
 * before changing an activity's type.
 */
export const checkActivityConflict = async (
  user: string,
  source: string,
  activityType: string,
  startTime: Date,
  excludeId: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `SELECT 1 FROM activities
     WHERE source = $1 AND activity_type = $2 AND start_time = $3
       AND id != $4 AND deleted_at IS NULL
     LIMIT 1`,
    [source, activityType, startTime, excludeId],
  )
  return result.rows.length > 0
}

/** Get activities by display category (e.g., 'exercise' gets all exercise types). */
export const getActivitiesByCategory = async (
  user: string,
  displayCategory: string,
  start: Date,
  end: Date,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_ALIAS}
     FROM activities a
     JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE atd.display_category = $1 AND a.start_time >= $2 AND a.start_time <= $3
       AND a.deleted_at IS NULL
     ORDER BY a.start_time`,
    [displayCategory, start, end],
  )
  const activities = result.rows.map(mapActivityRow)
  return mergeOverlappingActivities(activities, categoryMap)
}

/**
 * Get all distinct activity_type values from the activities table.
 * Unlike getActivityTypeNames (which reads from definitions), this reads actual data.
 */
export const getAllActivityTypeNames = async (user: string): Promise<string[]> => {
  const result = await query(
    user,
    `SELECT DISTINCT activity_type FROM activities WHERE deleted_at IS NULL ORDER BY activity_type`,
  )
  return result.rows.map((r) => r.activity_type as string)
}

/**
 * Get activities whose type definition is NOT in the given display categories.
 * Used to get "tag-like" activities (everything except sleep/exercise).
 */
export const getActivitiesExcludingCategories = async (
  user: string,
  excludeCategories: string[],
  start: Date,
  end: Date,
): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_ALIAS}
     FROM activities a
     LEFT JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE a.deleted_at IS NULL
       AND a.start_time >= $1 AND a.start_time <= $2
       AND (atd.display_category IS NULL OR atd.display_category != ALL($3))
     ORDER BY a.start_time`,
    [start, end, excludeCategories],
  )
  return result.rows.map(mapActivityRow)
}

/**
 * Get all non-sleep activities for a time range, with overlapping same-type activities merged.
 * Used by the daily summary to build a unified activity timeline.
 *
 * Activity types flagged `show_on_timeline = false` (music scrobbles, screentime,
 * location visits) are excluded — they're high-volume, low-signal-per-row and
 * have their own dedicated tracks/summaries.
 */
export const getNonSleepActivitiesMerged = async (
  user: string,
  start: Date,
  end: Date,
  categoryMap?: Map<string, string>,
): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_ALIAS}
     FROM activities a
     LEFT JOIN activity_type_definitions atd ON a.activity_type = atd.name
     WHERE a.deleted_at IS NULL
       AND a.start_time >= $1 AND a.start_time <= $2
       AND (atd.display_category IS NULL OR atd.display_category != 'sleep_rest')
       AND COALESCE(atd.show_on_timeline, TRUE) = TRUE
     ORDER BY a.start_time`,
    [start, end],
  )
  const activities = result.rows.map(mapActivityRow)
  return mergeOverlappingActivities(activities, categoryMap)
}

/** Get screentime activities for a date range, unmerged (each span is a separate record). */
export const getScreentimeActivities = async (user: string, start: Date, end: Date): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = 'screentime'
       AND deleted_at IS NULL
       AND start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )
  return result.rows.map(mapActivityRow)
}

/** Get all activities in a date range (all types, unmerged individual records). */
export const getAllActivitiesInRange = async (user: string, start: Date, end: Date): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities WHERE deleted_at IS NULL AND start_time >= $1 AND start_time <= $2
     ORDER BY start_time`,
    [start, end],
  )
  return result.rows.map(mapActivityRow)
}

/** Find a mergeable activity of the same type near a given time.
 *  When matchData is provided, only matches activities whose data contains all the same key-value pairs. */
export const findMergeableActivity = async (
  user: string,
  activityType: string,
  startTime: Date,
  mergeSpanSeconds: number,
  source?: string,
  matchData?: Record<string, unknown>,
): Promise<Activity | null> => {
  const windowStart = new Date(startTime.getTime() - mergeSpanSeconds * 1000)
  const params: unknown[] = [activityType, windowStart, startTime]
  let nextParam = 4

  const clauses: string[] = []
  if (source) {
    clauses.push(`AND source = $${nextParam++}`)
    params.push(source)
  }
  if (matchData && Object.keys(matchData).length > 0) {
    clauses.push(`AND data @> $${nextParam++}::jsonb`)
    params.push(JSON.stringify(matchData))
  }

  const result = await query(
    user,
    `SELECT ${ACTIVITY_COLUMNS_BARE}
     FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND (
         (end_time IS NOT NULL AND end_time >= $2 AND end_time <= $3)
         OR (end_time IS NULL AND start_time >= $2 AND start_time <= $3)
       )${clauses.join(' ')}
     ORDER BY COALESCE(end_time, start_time) DESC
     LIMIT 1`,
    params,
  )
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
}
