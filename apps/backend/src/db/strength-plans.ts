import type { StrengthPlanSet } from '@aurboda/api-spec'

import { query } from './connection.ts'

export interface StrengthPlanRecord {
  id: string
  name: string
  planned_for: string | null
  note: string | null
  sets: StrengthPlanSet[]
  created_at: Date
  updated_at: Date
}

export interface StrengthPlanInput {
  name: string
  planned_for: string | null
  note: string | null
  sets: StrengthPlanSet[]
}

export interface StrengthPlanPatch {
  name?: string
  planned_for?: string | null
  note?: string | null
  sets?: StrengthPlanSet[]
}

export interface StrengthPlanSessionRecord {
  activity_id: string
  start_time: Date
}

const COLUMNS = `id, name, to_char(planned_for, 'YYYY-MM-DD') AS planned_for, note, sets, created_at, updated_at`

export const createStrengthPlan = async (
  user: string,
  input: StrengthPlanInput,
): Promise<StrengthPlanRecord> => {
  const result = await query<StrengthPlanRecord>(
    user,
    `INSERT INTO strength_plans (name, planned_for, note, sets)
     VALUES ($1, $2::date, $3, $4::jsonb)
     RETURNING ${COLUMNS}`,
    [input.name, input.planned_for, input.note, JSON.stringify(input.sets)],
  )
  return result.rows[0]
}

export const getStrengthPlan = async (user: string, id: string): Promise<StrengthPlanRecord | null> => {
  const result = await query<StrengthPlanRecord>(
    user,
    `SELECT ${COLUMNS} FROM strength_plans WHERE id = $1`,
    [id],
  )
  return result.rows[0] ?? null
}

export const listStrengthPlans = async (user: string): Promise<StrengthPlanRecord[]> => {
  const result = await query<StrengthPlanRecord>(
    user,
    `SELECT ${COLUMNS} FROM strength_plans ORDER BY created_at, id`,
  )
  return result.rows
}

/** A field left out of `patch` stays; `null` clears `planned_for` or `note`. Null when the plan does not exist. */
export const updateStrengthPlan = async (
  user: string,
  id: string,
  patch: StrengthPlanPatch,
): Promise<StrengthPlanRecord | null> => {
  const result = await query<StrengthPlanRecord>(
    user,
    `UPDATE strength_plans
        SET name = COALESCE($2, name),
            planned_for = CASE WHEN $3::boolean THEN $4::date ELSE planned_for END,
            note = CASE WHEN $5::boolean THEN $6::text ELSE note END,
            sets = COALESCE($7::jsonb, sets),
            updated_at = NOW()
      WHERE id = $1
      RETURNING ${COLUMNS}`,
    [
      id,
      patch.name ?? null,
      patch.planned_for !== undefined,
      patch.planned_for ?? null,
      patch.note !== undefined,
      patch.note ?? null,
      patch.sets === undefined ? null : JSON.stringify(patch.sets),
    ],
  )
  return result.rows[0] ?? null
}

export const deleteStrengthPlan = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, 'DELETE FROM strength_plans WHERE id = $1', [id])
  return (result.rowCount ?? 0) > 0
}

/** The non-deleted activities whose `data.plan_id` names a plan, newest first, by plan id. */
export const listStrengthPlanSessions = async (
  user: string,
  planIds?: string[],
): Promise<Map<string, StrengthPlanSessionRecord[]>> => {
  const params: unknown[] = []
  let filter = `data ? 'plan_id'`
  if (planIds) {
    params.push(planIds)
    filter += ` AND data->>'plan_id' = ANY($1::text[])`
  }
  const result = await query<StrengthPlanSessionRecord & { plan_id: string }>(
    user,
    `SELECT data->>'plan_id' AS plan_id, id AS activity_id, start_time
       FROM activities
      WHERE deleted_at IS NULL AND ${filter}
      ORDER BY start_time DESC, id`,
    params,
  )
  const sessions = new Map<string, StrengthPlanSessionRecord[]>()
  for (const { plan_id, ...session } of result.rows) {
    const list = sessions.get(plan_id) ?? []
    list.push(session)
    sessions.set(plan_id, list)
  }
  return sessions
}
