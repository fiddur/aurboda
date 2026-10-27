import type {
  MergeRoutesResult,
  Route,
  RouteDetail,
  RouteEffort,
  RouteMatchResult,
  RoutesQuery,
} from '@aurboda/api-spec'

import type {
  LatLon,
  RouteCandidate,
  RouteEffortRow,
  RouteRecord,
  TrackedActivity,
  TrackPairCandidate,
} from '../db/routes.ts'

import { expandActivityTypes } from '../db/activity-type-definitions.ts'
import { findNearbyDetectedLocation, findNearbyNamedLocation } from '../db/locations.ts'
import {
  attachActivityToRoute,
  createRouteWithPair,
  deleteRoute,
  detachActivityFromRoute,
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
  markRouteMatchAttempted,
  mergeRoutes,
  routeDirectionFractions,
  trackDirectionFractions,
  updateRoute,
} from '../db/routes.ts'
import { getMetricMeansForWindows } from '../db/time-series.ts'
import { auditError } from './audit-log.ts'

export const COVERAGE_THRESHOLD = 0.9
const MIN_DIRECTION_SAMPLES = 4
const REVERSED_SHARE = 0.8
const NAMING_RADIUS_M = 500

/**
 * Whether the projections of a track's samples onto a line are not clearly
 * reversed. A reversed run decreases at nearly every step and is rejected. A loop
 * started elsewhere wraps once, and an out-and-back, whose legs overlap, projects
 * onto either leg at random, so both pass: mutual coverage already proves the
 * same path, this only tells the two directions of a one-way course apart.
 */
export const isNotReversed = (fractions: number[]): boolean => {
  if (fractions.length < MIN_DIRECTION_SAMPLES) return false
  let decreasing = 0
  for (let i = 1; i < fractions.length; i++) if (fractions[i]! < fractions[i - 1]!) decreasing++
  return decreasing < REVERSED_SHARE * (fractions.length - 1)
}

/** Keeps the name inside routes.name's VARCHAR(255) whatever the place is called. */
const MAX_PLACE_CHARS = 200

export const routeName = (nearby: { name: string } | null, lengthM: number): string =>
  `${(nearby?.name ?? 'Route').slice(0, MAX_PLACE_CHARS)} · ${(lengthM / 1000).toFixed(1)} km`

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
  createRouteWithPair: (
    user: string,
    input: {
      canonical: { activity_id: string; name: string }
      follower: { activity_id: string; coverage: number }
    },
  ) => Promise<string | null>
  attachActivityToRoute: (
    user: string,
    activityId: string,
    routeId: string,
    coverage: number,
  ) => Promise<void>
  markRouteMatchAttempted: (user: string, activityId: string) => Promise<void>
  detachActivityFromRoute: (
    user: string,
    activityId: string,
  ) => Promise<{ detached: boolean; deleted_route_id: string | null }>
  listUnroutedTrackedActivities: (user: string) => Promise<TrackedActivity[]>
}

export const defaultRouteMatchDeps: RouteMatchDeps = {
  attachActivityToRoute,
  createRouteWithPair,
  detachActivityFromRoute,
  findNearbyDetectedLocation,
  findNearbyNamedLocation,
  findRouteCandidates,
  findUnroutedTrackCandidates,
  getTrackedActivity,
  getTrackSummary,
  isActivityRouted,
  listUnroutedTrackedActivities,
  markRouteMatchAttempted,
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

/**
 * Attach the activity to the best covering route of its type running the same
 * way; else pair it with another unrouted track that passes the same tests and
 * create a route from the older of the two. Idempotent. 'matched', 'created' and
 * 'unmatched' mark the track as tried, so the startup backfill skips it until the
 * track is rewritten or the activity retyped; a route founded concurrently leaves
 * it unmarked, since the activity may still be unrouted.
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
    if (!isNotReversed(await deps.routeDirectionFractions(user, activityId, candidate.route_id))) continue
    await deps.attachActivityToRoute(user, activityId, candidate.route_id, coverageOf(candidate))
    await deps.markRouteMatchAttempted(user, activityId)
    return 'matched'
  }

  for (const other of (await deps.findUnroutedTrackCandidates(user, activityId)).filter(covers)) {
    if (!isNotReversed(await deps.trackDirectionFractions(user, activityId, other.activity_id))) continue
    const otherIsOlder = other.start_time.getTime() <= activity.start_time.getTime()
    const [canonicalId, followerId] = otherIsOlder
      ? [other.activity_id, activityId]
      : [activityId, other.activity_id]
    const summary = await deps.getTrackSummary(user, canonicalId)
    if (!summary) continue
    const routeId = await deps.createRouteWithPair(user, {
      canonical: {
        activity_id: canonicalId,
        name: routeName(await nameNear(user, summary.start, deps), summary.length_m),
      },
      follower: { activity_id: followerId, coverage: coverageOf(other) },
    })
    if (!routeId) return 'already_routed'
    await deps.markRouteMatchAttempted(user, activityId)
    return 'created'
  }

  await deps.markRouteMatchAttempted(user, activityId)
  return 'unmatched'
}

/** Takes each activity off its route and matches it again, e.g. under a new activity type. */
export const rematchActivityRoute = async (
  user: string,
  activityIds: string[],
  deps: RouteMatchDeps,
): Promise<{ activity_id: string; outcome: RouteMatchOutcome | 'failed' }[]> => {
  const outcomes: { activity_id: string; outcome: RouteMatchOutcome | 'failed' }[] = []
  for (const activityId of activityIds) {
    try {
      await deps.detachActivityFromRoute(user, activityId)
      outcomes.push({ activity_id: activityId, outcome: await matchActivityRoute(user, activityId, deps) })
    } catch (error) {
      auditError(user, 'data', `Route re-matching failed for activity ${activityId}`, {
        error: String(error),
      })
      outcomes.push({ activity_id: activityId, outcome: 'failed' })
    }
  }
  return outcomes
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

export interface RouteOps {
  list: (user: string, query: RoutesQuery) => Promise<Route[]>
  detail: (user: string, id: string) => Promise<RouteDetail | null>
  rename: (user: string, id: string, name: string) => Promise<Route | null>
  remove: (user: string, id: string) => Promise<boolean>
  merge: (user: string, targetId: string, sourceId: string) => Promise<MergeRoutesResult | null>
  match: (user: string) => Promise<RouteMatchResult>
}

export const defaultRouteOps: RouteOps = {
  detail: (user, id) => getRouteDetail(user, id, defaultRouteDetailDeps),
  list: async (user, { activity_type, sort }) => {
    const activityTypes = activity_type ? await expandActivityTypes(user, [activity_type]) : undefined
    return (await listRoutes(user, { activityTypes, sort })).map(serializeRoute)
  },
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
