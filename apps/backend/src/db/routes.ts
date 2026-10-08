import type { QueryResultRow } from 'pg'

import { query, withUserTransaction } from './connection.ts'

export interface LatLon {
  lat: number
  lon: number
}

export interface RouteRecord {
  id: string
  name: string
  activity_type: string
  length_m: number
  start: LatLon
  end: LatLon
  canonical_activity_id: string | null
  activity_count: number
  last_activity_at: Date | null
  created_at: Date
  updated_at: Date
}

export interface RouteCandidate {
  route_id: string
  coverage_track: number
  coverage_route: number
}

export interface TrackPairCandidate {
  activity_id: string
  start_time: Date
  coverage_track: number
  coverage_route: number
}

export interface RouteEffortRow {
  activity_id: string
  start_time: Date
  end_time: Date | null
  title: string | null
  source: string
  coverage: number
  data_distance?: number
}

export interface TrackedActivity {
  activity_id: string
  start_time: Date
}

/** Buffer around a line, in metres, for coverage and direction tests. */
export const ROUTE_BUFFER_M = 25

/** Degrees added around a track's bbox when looking for candidates (~100–200 m). */
const BBOX_EXPAND_DEG = 0.002

/** The activity's preferred track (as getActivityTrack picks it), with the activity's type. */
const preferredTrack = (activityParam: string): string => `
  SELECT t.activity_id, t.simplified, a.activity_type, a.start_time, COALESCE(a.end_time, a.start_time) AS end_time
  FROM activity_tracks t
  JOIN activities a ON a.id = t.activity_id AND a.deleted_at IS NULL
  WHERE t.activity_id = ${activityParam}
  ORDER BY t.full_resolution DESC, t.point_count DESC, t.source
  LIMIT 1`

/**
 * The attached, non-deleted activities of each route, one per run: a run recorded
 * by several sources (Garmin and Strava rows of the same session) overlaps in time,
 * and only its earliest row counts.
 */
const ROUTE_RUNS = `
  SELECT ar.route_id, ar.coverage, a.id AS activity_id, a.start_time, a.end_time, a.title, a.source, a.data
  FROM activity_routes ar
  JOIN activities a ON a.id = ar.activity_id AND a.deleted_at IS NULL
  WHERE NOT EXISTS (
    SELECT 1
    FROM activity_routes ar2
    JOIN activities a2 ON a2.id = ar2.activity_id AND a2.deleted_at IS NULL
    WHERE ar2.route_id = ar.route_id
      AND ar2.activity_id <> ar.activity_id
      AND a2.start_time < COALESCE(a.end_time, a.start_time)
      AND COALESCE(a2.end_time, a2.start_time) > a.start_time
      AND (a2.start_time, a2.id) < (a.start_time, a.id)
  )`

const ROUTE_SELECT = `
  SELECT r.id, r.name, r.activity_type, r.length_m,
         ST_Y(r.start_pt::geometry) AS start_lat, ST_X(r.start_pt::geometry) AS start_lon,
         ST_Y(r.end_pt::geometry) AS end_lat, ST_X(r.end_pt::geometry) AS end_lon,
         r.canonical_activity_id, r.created_at, r.updated_at,
         COALESCE(s.n, 0) AS activity_count, s.last AS last_activity_at
  FROM routes r
  LEFT JOIN LATERAL (
    SELECT COUNT(*)::int AS n, MAX(runs.start_time) AS last
    FROM (${ROUTE_RUNS}) runs
    WHERE runs.route_id = r.id
  ) s ON true
  WHERE r.deleted_at IS NULL`

const mapRouteRow = (row: QueryResultRow): RouteRecord => ({
  activity_count: Number(row.activity_count),
  activity_type: row.activity_type as string,
  canonical_activity_id: (row.canonical_activity_id as string | null) ?? null,
  created_at: row.created_at as Date,
  end: { lat: Number(row.end_lat), lon: Number(row.end_lon) },
  id: row.id as string,
  last_activity_at: (row.last_activity_at as Date | null) ?? null,
  length_m: Number(row.length_m),
  name: row.name as string,
  start: { lat: Number(row.start_lat), lon: Number(row.start_lon) },
  updated_at: row.updated_at as Date,
})

