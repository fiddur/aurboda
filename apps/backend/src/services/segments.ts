import type {
  ActivitySegmentEffort,
  CreateSegmentBody,
  Segment,
  SegmentDetail,
  SegmentEffort,
  SegmentMatchResult,
  SegmentsQuery,
} from '@aurboda/api-spec'

import type { LatLon } from '../db/routes.ts'
import type {
  ActivitySegmentEffortRow,
  SegmentEffortInput,
  SegmentEffortRow,
  SegmentLine,
  SegmentLineResult,
  SegmentRecord,
  TimingTrack,
} from '../db/segments.ts'

import { expandActivityTypes } from '../db/activity-type-definitions.ts'
import { findNearbyNamedLocation } from '../db/locations.ts'
import {
  deleteSegment,
  findSegmentCandidatesForActivity,
  findTrackCandidatesForSegment,
  getSegmentById,
  getSegmentLine,
  getTimingTrack,
  insertSegment,
  listActivitySegmentEfforts,
  listSegmentEfforts,
  listSegments,
  replaceSegmentEfforts,
  SEGMENT_BUFFER_M,
  segmentLineFromActivity,
  segmentLineFromRoute,
  updateSegment,
} from '../db/segments.ts'
import { getMetricMeansForWindows } from '../db/time-series.ts'
import { auditError } from './audit-log.ts'
import { haversineDistance } from './locations.ts'
import { findSegmentPasses } from './segment-timing.ts'

export const MIN_SEGMENT_LENGTH_M = 100
/** Twice the buffer: closer ends put a point near the end onto the first edge, so no pass is ever timed. */
export const MIN_SEGMENT_END_GAP_M = 2 * SEGMENT_BUFFER_M
const NAMING_RADIUS_M = 500
/** Keeps the name inside segments.name's VARCHAR(255) whatever the place is called. */
const MAX_PLACE_CHARS = 200

export const segmentName = (nearby: { name: string } | null, lengthM: number): string =>
  `${(nearby?.name ?? 'Segment').slice(0, MAX_PLACE_CHARS)} · ${(lengthM / 1000).toFixed(1)} km`

export interface SegmentDeps {
  segmentLineFromActivity: (
    user: string,
    activityId: string,
    startOffsetS: number,
    endOffsetS: number,
  ) => Promise<SegmentLineResult>
  segmentLineFromRoute: (
    user: string,
    routeId: string,
    startKm: number,
    endKm: number,
  ) => Promise<SegmentLineResult>
  insertSegment: (
    user: string,
    input: {
      name: string
      activity_type: string
      wkt: string
      created_from_activity_id?: string
      created_from_route_id?: string
    },
  ) => Promise<string>
  findNearbyNamedLocation: (
    user: string,
    lat: number,
    lon: number,
    distanceM: number,
  ) => Promise<{ name: string } | null>
  getSegmentById: (user: string, id: string) => Promise<SegmentRecord | null>
  getSegmentLine: (user: string, id: string) => Promise<{ points: LatLon[]; length_m: number } | null>
  listSegmentEfforts: (user: string, segmentId: string) => Promise<SegmentEffortRow[]>
  findSegmentCandidatesForActivity: (
    user: string,
    activityId: string,
  ) => Promise<{ segment_id: string; source: string }[]>
  findTrackCandidatesForSegment: (
    user: string,
    segmentId: string,
  ) => Promise<{ activity_id: string; source: string }[]>
  getTimingTrack: (user: string, activityId: string, source: string) => Promise<TimingTrack | null>
  replaceSegmentEfforts: (
    user: string,
    scope: { segment_id?: string; activity_id?: string },
    rows: SegmentEffortInput[],
  ) => Promise<void>
  getMetricMeansForWindows: (
    user: string,
    metric: string,
    windows: { start: Date; end: Date }[],
  ) => Promise<(number | undefined)[]>
}

