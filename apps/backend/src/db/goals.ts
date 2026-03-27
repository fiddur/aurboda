/**
 * Goals CRUD operations.
 */
import type { Goal } from '@aurboda/api-spec'

import { query } from './connection.ts'

export const getGoals = async (user: string): Promise<Goal[]> => {
  const result = await query(
    user,
    `SELECT id, metric, min_value, max_value, window FROM goals ORDER BY created_at`,
  )

  return result.rows.map((row) => ({
    id: row.id,
    metric: row.metric,
    ...(row.min_value != null ? { min: row.min_value } : {}),
    ...(row.max_value != null ? { max: row.max_value } : {}),
    window: row.window,
  }))
}

export const insertGoal = async (user: string, goal: Goal): Promise<void> => {
  await query(
    user,
    `INSERT INTO goals (id, metric, min_value, max_value, window)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET
       metric = EXCLUDED.metric,
       min_value = EXCLUDED.min_value,
       max_value = EXCLUDED.max_value,
       window = EXCLUDED.window,
       updated_at = NOW()`,
    [goal.id, goal.metric, goal.min ?? null, goal.max ?? null, goal.window],
  )
}

export const replaceGoals = async (user: string, goals: Goal[]): Promise<void> => {
  await query(user, `DELETE FROM goals`)

  for (const goal of goals) {
    await insertGoal(user, goal)
  }
}

export const deleteGoal = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM goals WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}