export const listRoutes = async (user: string): Promise<RouteRecord[]> => {
  const result = await query(
    user,
    `${ROUTE_SELECT}
     ORDER BY s.last DESC NULLS LAST, r.created_at DESC`,
  )
  return result.rows.map(mapRouteRow)
}

export const getRouteById = async (user: string, id: string): Promise<RouteRecord | null> => {
  const result = await query(user, `${ROUTE_SELECT} AND r.id = $1`, [id])
  return result.rows[0] ? mapRouteRow(result.rows[0]) : null
}

/** The route the activity is attached to, when the activity is not deleted. */
export const getRouteForActivity = async (user: string, activityId: string): Promise<RouteRecord | null> => {
  const result = await query(
    user,
    `${ROUTE_SELECT}
     AND r.id = (
       SELECT ar.route_id FROM activity_routes ar
       JOIN activities a ON a.id = ar.activity_id AND a.deleted_at IS NULL
       WHERE ar.activity_id = $1
     )`,
    [activityId],
  )
  return result.rows[0] ? mapRouteRow(result.rows[0]) : null
}

export const getRouteGeometry = async (user: string, id: string): Promise<{ points: LatLon[] } | null> => {
  const result = await query(
    user,
    `SELECT ST_AsGeoJSON(geom) AS geojson FROM routes WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  const row = result.rows[0]
  if (!row) return null
  const { coordinates } = JSON.parse(row.geojson as string) as { coordinates: [number, number][] }
  return { points: coordinates.map(([lon, lat]) => ({ lat, lon })) }
}

const toCoverage = (value: unknown): number => (value == null ? 0 : Number(value))

/**
 * Routes of the activity's own type whose bbox is near its track, with the share of
 * the track inside the route's buffer and of the route inside the track's, best
 * match (the higher of the two lower shares) first.
 */
export const findRouteCandidates = async (user: string, activityId: string): Promise<RouteCandidate[]> => {
  const result = await query(
    user,
    `WITH t AS (${preferredTrack('$1')})
     SELECT * FROM (
       SELECT r.id AS route_id,
              ST_Length(ST_Intersection(t.simplified, r.buffer)::geography)
                / NULLIF(ST_Length(t.simplified::geography), 0) AS coverage_track,
              ST_Length(ST_Intersection(r.geom, ST_Buffer(t.simplified::geography, $2)::geometry)::geography)
                / NULLIF(ST_Length(r.geom::geography), 0) AS coverage_route
       FROM t
       JOIN routes r ON r.activity_type = t.activity_type AND r.deleted_at IS NULL
                     AND r.geom && ST_Expand(t.simplified, $3)
     ) c
     ORDER BY LEAST(c.coverage_track, c.coverage_route) DESC NULLS LAST, c.route_id`,
    [activityId, ROUTE_BUFFER_M, BBOX_EXPAND_DEG],
  )
  return result.rows.map((row) => ({
    coverage_route: toCoverage(row.coverage_route),
    coverage_track: toCoverage(row.coverage_track),
    route_id: row.route_id as string,
  }))
}

/**
 * Tracks of other unrouted, non-deleted activities of the same type near the
 * activity's track, with both coverages, best match first. A row overlapping the
 * activity in time is the same session from another source, never a second run.
 */
export const findUnroutedTrackCandidates = async (
  user: string,
  activityId: string,
): Promise<TrackPairCandidate[]> => {
  const result = await query(
    user,
    `WITH t AS (${preferredTrack('$1')}),
     o AS (
       SELECT DISTINCT ON (t2.activity_id) t2.activity_id, a2.start_time, t2.simplified
       FROM t
       JOIN activity_tracks t2 ON t2.simplified && ST_Expand(t.simplified, $3) AND t2.activity_id <> t.activity_id
       JOIN activities a2 ON a2.id = t2.activity_id AND a2.deleted_at IS NULL AND a2.activity_type = t.activity_type
       WHERE NOT EXISTS (SELECT 1 FROM activity_routes ar WHERE ar.activity_id = t2.activity_id)
         AND NOT (a2.start_time <= t.end_time AND COALESCE(a2.end_time, a2.start_time) >= t.start_time)
       ORDER BY t2.activity_id, t2.full_resolution DESC, t2.point_count DESC, t2.source
     )
     SELECT * FROM (
       SELECT o.activity_id, o.start_time,
              ST_Length(ST_Intersection(t.simplified, ST_Buffer(o.simplified::geography, $2)::geometry)::geography)
                / NULLIF(ST_Length(t.simplified::geography), 0) AS coverage_track,
              ST_Length(ST_Intersection(o.simplified, ST_Buffer(t.simplified::geography, $2)::geometry)::geography)
                / NULLIF(ST_Length(o.simplified::geography), 0) AS coverage_route
       FROM t, o
     ) c
     ORDER BY LEAST(c.coverage_track, c.coverage_route) DESC NULLS LAST, c.start_time`,
    [activityId, ROUTE_BUFFER_M, BBOX_EXPAND_DEG],
  )
  return result.rows.map((row) => ({
    activity_id: row.activity_id as string,
    coverage_route: toCoverage(row.coverage_route),
    coverage_track: toCoverage(row.coverage_track),
    start_time: row.start_time as Date,
  }))
}

const DIRECTION_SAMPLES = 24

/**
 * Where each of 24 evenly spaced points along the activity's track falls along
 * `line` (0..1), in track order, for the points inside `area`.
 */
const directionFractions = async (
  user: string,
  activityId: string,
  lineAndArea: string,
  params: unknown[],
): Promise<number[]> => {
  const result = await query(
    user,
    `WITH t AS (${preferredTrack('$1')}),
     r AS (${lineAndArea}),
     p AS (
       SELECT k, ST_LineInterpolatePoint(t.simplified, k::float8 / ($2::int - 1)) AS pt
       FROM t, generate_series(0, $2::int - 1) AS k
     )
     SELECT ST_LineLocatePoint(r.line, p.pt) AS f
     FROM p, r
     WHERE ST_Covers(r.area, p.pt)
     ORDER BY p.k`,
    [activityId, DIRECTION_SAMPLES, ...params],
  )
  return result.rows.map((row) => Number(row.f))
}

export const routeDirectionFractions = (
  user: string,
  activityId: string,
  routeId: string,
): Promise<number[]> =>
  directionFractions(
    user,
    activityId,
    `SELECT geom AS line, buffer AS area FROM routes WHERE id = $3 AND deleted_at IS NULL`,
    [routeId],
  )

export const trackDirectionFractions = (
  user: string,
  activityId: string,
  otherActivityId: string,
): Promise<number[]> =>
  directionFractions(
    user,
    activityId,
    `SELECT o.simplified AS line, ST_Buffer(o.simplified::geography, $4)::geometry AS area
     FROM (${preferredTrack('$3')}) o`,
    [otherActivityId, ROUTE_BUFFER_M],
  )

/** A route whose geometry is the activity's preferred track; null when it has none. */
export const createRouteFromTrack = async (
  user: string,
  { activity_id, name }: { activity_id: string; name: string },
): Promise<string | null> => {
  const result = await query(
    user,
    `WITH t AS (${preferredTrack('$1')})
     INSERT INTO routes (name, activity_type, geom, buffer, length_m, start_pt, end_pt, canonical_activity_id)
     SELECT $2, t.activity_type, t.simplified, ST_Buffer(t.simplified::geography, $3)::geometry,
            ST_Length(t.simplified::geography),
            ST_StartPoint(t.simplified)::geography, ST_EndPoint(t.simplified)::geography, t.activity_id
     FROM t
     RETURNING id`,
    [activity_id, name, ROUTE_BUFFER_M],
  )
  return (result.rows[0]?.id as string | undefined) ?? null
}

/** Where the activity's preferred track starts and how long its simplified line is. */
export const getTrackSummary = async (
  user: string,
  activityId: string,
): Promise<{ start: LatLon; length_m: number } | null> => {
  const result = await query(
    user,
    `SELECT ST_Y(ST_StartPoint(t.simplified)) AS lat, ST_X(ST_StartPoint(t.simplified)) AS lon,
            ST_Length(t.simplified::geography) AS length_m
     FROM (${preferredTrack('$1')}) t`,
    [activityId],
  )
  const row = result.rows[0]
  return row
    ? { length_m: Number(row.length_m), start: { lat: Number(row.lat), lon: Number(row.lon) } }
    : null
}

export const attachActivityToRoute = async (
  user: string,
  activityId: string,
  routeId: string,
  coverage: number,
): Promise<void> => {
  await query(
    user,
    `INSERT INTO activity_routes (activity_id, route_id, coverage)
     VALUES ($1, $2, $3)
     ON CONFLICT (activity_id) DO NOTHING`,
    [activityId, routeId, coverage],
  )
}

export const isActivityRouted = async (user: string, activityId: string): Promise<boolean> => {
  const result = await query(user, `SELECT 1 FROM activity_routes WHERE activity_id = $1`, [activityId])
  return result.rows.length > 0
}

/** The activity when it is not deleted and has a track. */
export const getTrackedActivity = async (
  user: string,
  activityId: string,
): Promise<TrackedActivity | null> => {
  const result = await query(user, `SELECT t.activity_id, t.start_time FROM (${preferredTrack('$1')}) t`, [
    activityId,
  ])
  const row = result.rows[0]
  return row ? { activity_id: row.activity_id as string, start_time: row.start_time as Date } : null
}

export const updateRoute = async (
  user: string,
  id: string,
  { name }: { name: string },
): Promise<RouteRecord | null> => {
  const result = await query(
    user,
    `UPDATE routes SET name = $2, updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [id, name],
  )
  if (result.rows.length === 0) return null
  return getRouteById(user, id)
}