export const defaultSegmentDeps: SegmentDeps = {
  findNearbyNamedLocation,
  findSegmentCandidatesForActivity,
  findTrackCandidatesForSegment,
  getMetricMeansForWindows,
  getSegmentById,
  getSegmentLine,
  getTimingTrack,
  insertSegment,
  listSegmentEfforts,
  replaceSegmentEfforts,
  segmentLineFromActivity,
  segmentLineFromRoute,
}

const round1 = (value: number): number => Math.round(value * 10) / 10

/** Every pass of the track over the segment, with the mean heart rate in each and the pace over the segment. */
export const timeTrackOnSegment = async (
  user: string,
  segment: { id: string; points: LatLon[]; length_m: number },
  track: TimingTrack,
  deps: Pick<SegmentDeps, 'getMetricMeansForWindows'>,
): Promise<SegmentEffortInput[]> => {
  const passes = findSegmentPasses(track.points, segment.points, { bufferM: SEGMENT_BUFFER_M })
  if (passes.length === 0) return []
  const startMs = track.start_time.getTime()
  const hr = await deps.getMetricMeansForWindows(
    user,
    'heart_rate',
    passes.map((p) => ({
      end: new Date(startMs + (p.start_offset_s + p.elapsed_s) * 1000),
      start: new Date(startMs + p.start_offset_s * 1000),
    })),
  )
  return passes.map((pass, i) => {
    const avgHr = hr[i]
    return {
      activity_id: track.activity_id,
      approximate: !track.full_resolution,
      avg_hr: avgHr === undefined ? null : round1(avgHr),
      elapsed_s: pass.elapsed_s,
      pace_s_per_km: round1(pass.elapsed_s / (segment.length_m / 1000)),
      segment_id: segment.id,
      source: track.source,
      start_offset_s: pass.start_offset_s,
    }
  })
}

/**
 * Times every track of the activity on every segment of its type it covers, replacing
 * all of the activity's efforts: a segment it no longer covers (a rewritten track, a
 * new type) loses them.
 */
export const matchActivitySegments = async (
  user: string,
  activityId: string,
  deps: SegmentDeps,
): Promise<{ efforts: number }> => {
  const candidates = await deps.findSegmentCandidatesForActivity(user, activityId)
  const tracks = new Map<string, TimingTrack | null>()
  const segments = new Map<string, { points: LatLon[]; length_m: number } | null>()
  const rows: SegmentEffortInput[] = []
  for (const { segment_id, source } of candidates) {
    if (!tracks.has(source)) tracks.set(source, await deps.getTimingTrack(user, activityId, source))
    if (!segments.has(segment_id)) segments.set(segment_id, await deps.getSegmentLine(user, segment_id))
    const track = tracks.get(source)
    const line = segments.get(segment_id)
    if (track && line) {
      rows.push(...(await timeTrackOnSegment(user, { id: segment_id, ...line }, track, deps)))
    }
  }
  await deps.replaceSegmentEfforts(user, { activity_id: activityId }, rows)
  return { efforts: rows.length }
}

/** Times every covering track on the segment, replacing its efforts; null for an unknown segment. */
export const matchSegment = async (
  user: string,
  segmentId: string,
  deps: SegmentDeps,
): Promise<SegmentMatchResult | null> => {
  const line = await deps.getSegmentLine(user, segmentId)
  if (!line) return null
  const rows: SegmentEffortInput[] = []
  for (const { activity_id, source } of await deps.findTrackCandidatesForSegment(user, segmentId)) {
    const track = await deps.getTimingTrack(user, activity_id, source)
    if (track) rows.push(...(await timeTrackOnSegment(user, { id: segmentId, ...line }, track, deps)))
  }
  await deps.replaceSegmentEfforts(user, { segment_id: segmentId }, rows)
  return { activities: new Set(rows.map((r) => r.activity_id)).size, efforts: rows.length }
}

