import type { SegmentSort } from '@aurboda/api-spec'
import type { QueryResultRow } from 'pg'

import type { LatLon } from './routes.ts'

import { query, withUserTransaction } from './connection.ts'
import { effectiveType } from './effective-type.ts'

/** Buffer around a segment and a track, in metres, for matching and timing. */
export const SEGMENT_BUFFER_M = 25

/** Share of a segment that must lie within a track's buffer for the track to be timed on it. */
export const SEGMENT_COVERAGE_THRESHOLD = 0.9

/** Degrees added around a bbox when looking for candidates (~100–200 m). */
export const BBOX_EXPAND_DEG = 0.002

/** ~3 m: a line cut from a full-resolution track keeps its shape but loses its sample noise. */
const CUT_SIMPLIFY_DEG = 0.00003

/** How far past a route's end a requested end km may reach (a rounded length) before it is refused. */
export const ROUTE_END_TOLERANCE_M = 50

export interface SegmentLine {
  activity_type: string
  wkt: string
  length_m: number
  start: LatLon
  end: LatLon
}

export type SegmentLineResult =
  | { ok: true; line: SegmentLine }
  | { ok: false; reason: 'not_found' | 'out_of_range' }

export interface SegmentRecord {
  id: string
  name: string
  activity_type: string
  length_m: number
  effort_count: number
  best_elapsed_s: number | null
  last_effort_at: Date | null
  created_from_activity_id: string | null
  created_from_route_id: string | null
  created_at: Date
  updated_at: Date
}

export interface SegmentEffortRow {
  segment_id: string
  activity_id: string
  source: string
  activity_start_time: Date
  start_offset_s: number
  elapsed_s: number
  avg_hr: number | null
  pace_s_per_km: number | null
  approximate: boolean
  is_best: boolean
  rank: number
}

export interface ActivitySegmentEffortRow extends SegmentEffortRow {
  segment_name: string
}

export interface SegmentEffortInput {
  segment_id: string
  activity_id: string
  source: string
  start_offset_s: number
  elapsed_s: number
  avg_hr: number | null
  pace_s_per_km: number | null
  approximate: boolean
}

export interface TimingTrack {
  activity_id: string
  source: string
  start_time: Date
  full_resolution: boolean
  points: { lat: number; lon: number; t: number }[]
}

export const lineResult = (row: QueryResultRow | undefined): SegmentLineResult => {
  if (!row) return { ok: false, reason: 'not_found' }
  if (row.wkt == null) return { ok: false, reason: 'out_of_range' }
  return {
    line: {
      activity_type: row.activity_type as string,
      end: { lat: Number(row.end_lat), lon: Number(row.end_lon) },
      length_m: Number(row.length_m),
      start: { lat: Number(row.start_lat), lon: Number(row.start_lon) },
      wkt: row.wkt as string,
    },
    ok: true,
  }
}

export const LINE_COLUMNS = `
  activity_type, ST_AsText(line) AS wkt, ST_Length(line::geography) AS length_m,
  ST_Y(ST_StartPoint(line)) AS start_lat, ST_X(ST_StartPoint(line)) AS start_lon,
  ST_Y(ST_EndPoint(line)) AS end_lat, ST_X(ST_EndPoint(line)) AS end_lon`

/**
 * The part of the activity's preferred track between two M values (seconds since its
 * start), simplified at ~3 m; out of range when either offset falls outside the track.
 */
export const segmentLineFromActivity = async (
  user: string,
  activityId: string,
  startOffsetS: number,
  endOffsetS: number,
): Promise<SegmentLineResult> => {
  const result = await query(
    user,
    `WITH t AS (
       SELECT t.geom, ${effectiveType('a')} AS activity_type
       FROM activity_tracks t
       JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
       WHERE t.activity_id = $1
       ORDER BY t.full_resolution DESC, t.point_count DESC, t.source
       LIMIT 1
     ),
     cut AS (
       SELECT t.activity_type,
              CASE WHEN $2::float8 >= ST_M(ST_StartPoint(t.geom)) AND $3::float8 <= ST_M(ST_EndPoint(t.geom))
                THEN ST_SimplifyPreserveTopology(
                  ST_GeometryN(ST_LineMerge(ST_CollectionExtract(ST_Force2D(ST_LocateBetween(t.geom, $2::float8, $3::float8)), 2)), 1),
                  $4)
              END AS line
       FROM t
     )
     SELECT ${LINE_COLUMNS} FROM cut`,
    [activityId, startOffsetS, endOffsetS, CUT_SIMPLIFY_DEG],
  )
  return lineResult(result.rows[0])
}

/**
 * The part of a non-deleted route between two distances from its start. Fractions are
 * taken in Web Mercator, which keeps distance ratios locally, unlike plain degrees.
 */
