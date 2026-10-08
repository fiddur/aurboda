import type { GarminActivityDetailResponse } from '../integrations/garmin/client.ts'

import { query } from './connection.ts'

export interface ActivityTrackInput {
  activity_id: string
  source: string
  ewkt: string
  full_resolution: boolean
}

export interface ActivityTrackPoint {
  lat: number
  lon: number
  alt: number
  t: number
}

export interface ActivityTrackRecord {
  activity_id: string
  /** The activity's start_time: the origin of each point's `t`. */
  start_time: Date
  source: string
  length_m: number
  point_count: number
  full_resolution: boolean
  points: ActivityTrackPoint[]
}

/** Derived columns are computed in SQL so the stored geometry is the single source for them. */
export const upsertActivityTrack = async (user: string, input: ActivityTrackInput): Promise<void> => {
  await query(
    user,
    `INSERT INTO activity_tracks (activity_id, source, geom, simplified, length_m, point_count, full_resolution)
     SELECT $1, $2, g, ST_SimplifyPreserveTopology(ST_Force2D(g), 0.00008),
            ST_Length(ST_Force2D(g)::geography), ST_NPoints(g), $4
     FROM (SELECT ST_GeomFromEWKT($3) AS g) s
     ON CONFLICT (activity_id, source) DO UPDATE SET
       geom = EXCLUDED.geom,
       simplified = EXCLUDED.simplified,
       length_m = EXCLUDED.length_m,
       point_count = EXCLUDED.point_count,
       full_resolution = EXCLUDED.full_resolution,
       updated_at = NOW()`,
    [input.activity_id, input.source, input.ewkt, input.full_resolution],
  )
}

/**
 * The activity's track; when several sources have one, prefer full_resolution,
 * then the longest point_count. ST_AsGeoJSON drops M, so points are dumped.
 */
export const getActivityTrack = async (
  user: string,
  activityId: string,
): Promise<ActivityTrackRecord | null> => {
  const result = await query(
    user,
    `SELECT t.activity_id, a.start_time, t.source, t.length_m, t.point_count, t.full_resolution,
            (SELECT json_agg(json_build_array(ST_Y(d.geom), ST_X(d.geom), ST_Z(d.geom), ST_M(d.geom)) ORDER BY d.path)
               FROM ST_DumpPoints(t.geom) d) AS coords
     FROM activity_tracks t
     JOIN activities a ON a.id = t.activity_id
     WHERE t.activity_id = $1
     ORDER BY t.full_resolution DESC, t.point_count DESC, t.source
     LIMIT 1`,
    [activityId],
  )
  const row = result.rows[0]
  if (!row) return null
  const coords = (row.coords ?? []) as [number, number, number, number][]
  return {
    activity_id: row.activity_id as string,
    full_resolution: row.full_resolution as boolean,
    length_m: Number(row.length_m),
    point_count: Number(row.point_count),
    points: coords.map(([lat, lon, alt, t]) => ({ alt, lat, lon, t })),
    source: row.source as string,
    start_time: row.start_time as Date,
  }
}

export const hasActivityTrack = async (
  user: string,
  activityId: string,
  source: string,
): Promise<boolean> => {
  const result = await query(user, `SELECT 1 FROM activity_tracks WHERE activity_id = $1 AND source = $2`, [
    activityId,
    source,
  ])
  return result.rows.length > 0
}

export interface TrackBackfillPage {
  after?: Date
  limit: number
}

export interface GarminBackfillCandidate {
  activity_id: string
  start_time: Date
  end_time: Date | null
  detail: GarminActivityDetailResponse
}

/**
 * Garmin activities with a stored detail raw record and no Garmin track, oldest
 * first. A detail without coordinates (an indoor session) never yields a track
 * and would stay a candidate forever, so the JSONB filter keeps the backfill
 * from re-reading those details on every run.
 */
export const getGarminTrackBackfillCandidates = async (
  user: string,
  { after, limit }: TrackBackfillPage,
): Promise<GarminBackfillCandidate[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.start_time, a.end_time, r.data
     FROM activities a
     JOIN raw_records r
       ON r.source = 'garmin'
      AND r.record_type = 'garmin_activity_detail'
      AND r.external_id = 'garmin-activity-detail-' || (a.data->>'garmin_activity_id')
     LEFT JOIN activity_tracks t ON t.activity_id = a.id AND t.source = 'garmin'
     WHERE a.source = 'garmin'
       AND a.deleted_at IS NULL
       AND a.data->>'garmin_activity_id' IS NOT NULL
       AND t.activity_id IS NULL
       AND (r.data->'metricDescriptors' @> '[{"key":"directLatitude"}]'::jsonb
            OR (jsonb_typeof(r.data->'geoPolylineDTO'->'polyline') = 'array'
                AND jsonb_array_length(r.data->'geoPolylineDTO'->'polyline') > 0))
       AND ($1::timestamptz IS NULL OR a.start_time > $1)
     ORDER BY a.start_time
     LIMIT $2`,
    [after ?? null, limit],
  )
  return result.rows.map((row) => ({
    activity_id: row.id as string,
    detail: row.data as GarminActivityDetailResponse,
    end_time: (row.end_time as Date | null) ?? null,
    start_time: row.start_time as Date,
  }))
}

export interface StravaBackfillCandidate {
  activity_id: string
  start_time: Date
  elapsed_seconds: number
  polyline: string
}

/** Strava activities whose stored detail carries a map polyline and that have no Strava track, oldest first. */
export const getStravaTrackBackfillCandidates = async (
  user: string,
  { after, limit }: TrackBackfillPage,
): Promise<StravaBackfillCandidate[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.start_time,
            (r.data->>'elapsed_time')::int AS elapsed_seconds,
            COALESCE(NULLIF(r.data->'map'->>'polyline', ''), r.data->'map'->>'summary_polyline') AS polyline
     FROM activities a
     JOIN raw_records r
       ON r.source = 'strava'
      AND r.record_type = 'strava_activity'
      AND r.external_id = a.external_id
     LEFT JOIN activity_tracks t ON t.activity_id = a.id AND t.source = 'strava'
     WHERE a.source = 'strava'
       AND a.deleted_at IS NULL
       AND t.activity_id IS NULL
       AND COALESCE(NULLIF(r.data->'map'->>'polyline', ''), r.data->'map'->>'summary_polyline', '') <> ''
       AND r.data->>'elapsed_time' IS NOT NULL
       AND ($1::timestamptz IS NULL OR a.start_time > $1)
     ORDER BY a.start_time
     LIMIT $2`,
    [after ?? null, limit],
  )
  return result.rows.map((row) => ({
    activity_id: row.id as string,
    elapsed_seconds: Number(row.elapsed_seconds),
    polyline: row.polyline as string,
    start_time: row.start_time as Date,
  }))
}
