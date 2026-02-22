/**
 * Activity CRUD operations and merge logic.
 */
import type { ActivityType } from '../schema'
import { query } from './connection'
import { buildDynamicUpdate, type UpdateEntry } from './dynamic-update'
import { mapActivityRow } from './row-mappers'
import type { Activity, ActivityUpdate, MergedActivity } from './types'

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
 * Find all non-deleted activities of the same type that overlap in time with the given activity.
 * Returns raw DB rows (no merge) including the activity itself.
 */
export const getOverlappingActivities = async (user: string, activity: Activity): Promise<Activity[]> => {
  const endTime = activity.end_time ?? activity.start_time
  const result = await query(
    user,
    `SELECT id, source, activity_type, start_time, end_time, title, notes, data, deleted_at
     FROM activities
     WHERE activity_type = $1
       AND deleted_at IS NULL
       AND start_time <= $3
       AND (end_time >= $2 OR end_time IS NULL)
     ORDER BY start_time`,
    [activity.activity_type, activity.start_time, endTime],
  )

  return result.rows.map(mapActivityRow)
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
  if (updates.start_time !== undefined) fields.push({ column: 'start_time', value: updates.start_time })
  if (updates.end_time !== undefined) fields.push({ column: 'end_time', value: updates.end_time })
  if (updates.title !== undefined) fields.push({ column: 'title', value: updates.title })
  if (updates.notes !== undefined) fields.push({ column: 'notes', value: updates.notes })

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
