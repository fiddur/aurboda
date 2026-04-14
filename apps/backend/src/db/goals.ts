/**
 * Goals CRUD operations.
 */
import type { Goal, MetricGoal, TrendGoal } from '@aurboda/api-spec'

import { query } from './connection.ts'

const rowToGoal = (row: Record<string, unknown>): Goal => {
  if (row.goal_type === 'trend') {
    return {
      aggregation: row.aggregation as TrendGoal['aggregation'],
      display_period: row.display_period as TrendGoal['display_period'],
      goal_type: 'trend',
      half_life_days: row.half_life_days as number,
      id: row.id as string,
      ...(row.max_value != null ? { max: row.max_value as number } : {}),
      ...(row.min_value != null ? { min: row.min_value as number } : {}),
      pattern: row.pattern as string,
      source_type: row.source_type as TrendGoal['source_type'],
    } satisfies TrendGoal
  }

  return {
    goal_type: 'metric',
    id: row.id as string,
    metric: row.metric as MetricGoal['metric'],
    ...(row.min_value != null ? { min: row.min_value as number } : {}),
    ...(row.max_value != null ? { max: row.max_value as number } : {}),
    window: row.time_window as string,
  } satisfies MetricGoal
}

export const getGoals = async (user: string): Promise<Goal[]> => {
  const result = await query(
    user,
    `SELECT id, goal_type, metric, min_value, max_value, time_window,
            source_type, pattern, half_life_days, display_period, aggregation
     FROM goals ORDER BY created_at`,
  )

  return result.rows.map(rowToGoal)
}

export const insertGoal = async (user: string, goal: Goal): Promise<void> => {
  if (goal.goal_type === 'trend') {
    await query(
      user,
      `INSERT INTO goals (id, goal_type, source_type, pattern, half_life_days, display_period, aggregation, min_value, max_value)
       VALUES ($1, 'trend', $2, $3, $4, $5, $6, $7, $8)
       ON CONFLICT (id) DO UPDATE SET
         goal_type = 'trend',
         source_type = EXCLUDED.source_type,
         pattern = EXCLUDED.pattern,
         half_life_days = EXCLUDED.half_life_days,
         display_period = EXCLUDED.display_period,
         aggregation = EXCLUDED.aggregation,
         min_value = EXCLUDED.min_value,
         max_value = EXCLUDED.max_value,
         metric = NULL,
         time_window = NULL,
         updated_at = NOW()`,
      [
        goal.id,
        goal.source_type,
        goal.pattern,
        goal.half_life_days,
        goal.display_period,
        goal.aggregation,
        goal.min ?? null,
        goal.max ?? null,
      ],
    )
  } else {
    await query(
      user,
      `INSERT INTO goals (id, goal_type, metric, min_value, max_value, time_window)
       VALUES ($1, 'metric', $2, $3, $4, $5)
       ON CONFLICT (id) DO UPDATE SET
         goal_type = 'metric',
         metric = EXCLUDED.metric,
         min_value = EXCLUDED.min_value,
         max_value = EXCLUDED.max_value,
         time_window = EXCLUDED.time_window,
         source_type = NULL,
         pattern = NULL,
         half_life_days = NULL,
         display_period = NULL,
         aggregation = NULL,
         updated_at = NOW()`,
      [goal.id, goal.metric, goal.min ?? null, goal.max ?? null, goal.window],
    )
  }
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