export const segmentLineFromRoute = async (
  user: string,
  routeId: string,
  startKm: number,
  endKm: number,
): Promise<SegmentLineResult> => {
  const result = await query(
    user,
    `WITH cut AS (
       SELECT r.activity_type,
              CASE WHEN $3::float8 * 1000 <= r.length_m + $4 AND $2::float8 * 1000 < r.length_m
                THEN ST_Transform(ST_LineSubstring(ST_Transform(r.geom, 3857),
                       $2::float8 * 1000 / r.length_m, LEAST(1, $3::float8 * 1000 / r.length_m)), 4326)
              END AS line
       FROM routes r
       WHERE r.id = $1 AND r.deleted_at IS NULL
     )
     SELECT ${LINE_COLUMNS} FROM cut`,
    [routeId, startKm, endKm, ROUTE_END_TOLERANCE_M],
  )
  return lineResult(result.rows[0])
}

export const insertSegment = async (
  user: string,
  input: {
    name: string
    activity_type: string
    wkt: string
    created_from_activity_id?: string
    created_from_route_id?: string
  },
): Promise<string> => {
  const result = await query(
    user,
    `INSERT INTO segments (name, activity_type, geom, buffer, length_m, created_from_activity_id, created_from_route_id)
     SELECT $1, $2, g, ST_Buffer(g::geography, $3)::geometry, ST_Length(g::geography), $4, $5
     FROM (SELECT ST_GeomFromText($6, 4326) AS g) s
     RETURNING id`,
    [
      input.name,
      input.activity_type,
      SEGMENT_BUFFER_M,
      input.created_from_activity_id ?? null,
      input.created_from_route_id ?? null,
      input.wkt,
    ],
  )
  return result.rows[0]!.id as string
}

/**
 * The efforts of the segments `segmentFilter` keeps (a condition on `se`), with their
 * activities' times. A pass recorded by several sources (the Garmin and Strava rows of
 * one session, or two tracks of one row) overlaps in time and is kept once: the
 * non-approximate one, then the earliest activity. `rank` orders a segment's kept
 * efforts by elapsed time; `is_best` is the fastest non-approximate one, else the fastest.
 */
const rankedEfforts = (segmentFilter: string): string => `
  WITH e AS (
    SELECT se.segment_id, se.activity_id, se.source, se.start_offset_s, se.elapsed_s, se.avg_hr,
           se.pace_s_per_km, se.approximate, a.start_time AS activity_start_time,
           a.start_time + se.start_offset_s * INTERVAL '1 second' AS t0,
           a.start_time + (se.start_offset_s + se.elapsed_s) * INTERVAL '1 second' AS t1
    FROM segment_efforts se
    JOIN activities a ON a.id = se.activity_id AND a.deleted_at IS NULL
    WHERE ${segmentFilter}
  ),
  kept AS (
    SELECT e.* FROM e
    WHERE NOT EXISTS (
      SELECT 1 FROM e o
      WHERE o.segment_id = e.segment_id
        AND (o.activity_id, o.source) <> (e.activity_id, e.source)
        AND o.t0 < e.t1 AND o.t1 > e.t0
        AND (o.approximate, o.activity_start_time, o.activity_id, o.source)
          < (e.approximate, e.activity_start_time, e.activity_id, e.source)
    )
  ),
  ranked AS (
    SELECT kept.*,
           RANK() OVER (PARTITION BY kept.segment_id ORDER BY kept.elapsed_s) AS rank,
           ROW_NUMBER() OVER (PARTITION BY kept.segment_id ORDER BY kept.approximate, kept.elapsed_s, kept.t0) = 1 AS is_best
    FROM kept
  )`

const mapEffortRow = (row: QueryResultRow): SegmentEffortRow => ({
  activity_id: row.activity_id as string,
  activity_start_time: row.activity_start_time as Date,
  approximate: row.approximate as boolean,
  avg_hr: row.avg_hr == null ? null : Number(row.avg_hr),
  elapsed_s: Number(row.elapsed_s),
  is_best: row.is_best as boolean,
  pace_s_per_km: row.pace_s_per_km == null ? null : Number(row.pace_s_per_km),
  rank: Number(row.rank),
  segment_id: row.segment_id as string,
  source: row.source as string,
  start_offset_s: Number(row.start_offset_s),
})

const segmentSelect = (segmentFilter: string): string => `
  ${rankedEfforts(segmentFilter)}
  SELECT s.id, s.name, s.activity_type, s.length_m, s.created_from_activity_id, s.created_from_route_id,
         s.created_at, s.updated_at,
         COALESCE(st.n, 0) AS effort_count, st.best AS best_elapsed_s, st.last AS last_effort_at
  FROM segments s
  LEFT JOIN (
    SELECT segment_id, COUNT(*)::int AS n, MAX(elapsed_s) FILTER (WHERE is_best) AS best, MAX(t0) AS last
    FROM ranked
    GROUP BY segment_id
  ) st ON st.segment_id = s.id`

