import { query } from './connection.ts'

export interface RecentSourceActivity {
  location_sources: string[]
  productivity: { source: string; is_mobile: boolean }[]
  health_connect: boolean
  media_plays: boolean
}

export const getRecentSourceActivity = async (
  user: string,
  { since7d, since30d }: { since7d: Date; since30d: Date },
): Promise<RecentSourceActivity> => {
  const result = await query<RecentSourceActivity>(
    user,
    `SELECT
       ARRAY(
         SELECT DISTINCT source FROM locations WHERE time >= $1 AND deleted_at IS NULL ORDER BY source
       ) AS location_sources,
       COALESCE(
         (SELECT json_agg(p ORDER BY p.source, p.is_mobile)
            FROM (SELECT DISTINCT source, COALESCE(is_mobile, false) AS is_mobile
                    FROM productivity
                   WHERE start_time >= $1 AND deleted_at IS NULL) p),
         '[]'::json
       ) AS productivity,
       EXISTS (
         SELECT 1 FROM raw_records WHERE source = 'health_connect' AND recorded_at >= $2
       ) AS health_connect,
       EXISTS (
         SELECT 1 FROM raw_records WHERE source = 'mpris' AND record_type = 'media_play' AND recorded_at >= $1
       ) AS media_plays`,
    [since7d, since30d],
  )
  const row = result.rows[0]
  return {
    health_connect: row?.health_connect ?? false,
    location_sources: row?.location_sources ?? [],
    media_plays: row?.media_plays ?? false,
    productivity: row?.productivity ?? [],
  }
}
