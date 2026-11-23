import { query } from './connection.ts'

export const getDerivedMetricStamp = async (user: string, name: string): Promise<string | null> => {
  const result = await query<{ stamp: string }>(
    user,
    'SELECT stamp FROM derived_metric_state WHERE name = $1',
    [name],
  )
  return result.rows[0]?.stamp ?? null
}

export const setDerivedMetricStamp = async (user: string, name: string, stamp: string): Promise<void> => {
  await query(
    user,
    `INSERT INTO derived_metric_state (name, stamp, computed_at) VALUES ($1, $2, NOW())
     ON CONFLICT (name) DO UPDATE SET stamp = EXCLUDED.stamp, computed_at = NOW()`,
    [name, stamp],
  )
}
