/**
 * Activity CRUD operations and merge logic.
 */
import format from 'pg-format'

import type { ActivityType } from '../schema.ts'
import type { Activity, ActivityUpdate, MergedActivity } from './types.ts'

import { query } from './connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update.ts'
import { mapActivityRow } from './row-mappers.ts'

/**
 * Merge overlapping activities of the same type.
 *
 * When the same activity is logged in multiple apps (e.g., Polar for HR data
 * and Gravl for workout details), this function merges them into a single
 * activity using the earliest start time and latest end time.
 *
 * Merge rules:
 * - Activities are grouped by activityType
 * - Activities overlap if: a1.endTime >= a2.startTime (or a1 has no endTime and a2 starts during a1's day)
 * - Merged activity uses: earliest startTime, latest endTime
 * - First activity's source and id are kept
 * - First non-empty title is used
 * - Notes are concatenated with newline
 * - Data objects are merged (later values override earlier for same keys)
 */
// eslint-disable-next-line complexity -- TODO: refactor
export const mergeOverlappingActivities = (activities: Activity[]): MergedActivity[] => {
  if (activities.length === 0) return []

  // Group by activity type
  const byType = new Map<string, Activity[]>()
  for (const a of activities) {
    const group = byType.get(a.activity_type) ?? []
    group.push(a)
    byType.set(a.activity_type, group)
  }

  const result: MergedActivity[] = []

  for (const [, typeActivities] of byType) {
    // Sort by start time
    const sorted = [...typeActivities].sort((a, b) => a.start_time.getTime() - b.start_time.getTime())

    let current: MergedActivity = { ...sorted[0] }
    let currentSourceIds: string[] = sorted[0].id ? [sorted[0].id] : []

    for (let i = 1; i < sorted.length; i++) {
      const next = sorted[i]
      const currentEnd = current.end_time?.getTime() ?? current.start_time.getTime()
      const nextStart = next.start_time.getTime()

      // Check if activities overlap or touch
      if (currentEnd >= nextStart) {
        // Merge: extend end time if needed
        const nextEnd = next.end_time?.getTime()
        if (
          nextEnd !== undefined &&
          (current.end_time === undefined || nextEnd > current.end_time.getTime())
        ) {
          current.end_time = next.end_time
        }

        // Use first non-empty title
        if (!current.title && next.title) {
          current.title = next.title
        }

        // Concatenate notes
        if (next.notes) {
          current.notes = current.notes ? `${current.notes}\n${next.notes}` : next.notes
        }

        // Merge data objects
        if (next.data) {
          current.data = { ...current.data, ...next.data }
        }

        // Track source IDs
        if (next.id) {
          currentSourceIds.push(next.id)
        }
      } else {
        // No overlap, save current and start new
        if (currentSourceIds.length > 1) {
          current.source_ids = currentSourceIds
        }
        result.push(current)
        current = { ...next }
        currentSourceIds = next.id ? [next.id] : []
      }
    }

    // Don't forget the last one
    if (currentSourceIds.length > 1) {
      current.source_ids = currentSourceIds
    }
    result.push(current)
  }

  // Sort final result by start time
  return result.sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

/**
 * Given merged results and the original raw activities, find all raw activities
 * belonging to the same merge group as the given activity ID.
 *
 * Pure function — no DB access, easy to unit test.
 */
export const findMergedGroupForActivity = (
  mergedResults: MergedActivity[],
  rawActivities: Activity[],
  activityId: string,
): Activity[] => {
  // Find which merged result contains the target activity ID
  const mergedGroup = mergedResults.find((m) => m.id === activityId || m.source_ids?.includes(activityId))
  if (!mergedGroup) return []

  // Collect all IDs in this merge group
  const groupIds = new Set(mergedGroup.source_ids ?? (mergedGroup.id ? [mergedGroup.id] : []))

  // Return the raw activities that belong to this group, sorted by start_time
  return rawActivities
    .filter((a) => a.id !== undefined && groupIds.has(a.id))
    .sort((a, b) => a.start_time.getTime() - b.start_time.getTime())
}

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
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
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

/**
 * Insert a new activity with a guaranteed new row (no upsert).
 * Used for merge operations where we need to ensure the activity is created.
 * Throws on conflict instead of silently doing nothing.
 */
export const insertNewActivity = async (user: string, activity: Activity): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id`,
    [
      activity.id,
      activity.source,
      activity.activity_type,
      activity.start_time,
      activity.end_time,
      activity.title,
      activity.notes,
      activity.data,
    ],
  )

  return result.rows[0].id as string
}

export const insertActivity = async (user: string, activity: Activity) => {
  await query(
    user,
    `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
     VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (source, activity_type, start_time) DO UPDATE SET
       end_time = EXCLUDED.end_time,
       title = EXCLUDED.title,
       notes = EXCLUDED.notes,
       data = EXCLUDED.data
     WHERE activities.deleted_at IS NULL`,
    [
      activity.id,
      activity.source,
      activity.activity_type,
      activity.start_time,
      activity.end_time,
      activity.title,
      activity.notes,
      activity.data,
    ],
  )
}

export const insertActivities = async (user: string, activities: Activity[]) => {
  if (activities.length === 0) return

  const values = activities.map((a) => [
    a.id ?? null,
    a.source,
    a.activity_type,
    a.start_time,
    a.end_time ?? null,
    a.title ?? null,
    a.notes ?? null,
    a.data ?? null,
  ])

  await query(
    user,
    format(
      `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
       SELECT COALESCE(v.id::uuid, gen_random_uuid()), v.source, v.activity_type,
              v.start_time::timestamptz, v.end_time::timestamptz, v.title, v.notes, v.data::jsonb
       FROM (VALUES %L) AS v(id, source, activity_type, start_time, end_time, title, notes, data)
       ON CONFLICT (source, activity_type, start_time) DO UPDATE SET
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         notes = EXCLUDED.notes,
         data = EXCLUDED.data
       WHERE activities.deleted_at IS NULL`,
      values,
    ),
  )
}

export const getActivityById = async (
  user: string,
  id: string,
  includeDeleted = false,
): Promise<Activity | null> => {
  const deletedClause = includeDeleted ? '' : ' AND deleted_at IS NULL'
  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE id = $1${deletedClause}`,
    [id],
  )

  if (result.rows.length === 0) {
    return null
  }

  return mapActivityRow(result.rows[0])
}

