/**
 * Activity write operations: insert, update, soft/hard delete, restore, and
 * data-migration helpers. Triggers supersession materialization on writes that
 * may change the merge topology.
 */
import format from 'pg-format'

import type { Activity, ActivityUpdate } from '../types.ts'

import { query } from '../connection.ts'
import { buildDynamicUpdate, type UpdateEntry } from '../dynamic-update.ts'
import { mapActivityRow } from '../row-mappers.ts'
import { isSupersedable } from './merge.ts'
import { getActivityById } from './queries.ts'
import { materializeSuperseded } from './supersession.ts'

/**
 * Insert a new activity with a guaranteed new row (no upsert).
 * Used for merge operations where we need to ensure the activity is created.
 * Throws on conflict instead of silently doing nothing.
 */
export const insertNewActivity = async (user: string, activity: Activity): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data, overrides_id)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
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
      activity.overrides_id ?? null,
    ],
  )

  return result.rows[0].id as string
}

/**
 * Insert an aurboda override row that supersedes a synced activity. The
 * override row's overrides_id points at the target; cross-merge always selects
 * it as winner regardless of activity_type. Re-materializes supersession.
 */
export const insertOverride = async (
  user: string,
  targetId: string,
  override: Omit<Activity, 'source' | 'overrides_id'>,
): Promise<Activity | null> => {
  const result = await query(
    user,
    `INSERT INTO activities (source, activity_type, start_time, end_time, title, notes, data, overrides_id)
     VALUES ('aurboda', $1, $2, $3, $4, $5, $6, $7)
     RETURNING id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at, superseded_by, overrides_id`,
    [
      override.activity_type,
      override.start_time,
      override.end_time ?? null,
      override.title ?? null,
      override.notes ?? null,
      override.data ? JSON.stringify(override.data) : null,
      targetId,
    ],
  )
  if (result.rows.length === 0) return null
  await materializeSuperseded(user, override.start_time)
  return mapActivityRow(result.rows[0])
}

export const insertActivity = async (user: string, activity: Activity): Promise<string> => {
  let insertedId: string
  if (activity.external_id) {
    // Upsert by external_id (for sourced data like calendar events, Oura tags, lastfm)
    const result = await query(
      user,
      `INSERT INTO activities (id, source, external_id, activity_type, start_time, end_time, title, notes, data)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
         activity_type = EXCLUDED.activity_type,
         start_time = EXCLUDED.start_time,
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         notes = EXCLUDED.notes,
         data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
       WHERE activities.deleted_at IS NULL
       RETURNING id`,
      [
        activity.id,
        activity.source,
        activity.external_id,
        activity.activity_type,
        activity.start_time,
        activity.end_time,
        activity.title,
        activity.notes,
        activity.data,
      ],
    )
    insertedId = result.rows[0]?.id as string
  } else {
    // Upsert by type + time (for sync data without external_id)
    const result = await query(
      user,
      `INSERT INTO activities (id, source, activity_type, start_time, end_time, title, notes, data)
       VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (source, activity_type, start_time) WHERE external_id IS NULL DO UPDATE SET
         end_time = EXCLUDED.end_time,
         title = EXCLUDED.title,
         notes = EXCLUDED.notes,
         data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
       WHERE activities.deleted_at IS NULL
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
    insertedId = result.rows[0]?.id as string
  }

  // Materialize superseded_by so chart/trend queries exclude cross-source duplicates.
  // Skipped for activity types that don't participate in merging (see isSupersedable).
  if (isSupersedable(activity)) {
    await materializeSuperseded(user, activity.start_time)
  }

  return insertedId
}

export const insertActivities = async (user: string, activities: Activity[]) => {
  if (activities.length === 0) return

  // Split into external_id and non-external_id batches for different conflict targets
  const withExtId = activities.filter((a) => a.external_id)
  const withoutExtId = activities.filter((a) => !a.external_id)

  if (withExtId.length > 0) {
    const values = withExtId.map((a) => [
      a.id ?? null,
      a.source,
      a.external_id!,
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
        `INSERT INTO activities (id, source, external_id, activity_type, start_time, end_time, title, notes, data)
         SELECT COALESCE(v.id::uuid, gen_random_uuid()), v.source, v.external_id, v.activity_type,
                v.start_time::timestamptz, v.end_time::timestamptz, v.title, v.notes, v.data::jsonb
         FROM (VALUES %L) AS v(id, source, external_id, activity_type, start_time, end_time, title, notes, data)
         ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
           activity_type = EXCLUDED.activity_type,
           start_time = EXCLUDED.start_time,
           end_time = EXCLUDED.end_time,
           title = EXCLUDED.title,
           notes = EXCLUDED.notes,
           data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
         WHERE activities.deleted_at IS NULL`,
        values,
      ),
    )
  }

  if (withoutExtId.length > 0) {
    const values = withoutExtId.map((a) => [
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
         ON CONFLICT (source, activity_type, start_time) WHERE external_id IS NULL DO UPDATE SET
           end_time = EXCLUDED.end_time,
           title = EXCLUDED.title,
           notes = EXCLUDED.notes,
           data = COALESCE(activities.data, '{}'::jsonb) || EXCLUDED.data
         WHERE activities.deleted_at IS NULL`,
        values,
      ),
    )
  }

  // Materialize once per distinct day covered by the batch. Activities from
  // non-mergeable sources (e.g. ical) short-circuit the check.
  const days = new Set<number>()
  for (const a of activities) {
    if (!isSupersedable(a)) continue
    const d = new Date(a.start_time)
    d.setUTCHours(12, 0, 0, 0)
    days.add(d.getTime())
  }
  for (const t of days) {
    await materializeSuperseded(user, new Date(t))
  }
}