/**
 * Soft delete: the route's activity_routes rows stay, so its runs count as routed
 * and are never paired into a new route by the startup backfill.
 */
export const deleteRoute = async (user: string, id: string): Promise<boolean> => {
  const result = await query(
    user,
    `UPDATE routes SET deleted_at = NOW(), updated_at = NOW() WHERE id = $1 AND deleted_at IS NULL`,
    [id],
  )
  return (result.rowCount ?? 0) > 0
}

/**
 * Moves every activity of `sourceId` onto `targetId` and deletes the source; null
 * when either is missing or deleted, they are the same, or their types differ.
 */
export const mergeRoutes = async (user: string, sourceId: string, targetId: string): Promise<number | null> =>
  withUserTransaction(user, async (tx) => {
    const found = await query(
      tx,
      `SELECT id, activity_type FROM routes WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL FOR UPDATE`,
      [[sourceId, targetId]],
    )
    if (sourceId === targetId || found.rows.length !== 2) return null
    if (found.rows[0]!.activity_type !== found.rows[1]!.activity_type) return null
    const moved = await query(tx, `UPDATE activity_routes SET route_id = $2 WHERE route_id = $1`, [
      sourceId,
      targetId,
    ])
    await query(tx, `DELETE FROM routes WHERE id = $1`, [sourceId])
    await query(tx, `UPDATE routes SET updated_at = NOW() WHERE id = $1`, [targetId])
    return moved.rowCount ?? 0
  })

