import type { Queryable } from '../pool.ts'

import { singleLiftExerciseName, singleLiftTypeNames } from '../../services/single-lift-types.ts'
import { query, withUserTransaction } from '../connection.ts'
import { materializeSuperseded } from './supersession.ts'

export interface RetireSingleLiftTypesResult {
  converted: number
  deleted: string[]
  kept: string[]
}

/**
 * A row without `external_id` whose `(source, start_time)` is already taken by a
 * `strength_training` row would break `idx_activities_type_time`, so it stays on the old type
 * (and keeps the definition alive as a custom type).
 */
const convertActivities = async (
  tx: Queryable,
  name: string,
  exercise: string,
): Promise<{ start_time: Date; deleted_at: Date | null }[]> => {
  const result = await query<{ start_time: Date; deleted_at: Date | null }>(
    tx,
    `UPDATE activities a
        SET activity_type = 'strength_training',
            data = CASE
              WHEN jsonb_typeof(a.data->'sets') = 'array' AND jsonb_array_length(a.data->'sets') > 0 THEN a.data
              ELSE COALESCE(a.data, '{}'::jsonb)
                || jsonb_build_object('sets', jsonb_build_array(jsonb_build_object('exercise', $2::text)))
            END
      WHERE a.activity_type = $1
        AND (a.external_id IS NOT NULL OR NOT EXISTS (
          SELECT 1 FROM activities s
           WHERE s.activity_type = 'strength_training'
             AND s.external_id IS NULL
             AND s.source = a.source
             AND s.start_time = a.start_time
        ))
      RETURNING a.start_time, a.deleted_at`,
    [name, exercise],
  )
  return result.rows
}

const activityTypeSources = `source_type IN ('activity_type', 'tag') AND pattern = $1`

/** Anything that still names the type; JSON is matched as text, so a false positive only keeps it. */
const isReferenced = async (tx: Queryable, name: string): Promise<boolean> => {
  const quoted = `%"${name.replaceAll('_', String.raw`\_`)}"%`
  const result = await query<{ referenced: boolean }>(
    tx,
    `SELECT
       EXISTS (SELECT 1 FROM activities WHERE activity_type = $1)
       OR EXISTS (SELECT 1 FROM activity_type_definitions WHERE parent_type = $1)
       OR EXISTS (
         SELECT 1 FROM deduction_rules
          WHERE output_activity_type = $1
             OR EXISTS (
               SELECT 1 FROM jsonb_array_elements(conditions::jsonb) AS elem
                WHERE elem->>'kind' = 'activity' AND elem->>'activity_type' = $1
             )
       )
       OR EXISTS (SELECT 1 FROM goals WHERE activity_type = $1 OR (${activityTypeSources}))
       OR EXISTS (SELECT 1 FROM challenges WHERE ${activityTypeSources})
       OR EXISTS (SELECT 1 FROM challenge_participations WHERE ${activityTypeSources})
       OR EXISTS (SELECT 1 FROM autoshare_rules WHERE $1 = ANY(activity_types))
       OR EXISTS (SELECT 1 FROM routes WHERE activity_type = $1)
       OR EXISTS (SELECT 1 FROM shared_exercises WHERE activity_type = $1)
       OR EXISTS (SELECT 1 FROM screentime_categories WHERE activity_type_name = $1)
       OR EXISTS (SELECT 1 FROM user_settings WHERE settings::text LIKE $2)
       OR EXISTS (SELECT 1 FROM shared_dashboards WHERE config::text LIKE $2)
       AS referenced`,
    [name, quoted],
  )
  return result.rows[0].referenced
}

/**
 * Health Connect's early single-lift session types (#1651) stop being activity types: their
 * activities become `strength_training` sessions with the lift as one set, and each built-in
 * definition is deleted, or kept as an ordinary custom type while something still refers to it.
 * Idempotent: once no built-in definition of those names is left, it only reads.
 */
export const retireSingleLiftTypes = async (user: string): Promise<RetireSingleLiftTypesResult> => {
  const found = await query<{ name: string }>(
    user,
    `SELECT name FROM activity_type_definitions WHERE is_builtin = true AND name = ANY($1) ORDER BY name`,
    [singleLiftTypeNames],
  )
  if (found.rows.length === 0) return { converted: 0, deleted: [], kept: [] }

  const { converted, deleted, kept, startTimes } = await withUserTransaction(user, async (tx) => {
    const outcome = { converted: 0, deleted: [] as string[], kept: [] as string[], startTimes: [] as Date[] }
    for (const { name } of found.rows) {
      const exercise = singleLiftExerciseName(name) ?? name
      const rows = await convertActivities(tx, name, exercise)
      outcome.converted += rows.length
      for (const row of rows) if (row.deleted_at === null) outcome.startTimes.push(row.start_time)
      if (await isReferenced(tx, name)) {
        await query(
          tx,
          `UPDATE activity_type_definitions
              SET is_builtin = false,
                  health_connect_exercise_type = NULL,
                  health_connect_record_type = NULL,
                  updated_at = NOW()
            WHERE name = $1`,
          [name],
        )
        outcome.kept.push(name)
      } else {
        await query(tx, `DELETE FROM activity_type_definitions WHERE name = $1`, [name])
        outcome.deleted.push(name)
      }
    }
    return outcome
  })

  for (const startTime of startTimes) await materializeSuperseded(user, startTime)
  return { converted, deleted, kept }
}
