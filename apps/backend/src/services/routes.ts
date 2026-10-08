import type { MergeRoutesResult, Route, RouteDetail, RouteEffort, RouteMatchResult } from '@aurboda/api-spec'

import type {
  LatLon,
  RouteCandidate,
  RouteEffortRow,
  RouteRecord,
  TrackedActivity,
  TrackPairCandidate,
} from '../db/routes.ts'

import { findNearbyDetectedLocation, findNearbyNamedLocation } from '../db/locations.ts'
import {
  attachActivityToRoute,
  createRouteFromTrack,
  deleteRoute,
  findRouteCandidates,
  findUnroutedTrackCandidates,
  getRouteById,
  getRouteGeometry,
  getTrackedActivity,
  getTrackSummary,
  isActivityRouted,
  listRouteEfforts,
  listRoutes,
  listUnroutedTrackedActivities,
  mergeRoutes,
  routeDirectionFractions,
  trackDirectionFractions,
  updateRoute,
} from '../db/routes.ts'
import { getMetricMeansForWindows } from '../db/time-series.ts'
import { auditError } from './audit-log.ts'

export const COVERAGE_THRESHOLD = 0.9
const MIN_DIRECTION_SAMPLES = 4
const FORWARD_SHARE = 0.8
const NAMING_RADIUS_M = 500

/**
 * Whether the projections of a track's samples onto a line run forward. A loop
 * started elsewhere on it wraps once (one decreasing step); a reversed run
 * decreases at nearly every step.
 */
export const isForward = (fractions: number[]): boolean => {
  if (fractions.length < MIN_DIRECTION_SAMPLES) return false
  let increasing = 0
  for (let i = 1; i < fractions.length; i++) if (fractions[i]! > fractions[i - 1]!) increasing++
  return increasing >= FORWARD_SHARE * (fractions.length - 1)
}

export const routeName = (nearby: { name: string } | null, lengthM: number): string =>
  `${nearby?.name ?? 'Route'} · ${(lengthM / 1000).toFixed(1)} km`

export interface RouteMatchDeps {
  isActivityRouted: (user: string, activityId: string) => Promise<boolean>
  getTrackedActivity: (user: string, activityId: string) => Promise<TrackedActivity | null>
  findRouteCandidates: (user: string, activityId: string) => Promise<RouteCandidate[]>
  routeDirectionFractions: (user: string, activityId: string, routeId: string) => Promise<number[]>
  findUnroutedTrackCandidates: (user: string, activityId: string) => Promise<TrackPairCandidate[]>
  trackDirectionFractions: (user: string, activityId: string, otherActivityId: string) => Promise<number[]>
  getTrackSummary: (user: string, activityId: string) => Promise<{ start: LatLon; length_m: number } | null>
  findNearbyNamedLocation: (
    user: string,
    lat: number,
    lon: number,
    distanceM: number,
  ) => Promise<{ name: string } | null>
  findNearbyDetectedLocation: (
    user: string,
    lat: number,
    lon: number,
    distanceM: number,
  ) => Promise<{ address?: string | null } | null>
  createRouteFromTrack: (user: string, input: { activity_id: string; name: string }) => Promise<string | null>
  attachActivityToRoute: (
    user: string,
    activityId: string,
    routeId: string,
    coverage: number,
  ) => Promise<void>
  listUnroutedTrackedActivities: (user: string) => Promise<TrackedActivity[]>
}

export const defaultRouteMatchDeps: RouteMatchDeps = {
  attachActivityToRoute,
  createRouteFromTrack,
  findNearbyDetectedLocation,
  findNearbyNamedLocation,
  findRouteCandidates,
  findUnroutedTrackCandidates,
  getTrackedActivity,
  getTrackSummary,
  isActivityRouted,
  listUnroutedTrackedActivities,
  routeDirectionFractions,
  trackDirectionFractions,
}

export type RouteMatchOutcome = 'already_routed' | 'no_track' | 'matched' | 'created' | 'unmatched'