/** After a retype: each activity's efforts are dropped and its tracks timed again under the new type. */
export const rematchActivitySegments = async (
  user: string,
  activityIds: string[],
  deps: SegmentDeps,
): Promise<void> => {
  for (const activityId of activityIds) {
    try {
      await matchActivitySegments(user, activityId, deps)
    } catch (error) {
      auditError(user, 'data', `Segment re-matching failed for activity ${activityId}`, {
        error: String(error),
      })
    }
  }
}

export const serializeSegment = (segment: SegmentRecord): Segment => ({
  activity_type: segment.activity_type,
  best_elapsed_s: segment.best_elapsed_s,
  created_at: segment.created_at.toISOString(),
  effort_count: segment.effort_count,
  id: segment.id,
  last_effort_at: segment.last_effort_at?.toISOString() ?? null,
  length_m: segment.length_m,
  name: segment.name,
  updated_at: segment.updated_at.toISOString(),
})

const serializeEffort = (row: SegmentEffortRow): SegmentEffort => ({
  activity_id: row.activity_id,
  activity_start_time: row.activity_start_time.toISOString(),
  approximate: row.approximate,
  avg_hr: row.avg_hr,
  elapsed_s: row.elapsed_s,
  is_best: row.is_best,
  pace_s_per_km: row.pace_s_per_km ?? 0,
  start_offset_s: row.start_offset_s,
})

export const serializeActivitySegmentEffort = (row: ActivitySegmentEffortRow): ActivitySegmentEffort => ({
  approximate: row.approximate,
  avg_hr: row.avg_hr,
  elapsed_s: row.elapsed_s,
  is_best: row.is_best,
  pace_s_per_km: row.pace_s_per_km ?? 0,
  rank: row.rank,
  segment_id: row.segment_id,
  segment_name: row.segment_name,
  start_offset_s: row.start_offset_s,
})

export const getSegmentDetail = async (
  user: string,
  segmentId: string,
  deps: SegmentDeps,
): Promise<SegmentDetail | null> => {
  const segment = await deps.getSegmentById(user, segmentId)
  if (!segment) return null
  const [line, efforts] = await Promise.all([
    deps.getSegmentLine(user, segmentId),
    deps.listSegmentEfforts(user, segmentId),
  ])
  const points = line?.points ?? []
  const nameAt = async (point: LatLon | undefined): Promise<string | null> =>
    point
      ? ((await deps.findNearbyNamedLocation(user, point.lat, point.lon, NAMING_RADIUS_M))?.name ?? null)
      : null
  const [start, end] = await Promise.all([nameAt(points[0]), nameAt(points.at(-1))])
  return {
    ...serializeSegment(segment),
    created_from_activity_id: segment.created_from_activity_id,
    created_from_route_id: segment.created_from_route_id,
    efforts: efforts.map(serializeEffort),
    near_named_location: { end, start },
    points,
  }
}

export type CreateSegmentResult = { ok: true; segment: SegmentDetail } | { ok: false; error: string }

const LINE_ERRORS = {
  activity: {
    not_found: 'The activity has no GPS track',
    out_of_range: "start_offset_s and end_offset_s must lie within the activity's track",
  },
  route: {
    not_found: 'Route not found (or deleted)',
    out_of_range: 'start_km and end_km must lie within the route',
  },
} as const

/** Cuts the line from an activity's track (seconds since its start) or a route (km) and creates the segment from it. */
export const createSegment = async (
  user: string,
  body: CreateSegmentBody,
  deps: SegmentDeps,
): Promise<CreateSegmentResult> => {
  const fromActivity = body.activity_id !== undefined
  let result: SegmentLineResult
  if (
    body.activity_id !== undefined &&
    body.start_offset_s !== undefined &&
    body.end_offset_s !== undefined
  ) {
    result = await deps.segmentLineFromActivity(
      user,
      body.activity_id,
      body.start_offset_s,
      body.end_offset_s,
    )
  } else if (body.route_id !== undefined && body.start_km !== undefined && body.end_km !== undefined) {
    result = await deps.segmentLineFromRoute(user, body.route_id, body.start_km, body.end_km)
  } else {
    return {
      error: 'Give either activity_id, start_offset_s and end_offset_s, or route_id, start_km and end_km',
      ok: false,
    }
  }
  if (!result.ok) return { error: LINE_ERRORS[fromActivity ? 'activity' : 'route'][result.reason], ok: false }
  return createSegmentFromLine(
    user,
    result.line,
    {
      name: body.name,
      ...(fromActivity
        ? { created_from_activity_id: body.activity_id }
        : { created_from_route_id: body.route_id }),
    },
    deps,
  )
}