/** The route's runs, newest first (see ROUTE_RUNS for how a multi-source run counts once). */
export const listRouteEfforts = async (user: string, routeId: string): Promise<RouteEffortRow[]> => {
  const result = await query(
    user,
    `SELECT runs.activity_id, runs.start_time, runs.end_time, runs.title, runs.source, runs.coverage,
            CASE WHEN jsonb_typeof(runs.data->'distance') = 'number' THEN (runs.data->>'distance')::float8 END AS distance
     FROM (${ROUTE_RUNS}) runs
     JOIN routes r ON r.id = runs.route_id AND r.deleted_at IS NULL
     WHERE runs.route_id = $1
     ORDER BY runs.start_time DESC`,
    [routeId],
  )
  return result.rows.map((row) => ({
    activity_id: row.activity_id as string,
    coverage: Number(row.coverage),
    ...(row.distance == null ? {} : { data_distance: Number(row.distance) }),
    end_time: (row.end_time as Date | null) ?? null,
    source: row.source as string,
    start_time: row.start_time as Date,
    title: (row.title as string | null) ?? null,
  }))
}

/** Non-deleted activities with a track and no route, oldest first. */
export const listUnroutedTrackedActivities = async (user: string): Promise<TrackedActivity[]> => {
  const result = await query(
    user,
    `SELECT a.id, a.start_time
     FROM activities a
     WHERE a.deleted_at IS NULL
       AND EXISTS (SELECT 1 FROM activity_tracks t WHERE t.activity_id = a.id)
       AND NOT EXISTS (SELECT 1 FROM activity_routes ar WHERE ar.activity_id = a.id)
     ORDER BY a.start_time, a.id`,
  )
  return result.rows.map((row) => ({ activity_id: row.id as string, start_time: row.start_time as Date }))
}