const covers = (c: { coverage_track: number; coverage_route: number }): boolean =>
  c.coverage_track >= COVERAGE_THRESHOLD && c.coverage_route >= COVERAGE_THRESHOLD

const coverageOf = (c: { coverage_track: number; coverage_route: number }): number =>
  Math.min(c.coverage_track, c.coverage_route)

/** Nearest named location to the start, else the first part of the nearest detected location's address. */
const nameNear = async (
  user: string,
  start: LatLon,
  deps: RouteMatchDeps,
): Promise<{ name: string } | null> => {
  const named = await deps.findNearbyNamedLocation(user, start.lat, start.lon, NAMING_RADIUS_M)
  if (named) return named
  const detected = await deps.findNearbyDetectedLocation(user, start.lat, start.lon, NAMING_RADIUS_M)
  const place = detected?.address?.split(',')[0]?.trim()
  return place ? { name: place } : null
}

const createRoute = async (
  user: string,
  canonicalId: string,
  deps: RouteMatchDeps,
): Promise<string | null> => {
  const summary = await deps.getTrackSummary(user, canonicalId)
  if (!summary) return null
  const name = routeName(await nameNear(user, summary.start, deps), summary.length_m)
  return deps.createRouteFromTrack(user, { activity_id: canonicalId, name })
}

/**
 * Attach the activity to the best covering route of its type running the same
 * way; else pair it with another unrouted track that passes the same tests and
 * create a route from the older of the two. Idempotent.
 */
export const matchActivityRoute = async (
  user: string,
  activityId: string,
  deps: RouteMatchDeps,
): Promise<RouteMatchOutcome> => {
  if (await deps.isActivityRouted(user, activityId)) return 'already_routed'
  const activity = await deps.getTrackedActivity(user, activityId)
  if (!activity) return 'no_track'

  for (const candidate of (await deps.findRouteCandidates(user, activityId)).filter(covers)) {
    if (!isForward(await deps.routeDirectionFractions(user, activityId, candidate.route_id))) continue
    await deps.attachActivityToRoute(user, activityId, candidate.route_id, coverageOf(candidate))
    return 'matched'
  }

  for (const other of (await deps.findUnroutedTrackCandidates(user, activityId)).filter(covers)) {
    if (!isForward(await deps.trackDirectionFractions(user, activityId, other.activity_id))) continue
    const otherIsOlder = other.start_time.getTime() <= activity.start_time.getTime()
    const [canonicalId, followerId] = otherIsOlder
      ? [other.activity_id, activityId]
      : [activityId, other.activity_id]
    const routeId = await createRoute(user, canonicalId, deps)
    if (!routeId) continue
    await deps.attachActivityToRoute(user, canonicalId, routeId, 1)
    await deps.attachActivityToRoute(user, followerId, routeId, coverageOf(other))
    return 'created'
  }

  return 'unmatched'
}

/** Match every tracked activity without a route, oldest first. */
export const matchUnroutedTracks = async (
  user: string,
  deps: RouteMatchDeps,
): Promise<{ matched: number; created: number }> => {
  let matched = 0
  let created = 0
  for (const { activity_id } of await deps.listUnroutedTrackedActivities(user)) {
    try {
      const outcome = await matchActivityRoute(user, activity_id, deps)
      if (outcome === 'matched') matched++
      if (outcome === 'created') created++
    } catch (error) {
      auditError(user, 'data', `Route matching failed for activity ${activity_id}`, { error: String(error) })
    }
  }
  return { created, matched }
}

export const serializeRoute = (route: RouteRecord): Route => ({
  activity_count: route.activity_count,
  activity_type: route.activity_type,
  canonical_activity_id: route.canonical_activity_id,
  created_at: route.created_at.toISOString(),
  end: route.end,
  id: route.id,
  last_activity_at: route.last_activity_at?.toISOString() ?? null,
  length_m: route.length_m,
  name: route.name,
  start: route.start,
  updated_at: route.updated_at.toISOString(),
})