export const deleteActivity = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const restoreActivity = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NULL WHERE id = $1 AND deleted_at IS NOT NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const updateActivity = async (
  user: string,
  id: string,
  updates: ActivityUpdate,
): Promise<Activity | null> => {
  const fields: UpdateEntry[] = []
  if (updates.activity_type !== undefined) {
    fields.push({ column: 'activity_type', value: updates.activity_type })
  }
  if (updates.start_time !== undefined) fields.push({ column: 'start_time', value: updates.start_time })
  if (updates.end_time !== undefined) fields.push({ column: 'end_time', value: updates.end_time })
  if (updates.title !== undefined) fields.push({ column: 'title', value: updates.title })
  if (updates.notes !== undefined) fields.push({ column: 'notes', value: updates.notes })
  if (updates.data !== undefined) fields.push({ column: 'data', value: JSON.stringify(updates.data) })

  if (fields.length === 0) return getActivityById(user, id)

  const update = buildDynamicUpdate('activities', id, fields, {
    returning: 'id, source, activity_type, start_time, end_time, title, notes, data, deleted_at',
  })
  if (!update) return getActivityById(user, id)

  const result = await query(user, update.sql, update.params)
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
}

export const getActivities = async (
  user: string,
  activityType: ActivityType | ActivityType[],
  start: Date,
  end: Date,
): Promise<MergedActivity[]> => {
  const types = Array.isArray(activityType) ? activityType : [activityType]

  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = ANY($1) AND start_time >= $2 AND start_time <= $3
       AND deleted_at IS NULL
     ORDER BY start_time`,
    [types, start, end],
  )

  const activities = result.rows.map(mapActivityRow)

  return mergeOverlappingActivities(activities)
}

/**
 * Get sleep sessions that overlap with a date range.
 * Uses date overlap logic so overnight sleep (starting 11pm, ending 7am)
 * appears on the wake-up day rather than the start day.
 */
export const getSleepSessions = async (user: string, start: Date, end: Date): Promise<MergedActivity[]> => {
  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
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
 * Get Garmin activities that have a garmin_activity_id but haven't had their
 * per-second detail data synced yet.
 */
export const getActivitiesNeedingDetail = async (user: string, limit = 10): Promise<Activity[]> => {
  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE source = 'garmin' AND activity_type IN ('exercise', 'meditation')
       AND data->>'garmin_activity_id' IS NOT NULL
       AND (data->>'detail_synced') IS NULL
       AND deleted_at IS NULL
     ORDER BY start_time DESC
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
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
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

/**
 * Delete a Garmin activity that has the given garmin_activity_id but a different activity_type.
 * Used during re-sync to prevent duplicates when the type mapping changes
 * (e.g., meditation activities previously imported as exercise).
 */
export const deleteGarminActivityWithWrongType = async (
  user: string,
  garminActivityId: number,
  correctType: string,
): Promise<string | null> => {
  const result = await query(
    user,
    `DELETE FROM activities
     WHERE source = 'garmin'
       AND (data->>'garmin_activity_id')::int = $1
       AND activity_type != $2
       AND deleted_at IS NULL
     RETURNING id`,
    [garminActivityId, correctType],
  )
  return result.rows.length > 0 ? (result.rows[0].id as string) : null
}

/** Mark an activity's detail data as synced using JSONB merge (preserves existing data). */
export const markActivityDetailSynced = async (user: string, id: string): Promise<void> => {
  await query(user, `UPDATE activities SET data = data || '{"detail_synced": true}'::jsonb WHERE id = $1`, [
    id,
  ])
}
