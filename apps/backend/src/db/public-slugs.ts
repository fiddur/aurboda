import { query } from './connection.ts'

/**
 * Dashboards, challenges and shared exercises share one `/u/<user>/<slug>` namespace, resolved in
 * that order, so a new slug must be free in all three. Each table's UNIQUE guards the race.
 */
export const publicSlugIsFree = async (user: string, slug: string): Promise<boolean> => {
  const result = await query(
    user,
    `SELECT 1 FROM shared_dashboards WHERE slug = $1
     UNION ALL SELECT 1 FROM challenges WHERE slug = $1
     UNION ALL SELECT 1 FROM shared_exercises WHERE slug = $1`,
    [slug],
  )
  return result.rows.length === 0
}
