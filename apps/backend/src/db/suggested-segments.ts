import type { LatLon } from './routes.ts'
import type { SegmentLineResult } from './segments.ts'

import { query, withUserTransaction } from './connection.ts'
import { effectiveType } from './effective-type.ts'
import {
  BBOX_EXPAND_DEG,
  LINE_COLUMNS,
  lineResult,
  ROUTE_END_TOLERANCE_M,
  SEGMENT_BUFFER_M,
} from './segments.ts'

/** Pairwise against at most this many tracks: newest first. */
export const SUGGESTION_CANDIDATE_LIMIT = 150

/** Mutual coverage (within the segment buffer) above which a stretch is the same as a stored one. */
export const SUGGESTION_SIMILARITY = 0.8

export type SuggestionStatus = 'pending' | 'dismissed' | 'promoted'

export interface SuggestionCandidate {
  activity_id: string
  start_time: Date
  end_time: Date
  points: LatLon[]
}

export interface SuggestionInput {
  activity_type: string
  points: LatLon[]
  candidates: SuggestionCandidate[]
}

export interface SuggestedSegmentRecord {
  id: string
  activity_type: string
  length_m: number
  activity_count: number
  source_activity_id: string | null
  status: SuggestionStatus
  segment_id: string | null
  created_at: Date
  points: LatLon[]
}

const geoJsonPoints = (geojson: string): LatLon[] =>
  (JSON.parse(geojson) as { coordinates: [number, number][] }).coordinates.map(([lon, lat]) => ({
    lat,
    lon,
  }))

/**
 * The activity's preferred track and, for pairing, one preferred track of each other
 * non-deleted activity of the same effective type whose bbox meets it: not overlapping it
 * in time (another source's row of the same run) and not on its route. Newest first.
 */
export const getSuggestionInput = async (
  user: string,
  activityId: string,
): Promise<SuggestionInput | null> => {
  const source = await query(
    user,
    `SELECT ST_AsGeoJSON(t.simplified) AS geojson, ${effectiveType('a')} AS activity_type
     FROM activity_tracks t
     JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
     WHERE t.activity_id = $1
     ORDER BY t.full_resolution DESC, t.point_count DESC, t.source
     LIMIT 1`,
    [activityId],
  )
  const row = source.rows[0]
  if (!row) return null
  const candidates = await query(
    user,
    `WITH src AS (
       SELECT t.simplified, ${effectiveType('a')} AS activity_type, a.start_time,
              COALESCE(a.end_time, a.start_time) AS end_time,
              (SELECT ar.route_id FROM activity_routes ar WHERE ar.activity_id = a.id) AS route_id
       FROM activity_tracks t
       JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
       WHERE t.activity_id = $1
       ORDER BY t.full_resolution DESC, t.point_count DESC, t.source
       LIMIT 1
     ),
     cand AS (
       SELECT DISTINCT ON (t.activity_id) t.activity_id, t.simplified, a.start_time,
              COALESCE(a.end_time, a.start_time) AS end_time
       FROM src
       JOIN activity_tracks t ON t.simplified && ST_Expand(src.simplified, $2) AND t.activity_id <> $1
       JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
       WHERE ${effectiveType('a')} = src.activity_type
         AND NOT (a.start_time < src.end_time AND COALESCE(a.end_time, a.start_time) > src.start_time)
         AND NOT EXISTS (
           SELECT 1 FROM activity_routes ar WHERE ar.activity_id = a.id AND ar.route_id = src.route_id
         )
       ORDER BY t.activity_id, t.full_resolution DESC, t.point_count DESC, t.source
     )
     SELECT activity_id, start_time, end_time, ST_AsGeoJSON(simplified) AS geojson
     FROM cand
     ORDER BY start_time DESC, activity_id
     LIMIT $3`,
    [activityId, BBOX_EXPAND_DEG, SUGGESTION_CANDIDATE_LIMIT],
  )
  return {
    activity_type: row.activity_type as string,
    candidates: candidates.rows.map((c) => ({
      activity_id: c.activity_id as string,
      end_time: c.end_time as Date,
      points: geoJsonPoints(c.geojson as string),
      start_time: c.start_time as Date,
    })),
    points: geoJsonPoints(row.geojson as string),
  }
}

export type UpsertSuggestionResult = 'inserted' | 'updated' | 'skipped'

/**
 * Stores a suggested stretch unless a similar one exists: same type, each line at least 80 %
 * inside the other's 25 m buffer, and the same direction. A similar segment, or a similar
 * dismissed or promoted suggestion, keeps it out; a similar pending one takes the larger count.
 */