const mapSegmentRow = (row: QueryResultRow): SegmentRecord => ({
  activity_type: row.activity_type as string,
  best_elapsed_s: row.best_elapsed_s == null ? null : Number(row.best_elapsed_s),
  created_at: row.created_at as Date,
  created_from_activity_id: (row.created_from_activity_id as string | null) ?? null,
  created_from_route_id: (row.created_from_route_id as string | null) ?? null,
  effort_count: Number(row.effort_count),
  id: row.id as string,
  last_effort_at: (row.last_effort_at as Date | null) ?? null,
  length_m: Number(row.length_m),
  name: row.name as string,
  updated_at: row.updated_at as Date,
})

const SEGMENT_ORDER_BY: Record<SegmentSort, string> = {
  alphabetical: 'LOWER(s.name) ASC',
  efforts: 'COALESCE(st.n, 0) DESC, st.last DESC NULLS LAST',
  last_effort: 'st.last DESC NULLS LAST',
  length: 's.length_m DESC',
}

export const listSegments = async (
  user: string,
  options: { activityTypes?: string[]; sort?: SegmentSort } = {},
): Promise<SegmentRecord[]> => {
  const { activityTypes, sort = 'last_effort' } = options
  if (activityTypes?.length === 0) return []
  const result = await query(
    user,
    `${segmentSelect('true')}
     ${activityTypes ? 'WHERE s.activity_type = ANY($1::text[])' : ''}
     ORDER BY ${SEGMENT_ORDER_BY[sort]}, s.created_at DESC, s.id`,
    activityTypes ? [activityTypes] : [],
  )
  return result.rows.map(mapSegmentRow)
}

export const getSegmentById = async (user: string, id: string): Promise<SegmentRecord | null> => {
  const result = await query(user, `${segmentSelect('se.segment_id = $1')} WHERE s.id = $1`, [id])
  return result.rows[0] ? mapSegmentRow(result.rows[0]) : null
}