export const deleteActivity = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )

  return (result.rowCount ?? 0) > 0
}

export const softDeleteActivityByExternalId = async (
  user: string,
  source: string,
  externalId: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE activities SET deleted_at = NOW() WHERE source = $1 AND external_id = $2 AND deleted_at IS NULL`,
    [source, externalId],
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
    returning:
      'id, source, external_id, activity_type, start_time, end_time, title, notes, data, deleted_at, superseded_by, overrides_id',
  })
  if (!update) return getActivityById(user, id)

  const result = await query(user, update.sql, update.params)
  if (result.rows.length === 0) return null
  return mapActivityRow(result.rows[0])
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
       AND (data->>'garmin_activity_id')::bigint = $1
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

/** Hard-delete all activities from a given source. */
export const hardDeleteActivitiesBySource = async (user: string, source: string): Promise<number> => {
  const result = await query(user, `DELETE FROM activities WHERE source = $1`, [source])
  return result.rowCount ?? 0
}

/** Hard-delete activities by source and external_id prefix. */
export const hardDeleteActivitiesByExternalIdPrefix = async (
  user: string,
  source: string,
  prefix: string,
): Promise<number> => {
  const result = await query(user, `DELETE FROM activities WHERE source = $1 AND external_id LIKE $2`, [
    source,
    `${prefix}%`,
  ])
  return result.rowCount ?? 0
}

/** Update an activity's end_time by external_id. */
export const updateActivityEndTimeByExternalId = async (
  user: string,
  externalId: string,
  endTime: Date,
): Promise<void> => {
  await query(user, `UPDATE activities SET end_time = $1 WHERE external_id = $2 AND deleted_at IS NULL`, [
    endTime,
    externalId,
  ])
}

/**
 * Update activity_type for all activities with a given tag_key in their data.
 * Used when a user renames a programmatic tag via tag mappings.
 */
export const updateActivityTypeByTagKey = async (
  user: string,
  tagKey: string,
  newActivityType: string,
): Promise<number> => {
  const result = await query(
    user,
    `UPDATE activities SET activity_type = $1 WHERE data->>'tag_key' = $2 AND deleted_at IS NULL`,
    [newActivityType, tagKey],
  )
  return result.rowCount ?? 0
}

/**
 * Rewrite `data.category_path` on screentime activities. Used when a screentime
 * category is renamed or moved (#652) so historical bars and chart breakdowns
 * stop showing the stale path. Matches by activity_type slug AND old path
 * string — slug isolates this category's activities (multiple categories can
 * share a slug via convergence; we only want the ones whose path string is
 * the old value). `external_id` carries the old path too, so it stays as the
 * historical fingerprint and is intentionally not touched here.
 */
export const updateScreentimeActivityCategoryPath = async (
  user: string,
  activityType: string,
  oldCategoryPath: string,
  newCategoryPath: string,
): Promise<number> => {
  if (oldCategoryPath === newCategoryPath) return 0
  const result = await query(
    user,
    `UPDATE activities
       SET data = jsonb_set(data, '{category_path}', to_jsonb($3::text))
     WHERE activity_type = $1
       AND data->>'category_path' = $2
       AND deleted_at IS NULL`,
    [activityType, oldCategoryPath, newCategoryPath],
  )
  return result.rowCount ?? 0
}

/**
 * Migrate activities with generic 'exercise' type to their specific type.
 * Handles both legacy activity_type_key and HC exerciseTypeName fields.
 * Returns the number of activities updated.
 */
export const migrateExerciseTypes = async (user: string): Promise<number> => {
  // Step 1: activity_type_key path (legacy)
  const r1 = await query(
    user,
    `UPDATE activities
     SET activity_type = data->>'activity_type_key',
         data = data - 'activity_type_key'
     WHERE activity_type = 'exercise'
       AND data->>'activity_type_key' IS NOT NULL
       AND data->>'activity_type_key' != 'unknown'
       AND deleted_at IS NULL`,
  )

  // Step 2: exerciseTypeName path (Health Connect)
  const r2 = await query(
    user,
    `UPDATE activities
     SET activity_type = data->>'exerciseTypeName'
     WHERE activity_type = 'exercise'
       AND data->>'exerciseTypeName' IS NOT NULL
       AND data->>'exerciseTypeName' NOT IN ('other_workout', 'unknown')
       AND deleted_at IS NULL
       AND NOT EXISTS (
         SELECT 1 FROM activities a2
         WHERE a2.source = activities.source
           AND a2.activity_type = activities.data->>'exerciseTypeName'
           AND a2.start_time = activities.start_time
           AND a2.external_id IS NULL
           AND a2.id != activities.id
       )`,
  )

  return (r1.rowCount ?? 0) + (r2.rowCount ?? 0)
}