export const upsertSuggestion = async (
  user: string,
  input: { activity_type: string; wkt: string; activity_count: number; source_activity_id: string },
): Promise<UpsertSuggestionResult> =>
  withUserTransaction(user, async (tx) => {
    await query(tx, `SELECT pg_advisory_xact_lock(hashtext('suggested_segments'))`)
    const similar = await query(
      tx,
      `WITH n AS (SELECT ST_GeomFromText($2, 4326) AS g),
       c AS (
         SELECT 'segment' AS kind, s.id, NULL::varchar AS status, s.geom
         FROM segments s, n WHERE s.activity_type = $1 AND s.geom && ST_Expand(n.g, $3)
         UNION ALL
         SELECT 'suggestion', ss.id, ss.status, ss.geom
         FROM suggested_segments ss, n WHERE ss.activity_type = $1 AND ss.geom && ST_Expand(n.g, $3)
       )
       SELECT c.kind, c.id, c.status
       FROM c, n
       WHERE ST_Length(ST_Intersection(n.g, ST_Buffer(c.geom::geography, $4)::geometry)::geography)
               / NULLIF(ST_Length(n.g::geography), 0) >= $5
         AND ST_Length(ST_Intersection(c.geom, ST_Buffer(n.g::geography, $4)::geometry)::geography)
               / NULLIF(ST_Length(c.geom::geography), 0) >= $5
         AND ST_LineLocatePoint(c.geom, ST_StartPoint(n.g)) < ST_LineLocatePoint(c.geom, ST_EndPoint(n.g))`,
      [input.activity_type, input.wkt, BBOX_EXPAND_DEG, SEGMENT_BUFFER_M, SUGGESTION_SIMILARITY],
    )
    if (similar.rows.some((r) => r.kind === 'segment' || r.status !== 'pending')) return 'skipped'
    const pending = similar.rows[0]
    if (pending) {
      await query(
        tx,
        `UPDATE suggested_segments SET activity_count = GREATEST(activity_count, $2) WHERE id = $1`,
        [pending.id, input.activity_count],
      )
      return 'updated'
    }
    await query(
      tx,
      `INSERT INTO suggested_segments (activity_type, geom, length_m, activity_count, source_activity_id)
       SELECT $1, g, ST_Length(g::geography), $3, $4 FROM (SELECT ST_GeomFromText($2, 4326) AS g) s`,
      [input.activity_type, input.wkt, input.activity_count, input.source_activity_id],
    )
    return 'inserted'
  })

export const markSuggestionsScanned = async (user: string, activityId: string): Promise<void> => {
  await query(user, `UPDATE activity_tracks SET segments_suggested_at = NOW() WHERE activity_id = $1`, [
    activityId,
  ])
}

const UNSCANNED = `
  FROM activities a
  WHERE a.deleted_at IS NULL
    AND EXISTS (SELECT 1 FROM activity_tracks t WHERE t.activity_id = a.id AND t.segments_suggested_at IS NULL)`

/** Non-deleted tracked activities segment suggestion has not looked at, newest first. */
export const listUnscannedTrackedActivities = async (
  user: string,
  limit: number,
): Promise<{ activity_id: string }[]> => {
  const result = await query(user, `SELECT a.id ${UNSCANNED} ORDER BY a.start_time DESC, a.id LIMIT $1`, [
    limit,
  ])
  return result.rows.map((row) => ({ activity_id: row.id as string }))
}

export const countUnscannedTrackedActivities = async (user: string): Promise<number> => {
  const result = await query(user, `SELECT COUNT(*)::int AS n ${UNSCANNED}`)
  return Number(result.rows[0]?.n ?? 0)
}

const SUGGESTION_COLUMNS = `
  id, activity_type, length_m, activity_count, source_activity_id, status, segment_id, created_at,
  ST_AsGeoJSON(geom) AS geojson`

const mapSuggestion = (row: Record<string, unknown>): SuggestedSegmentRecord => ({
  activity_count: Number(row.activity_count),
  activity_type: row.activity_type as string,
  created_at: row.created_at as Date,
  id: row.id as string,
  length_m: Number(row.length_m),
  points: geoJsonPoints(row.geojson as string),
  segment_id: (row.segment_id as string | null) ?? null,
  source_activity_id: (row.source_activity_id as string | null) ?? null,
  status: row.status as SuggestionStatus,
})

/** Pending suggestions, most activities first, then longest. */
export const listSuggestedSegments = async (user: string): Promise<SuggestedSegmentRecord[]> => {
  const result = await query(
    user,
    `SELECT ${SUGGESTION_COLUMNS} FROM suggested_segments
     WHERE status = 'pending'
     ORDER BY activity_count DESC, length_m DESC, created_at, id`,
  )
  return result.rows.map(mapSuggestion)
}

export const getSuggestedSegment = async (
  user: string,
  id: string,
): Promise<SuggestedSegmentRecord | null> => {
  const result = await query(user, `SELECT ${SUGGESTION_COLUMNS} FROM suggested_segments WHERE id = $1`, [id])
  return result.rows[0] ? mapSuggestion(result.rows[0]) : null
}

/** The suggestion's line, or its part between two distances (cut like a route's). */
export const suggestedSegmentLine = async (
  user: string,
  id: string,
  startKm?: number,
  endKm?: number,
): Promise<SegmentLineResult> => {
  const trimmed = startKm !== undefined && endKm !== undefined
  const result = await query(
    user,
    `WITH cut AS (
       SELECT s.activity_type,
              CASE WHEN NOT $4::boolean THEN s.geom
                   WHEN $3::float8 * 1000 <= s.length_m + $5 AND $2::float8 * 1000 < s.length_m
                THEN ST_Transform(ST_LineSubstring(ST_Transform(s.geom, 3857),
                       $2::float8 * 1000 / s.length_m, LEAST(1, $3::float8 * 1000 / s.length_m)), 4326)
              END AS line
       FROM suggested_segments s
       WHERE s.id = $1
     )
     SELECT ${LINE_COLUMNS} FROM cut`,
    [id, trimmed ? startKm : 0, trimmed ? endKm : 0, trimmed, ROUTE_END_TOLERANCE_M],
  )
  return lineResult(result.rows[0])
}

/** Dismisses or promotes a pending suggestion; false when there is none pending with this id. */
export const decideSuggestedSegment = async (
  user: string,
  id: string,
  status: 'dismissed' | 'promoted',
  segmentId?: string,
): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE suggested_segments SET status = $2, segment_id = $3, decided_at = NOW()
     WHERE id = $1 AND status = 'pending'`,
    [id, status, segmentId ?? null],
  )
  return (result.rowCount ?? 0) > 0
}