export const getSegmentLine = async (
  user: string,
  id: string,
): Promise<{ points: LatLon[]; length_m: number } | null> => {
  const result = await query(
    user,
    `SELECT ST_AsGeoJSON(geom) AS geojson, length_m FROM segments WHERE id = $1`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  const { coordinates } = JSON.parse(row.geojson as string) as { coordinates: [number, number][] }
  return { length_m: Number(row.length_m), points: coordinates.map(([lon, lat]) => ({ lat, lon })) }
}

export const updateSegment = async (
  user: string,
  id: string,
  { name }: { name: string },
): Promise<SegmentRecord | null> => {
  const result = await query(
    user,
    `UPDATE segments SET name = $2, updated_at = NOW() WHERE id = $1 RETURNING id`,
    [id, name],
  )
  if (result.rows.length === 0) return null
  return getSegmentById(user, id)
}

export const deleteSegment = async (user: string, id: string): Promise<boolean> => {
  const result = await query(user, `DELETE FROM segments WHERE id = $1`, [id])
  return (result.rowCount ?? 0) > 0
}

/** The segment's kept efforts (see rankedEfforts), newest first. */
export const listSegmentEfforts = async (user: string, segmentId: string): Promise<SegmentEffortRow[]> => {
  const result = await query(
    user,
    `${rankedEfforts('se.segment_id = $1')}
     SELECT * FROM ranked ORDER BY t0 DESC, activity_id, source`,
    [segmentId],
  )
  return result.rows.map(mapEffortRow)
}

/** The kept efforts of any of the activities, ranked among their segments' efforts, in time order. */
export const listActivitySegmentEfforts = async (
  user: string,
  activityIds: string[],
): Promise<ActivitySegmentEffortRow[]> => {
  if (activityIds.length === 0) return []
  const result = await query(
    user,
    `${rankedEfforts('se.segment_id IN (SELECT x.segment_id FROM segment_efforts x WHERE x.activity_id = ANY($1::uuid[]))')}
     SELECT ranked.*, s.name AS segment_name
     FROM ranked
     JOIN segments s ON s.id = ranked.segment_id
     WHERE ranked.activity_id = ANY($1::uuid[])
     ORDER BY ranked.t0, s.name`,
    [activityIds],
  )
  return result.rows.map((row) => ({ ...mapEffortRow(row), segment_name: row.segment_name as string }))
}

/**
 * Segments of the activity's type that each of its tracks covers: at least 90 % of the
 * segment within the track's 25 m buffer (the track clipped to near the segment first).
 */
export const findSegmentCandidatesForActivity = async (
  user: string,
  activityId: string,
): Promise<{ segment_id: string; source: string }[]> => {
  const result = await query(
    user,
    `WITH t AS (
       SELECT t.source, t.simplified, ${effectiveType('a')} AS activity_type
       FROM activity_tracks t
       JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
       WHERE t.activity_id = $1
     )
     SELECT c.segment_id, c.source FROM (
       SELECT s.id AS segment_id, t.source,
              ST_Length(ST_Intersection(s.geom,
                ST_Buffer(ST_Intersection(t.simplified, ST_Expand(s.geom, $3))::geography, $2)::geometry)::geography)
                / NULLIF(s.length_m, 0) AS coverage
       FROM t
       JOIN segments s ON s.activity_type = t.activity_type AND s.geom && ST_Expand(t.simplified, $3)
     ) c
     WHERE c.coverage >= $4
     ORDER BY c.segment_id, c.source`,
    [activityId, SEGMENT_BUFFER_M, BBOX_EXPAND_DEG, SEGMENT_COVERAGE_THRESHOLD],
  )
  return result.rows.map((row) => ({ segment_id: row.segment_id as string, source: row.source as string }))
}

/** Tracks of non-deleted activities of the segment's type that cover it (the same test as above). */
export const findTrackCandidatesForSegment = async (
  user: string,
  segmentId: string,
): Promise<{ activity_id: string; source: string }[]> => {
  const result = await query(
    user,
    `WITH s AS (SELECT id, geom, length_m, activity_type FROM segments WHERE id = $1)
     SELECT c.activity_id, c.source FROM (
       SELECT t.activity_id, t.source,
              ST_Length(ST_Intersection(s.geom,
                ST_Buffer(ST_Intersection(t.simplified, ST_Expand(s.geom, $3))::geography, $2)::geometry)::geography)
                / NULLIF(s.length_m, 0) AS coverage
       FROM s
       JOIN activity_tracks t ON t.simplified && ST_Expand(s.geom, $3)
       JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
                         AND ${effectiveType('a')} = s.activity_type
     ) c
     WHERE c.coverage >= $4
     ORDER BY c.activity_id, c.source`,
    [segmentId, SEGMENT_BUFFER_M, BBOX_EXPAND_DEG, SEGMENT_COVERAGE_THRESHOLD],
  )
  return result.rows.map((row) => ({ activity_id: row.activity_id as string, source: row.source as string }))
}

/** One track's points with `t` in seconds since the activity's start. */
export const getTimingTrack = async (
  user: string,
  activityId: string,
  source: string,
): Promise<TimingTrack | null> => {
  const result = await query(
    user,
    `SELECT t.activity_id, t.source, a.start_time, t.full_resolution,
            (SELECT json_agg(json_build_array(ST_Y(d.geom), ST_X(d.geom), ST_M(d.geom)) ORDER BY d.path)
               FROM ST_DumpPoints(t.geom) d) AS coords
     FROM activity_tracks t
     JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
     WHERE t.activity_id = $1 AND t.source = $2`,
    [activityId, source],
  )
  const row = result.rows[0]
  if (!row) return null
  const coords = (row.coords ?? []) as [number, number, number][]
  return {
    activity_id: row.activity_id as string,
    full_resolution: row.full_resolution as boolean,
    points: coords.map(([lat, lon, t]) => ({ lat, lon, t })),
    source: row.source as string,
    start_time: row.start_time as Date,
  }
}

/**
 * Replaces, in one transaction, the efforts in `scope` (a segment's, an activity's, or
 * one activity's on one segment) with `rows`.
 */
export const replaceSegmentEfforts = async (
  user: string,
  scope: { segment_id?: string; activity_id?: string },
  rows: SegmentEffortInput[],
): Promise<void> => {
  if (!scope.segment_id && !scope.activity_id) throw new Error('replaceSegmentEfforts needs a scope')
  await withUserTransaction(user, async (tx) => {
    await query(
      tx,
      `DELETE FROM segment_efforts
       WHERE ($1::uuid IS NULL OR segment_id = $1) AND ($2::uuid IS NULL OR activity_id = $2)`,
      [scope.segment_id ?? null, scope.activity_id ?? null],
    )
    if (rows.length === 0) return
    await query(
      tx,
      `INSERT INTO segment_efforts
         (segment_id, activity_id, source, start_offset_s, elapsed_s, avg_hr, pace_s_per_km, approximate)
       SELECT * FROM UNNEST($1::uuid[], $2::uuid[], $3::varchar[], $4::float8[], $5::float8[], $6::float8[],
                            $7::float8[], $8::boolean[])
       ON CONFLICT DO NOTHING`,
      [
        rows.map((r) => r.segment_id),
        rows.map((r) => r.activity_id),
        rows.map((r) => r.source),
        rows.map((r) => r.start_offset_s),
        rows.map((r) => r.elapsed_s),
        rows.map((r) => r.avg_hr),
        rows.map((r) => r.pace_s_per_km),
        rows.map((r) => r.approximate),
      ],
    )
  })
}