/**
 * What creating a segment does once it has its line: refuses one under 100 m or with its ends
 * closer than 50 m, names it after the nearest named place when no name is given, stores it and
 * times every tracked activity of its type on it before returning it.
 */
export const createSegmentFromLine = async (
  user: string,
  line: SegmentLine,
  origin: { name?: string; created_from_activity_id?: string; created_from_route_id?: string },
  deps: SegmentDeps,
): Promise<CreateSegmentResult> => {
  if (line.length_m < MIN_SEGMENT_LENGTH_M) {
    return {
      error: `A segment must be at least ${MIN_SEGMENT_LENGTH_M} m long (this one is ${Math.round(line.length_m)} m)`,
      ok: false,
    }
  }
  if (haversineDistance(line.start.lat, line.start.lon, line.end.lat, line.end.lon) < MIN_SEGMENT_END_GAP_M) {
    return {
      error: `A segment's start and end must be at least ${MIN_SEGMENT_END_GAP_M} m apart: a closed loop cannot be timed.`,
      ok: false,
    }
  }
  const nearby = origin.name
    ? null
    : await deps.findNearbyNamedLocation(user, line.start.lat, line.start.lon, NAMING_RADIUS_M)
  const id = await deps.insertSegment(user, {
    activity_type: line.activity_type,
    name: origin.name ?? segmentName(nearby, line.length_m),
    wkt: line.wkt,
    ...(origin.created_from_activity_id ? { created_from_activity_id: origin.created_from_activity_id } : {}),
    ...(origin.created_from_route_id ? { created_from_route_id: origin.created_from_route_id } : {}),
  })
  await matchSegment(user, id, deps)
  const segment = await getSegmentDetail(user, id, deps)
  if (!segment) return { error: 'The segment was deleted while it was being created', ok: false }
  return { ok: true, segment }
}

export interface SegmentOps {
  list: (user: string, query: SegmentsQuery) => Promise<Segment[]>
  detail: (user: string, id: string) => Promise<SegmentDetail | null>
  create: (user: string, body: CreateSegmentBody) => Promise<CreateSegmentResult>
  rename: (user: string, id: string, name: string) => Promise<Segment | null>
  remove: (user: string, id: string) => Promise<boolean>
  match: (user: string, id: string) => Promise<SegmentMatchResult | null>
}

export const defaultSegmentOps: SegmentOps = {
  create: (user, body) => createSegment(user, body, defaultSegmentDeps),
  detail: (user, id) => getSegmentDetail(user, id, defaultSegmentDeps),
  list: async (user, { activity_type, sort }) => {
    const activityTypes = activity_type ? await expandActivityTypes(user, [activity_type]) : undefined
    return (await listSegments(user, { activityTypes, sort })).map(serializeSegment)
  },
  match: (user, id) => matchSegment(user, id, defaultSegmentDeps),
  remove: deleteSegment,
  rename: async (user, id, name) => {
    const segment = await updateSegment(user, id, { name })
    return segment ? serializeSegment(segment) : null
  },
}

/** The segment efforts of an activity's rows (a merged view's sources, an override's targets); undefined when none. */
export const activitySegmentEfforts = async (
  user: string,
  activityIds: string[],
): Promise<ActivitySegmentEffort[] | undefined> => {
  const rows = await listActivitySegmentEfforts(user, activityIds)
  return rows.length > 0 ? rows.map(serializeActivitySegmentEffort) : undefined
}