/** Seconds per km from the mean speed (m/s), else from elapsed time over the recorded distance. */
export const paceSecondsPerKm = (
  meanSpeed: number | undefined,
  elapsedS: number,
  distanceM: number | undefined,
): number | undefined => {
  if (meanSpeed !== undefined && meanSpeed > 0) return 1000 / meanSpeed
  if (distanceM !== undefined && distanceM > 0 && elapsedS > 0) return elapsedS / (distanceM / 1000)
  return undefined
}

export interface RouteDetailDeps {
  getRouteById: (user: string, id: string) => Promise<RouteRecord | null>
  getRouteGeometry: (user: string, id: string) => Promise<{ points: LatLon[] } | null>
  listRouteEfforts: (user: string, routeId: string) => Promise<RouteEffortRow[]>
  getMetricMeansForWindows: (
    user: string,
    metric: string,
    windows: { start: Date; end: Date }[],
  ) => Promise<(number | undefined)[]>
}

export const defaultRouteDetailDeps: RouteDetailDeps = {
  getMetricMeansForWindows,
  getRouteById,
  getRouteGeometry,
  listRouteEfforts,
}

export const getRouteDetail = async (
  user: string,
  routeId: string,
  deps: RouteDetailDeps,
): Promise<RouteDetail | null> => {
  const route = await deps.getRouteById(user, routeId)
  if (!route) return null
  const [geometry, rows] = await Promise.all([
    deps.getRouteGeometry(user, routeId),
    deps.listRouteEfforts(user, routeId),
  ])
  const windows = rows.map((r) => ({ end: r.end_time ?? r.start_time, start: r.start_time }))
  const [hr, speed] = await Promise.all([
    deps.getMetricMeansForWindows(user, 'heart_rate', windows),
    deps.getMetricMeansForWindows(user, 'speed', windows),
  ])

  const efforts = rows.map((row, i): RouteEffort => {
    const elapsed = ((row.end_time ?? row.start_time).getTime() - row.start_time.getTime()) / 1000
    const pace = paceSecondsPerKm(speed[i], elapsed, row.data_distance)
    const avgHr = hr[i]
    return {
      activity_id: row.activity_id,
      ...(avgHr === undefined ? {} : { avg_hr: Math.round(avgHr * 10) / 10 }),
      coverage: row.coverage,
      ...(row.data_distance === undefined ? {} : { distance_m: row.data_distance }),
      elapsed_s: elapsed,
      ...(row.end_time ? { end_time: row.end_time.toISOString() } : {}),
      ...(pace === undefined ? {} : { pace_s_per_km: Math.round(pace * 10) / 10 }),
      source: row.source,
      start_time: row.start_time.toISOString(),
      ...(row.title ? { title: row.title } : {}),
    }
  })

  return { ...serializeRoute(route), efforts, points: geometry?.points ?? [] }
}

/** What the REST routes and the MCP tools both do with routes. */
export interface RouteOps {
  list: (user: string) => Promise<Route[]>
  detail: (user: string, id: string) => Promise<RouteDetail | null>
  rename: (user: string, id: string, name: string) => Promise<Route | null>
  remove: (user: string, id: string) => Promise<boolean>
  /** Moves `sourceId`'s runs onto `targetId`; null when either route is missing or they are the same. */
  merge: (user: string, targetId: string, sourceId: string) => Promise<MergeRoutesResult | null>
  match: (user: string) => Promise<RouteMatchResult>
}

export const defaultRouteOps: RouteOps = {
  detail: (user, id) => getRouteDetail(user, id, defaultRouteDetailDeps),
  list: async (user) => (await listRoutes(user)).map(serializeRoute),
  match: (user) => matchUnroutedTracks(user, defaultRouteMatchDeps),
  merge: async (user, targetId, sourceId) => {
    const moved = await mergeRoutes(user, sourceId, targetId)
    if (moved === null) return null
    const route = await getRouteById(user, targetId)
    return route ? { moved, route: serializeRoute(route) } : null
  },
  remove: deleteRoute,
  rename: async (user, id, name) => {
    const route = await updateRoute(user, id, { name })
    return route ? serializeRoute(route) : null
  },
}
