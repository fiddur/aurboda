/**
 * Location services for detecting frequently visited places.
 *
 * Uses GPS location data to identify "stays" - places where the user
 * spent significant time (default 60+ minutes).
 */

import {
  deleteNamedLocation,
  getNamedLocationById,
  getNamedLocations,
  getDetectedLocations as getStoredDetectedLocations,
  insertNamedLocation,
  type NamedLocation,
  type NamedLocationInput,
  query,
  type DetectedLocation as StoredDetectedLocation,
  updateNamedLocation,
} from '../db/index.ts'

// ============================================================================
// Types
// ============================================================================

export interface DetectedLocation {
  lat: number
  lon: number
  totalMinutes: number
  visitCount: number
  firstVisit: string
  lastVisit: string
  suggestedRadius: number
}

export interface LocationPoint {
  lat: number
  lon: number
  time: Date
}

export interface Stay {
  lat: number
  lon: number
  start_time: Date
  end_time: Date
  duration_minutes: number
  points: LocationPoint[]
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CLUSTER_RADIUS_METERS = 200
const DEFAULT_MIN_STAY_MINUTES = 60

// Unknown ("Somewhere") visits have no named/detected place identity to bound
// them, so merging consecutive unknown fixes by name alone lets a single stale
// GPS fix be stretched into one long stay that swallows travel *and* the real
// destination (issue #811). Break such a visit when a fix moves beyond this
// radius from the visit's running centroid (real movement), or after a gap with
// no fixes longer than the cap below (no evidence of continuous presence).
const UNKNOWN_VISIT_BREAK_RADIUS_METERS = DEFAULT_CLUSTER_RADIUS_METERS
const MAX_UNKNOWN_VISIT_GAP_MINUTES = 90

// When collapsing short unknown visits, only absorb one into an adjacent visit
// if it is genuinely contiguous — close in both space and time. This keeps a
// brief GPS glitch stitched into the stay it interrupted while refusing to
// bridge a stay across travel or a long data gap.
const MERGE_BRIDGE_RADIUS_METERS = DEFAULT_CLUSTER_RADIUS_METERS
const MERGE_BRIDGE_GAP_MINUTES = 30

// ============================================================================
// Helper Functions
// ============================================================================

const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371000 // Earth radius in meters
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

const calculateCentroid = (points: LocationPoint[]): { lat: number; lon: number } => {
  const sumLat = points.reduce((sum, p) => sum + p.lat, 0)
  const sumLon = points.reduce((sum, p) => sum + p.lon, 0)
  return { lat: sumLat / points.length, lon: sumLon / points.length }
}

const calculateSuggestedRadius = (
  points: LocationPoint[],
  centroid: { lat: number; lon: number },
): number => {
  if (points.length === 0) return DEFAULT_CLUSTER_RADIUS_METERS
  const distances = points.map((p) => haversineDistance(centroid.lat, centroid.lon, p.lat, p.lon))
  const maxDistance = Math.max(...distances)
  // Round up to nearest 50m, minimum 100m
  return Math.max(100, Math.ceil(maxDistance / 50) * 50)
}

// ============================================================================
// Stay Detection Algorithm
// ============================================================================

/**
 * Detect "stays" from a sequence of location points.
 * A stay is a cluster of consecutive points within a radius where the user spent minStayMinutes+.
 */
export const detectStays = (
  points: LocationPoint[],
  radiusMeters: number = DEFAULT_CLUSTER_RADIUS_METERS,
  minStayMinutes: number = DEFAULT_MIN_STAY_MINUTES,
): Stay[] => {
  if (points.length === 0) return []

  const stays: Stay[] = []
  let currentStay: LocationPoint[] = [points[0]]
  let currentCentroid = { lat: points[0].lat, lon: points[0].lon }

  for (let i = 1; i < points.length; i++) {
    const point = points[i]
    const distanceFromCentroid = haversineDistance(
      currentCentroid.lat,
      currentCentroid.lon,
      point.lat,
      point.lon,
    )

    if (distanceFromCentroid <= radiusMeters) {
      // Point is within radius, add to current stay
      currentStay.push(point)
      currentCentroid = calculateCentroid(currentStay)
    } else {
      // Point is outside radius, finalize current stay if long enough
      if (currentStay.length >= 2) {
        const startTime = currentStay[0].time
        const endTime = currentStay[currentStay.length - 1].time
        const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60)

        if (durationMinutes >= minStayMinutes) {
          stays.push({
            duration_minutes: durationMinutes,
            end_time: endTime,
            lat: currentCentroid.lat,
            lon: currentCentroid.lon,
            points: currentStay,
            start_time: startTime,
          })
        }
      }

      // Start new potential stay
      currentStay = [point]
      currentCentroid = { lat: point.lat, lon: point.lon }
    }
  }

  // Check final stay
  if (currentStay.length >= 2) {
    const startTime = currentStay[0].time
    const endTime = currentStay[currentStay.length - 1].time
    const durationMinutes = (endTime.getTime() - startTime.getTime()) / (1000 * 60)

    if (durationMinutes >= minStayMinutes) {
      stays.push({
        duration_minutes: durationMinutes,
        end_time: endTime,
        lat: currentCentroid.lat,
        lon: currentCentroid.lon,
        points: currentStay,
        start_time: startTime,
      })
    }
  }

  return stays
}

/**
 * Merge stays at similar locations into clusters.
 * Returns aggregated info about each unique location.
 */
export const clusterStays = (
  stays: Stay[],
  radiusMeters: number = DEFAULT_CLUSTER_RADIUS_METERS,
): DetectedLocation[] => {
  if (stays.length === 0) return []

  const clusters: { stays: Stay[]; centroid: { lat: number; lon: number } }[] = []

  for (const stay of stays) {
    let foundCluster = false

    for (const cluster of clusters) {
      const distance = haversineDistance(cluster.centroid.lat, cluster.centroid.lon, stay.lat, stay.lon)
      if (distance <= radiusMeters) {
        cluster.stays.push(stay)
        // Recalculate centroid
        const allPoints = cluster.stays.flatMap((s) => s.points)
        cluster.centroid = calculateCentroid(allPoints)
        foundCluster = true
        break
      }
    }

    if (!foundCluster) {
      clusters.push({
        centroid: { lat: stay.lat, lon: stay.lon },
        stays: [stay],
      })
    }
  }

  return clusters.map((cluster) => {
    const allPoints = cluster.stays.flatMap((s) => s.points)
    const totalMinutes = cluster.stays.reduce((sum, s) => sum + s.duration_minutes, 0)
    const firstVisit = cluster.stays.reduce(
      (earliest, s) => (s.start_time < earliest ? s.start_time : earliest),
      cluster.stays[0].start_time,
    )
    const lastVisit = cluster.stays.reduce(
      (latest, s) => (s.end_time > latest ? s.end_time : latest),
      cluster.stays[0].end_time,
    )

    return {
      firstVisit: firstVisit.toISOString(),
      lastVisit: lastVisit.toISOString(),
      lat: cluster.centroid.lat,
      lon: cluster.centroid.lon,
      suggestedRadius: calculateSuggestedRadius(allPoints, cluster.centroid),
      totalMinutes: Math.round(totalMinutes),
      visitCount: cluster.stays.length,
    }
  })
}

// ============================================================================
// Database Queries
// ============================================================================

/**
 * Get location points from the database for a time range.
 */
export const getLocationPoints = async (user: string, start: Date, end: Date): Promise<LocationPoint[]> => {
  const result = await query(
    user,
    `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, time
     FROM locations
     WHERE time >= $1 AND time <= $2 AND deleted_at IS NULL
     ORDER BY time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    lat: row.lat,
    lon: row.lon,
    time: new Date(row.time),
  }))
}

/**
 * Filter out detected locations that overlap with existing named locations.
 */
export const filterOverlappingLocations = async (
  user: string,
  detected: DetectedLocation[],
): Promise<DetectedLocation[]> => {
  const namedLocations = await getNamedLocations(user)
  if (namedLocations.length === 0) return detected

  return detected.filter((d) => {
    for (const named of namedLocations) {
      const distance = haversineDistance(d.lat, d.lon, named.lat, named.lon)
      // Consider overlapping if within either radius
      if (distance <= Math.max(d.suggestedRadius, named.radius)) {
        return false
      }
    }
    return true
  })
}

// ============================================================================
// Public API
// ============================================================================

export interface GetDetectedLocationsOptions {
  start: Date
  end: Date
  minDurationMinutes?: number
}

/**
 * Get detected locations where user spent significant time.
 * Filters out locations that already have named locations nearby.
 */
export const getDetectedLocations = async (
  user: string,
  options: GetDetectedLocationsOptions,
): Promise<DetectedLocation[]> => {
  const { end, minDurationMinutes = DEFAULT_MIN_STAY_MINUTES, start } = options

  // Get all location points in the time range
  const points = await getLocationPoints(user, start, end)
  if (points.length === 0) return []

  // Detect stays
  const stays = detectStays(points, DEFAULT_CLUSTER_RADIUS_METERS, minDurationMinutes)
  if (stays.length === 0) return []

  // Cluster stays at similar locations
  const clusters = clusterStays(stays)

  // Filter out locations that overlap with named locations
  const filtered = await filterOverlappingLocations(user, clusters)

  // Sort by total time spent (descending)
  return filtered.sort((a, b) => b.totalMinutes - a.totalMinutes)
}

// ============================================================================
// Location Matching for Places
// ============================================================================

export interface PlaceVisit {
  name: string
  lat: number
  lon: number
  start_time: Date
  end_time: Date
  duration_minutes: number
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  address?: string
  detected_location_id?: string
  /** Set when source='named' — the id of the matched named_location. */
  named_location_id?: string
}

/**
 * Match a location point against named locations.
 * Returns the name of the matching location, or null if no match.
 */
export const matchLocationToNamed = (
  lat: number,
  lon: number,
  namedLocations: NamedLocation[],
): NamedLocation | null => {
  for (const named of namedLocations) {
    const distance = haversineDistance(lat, lon, named.lat, named.lon)
    if (distance <= named.radius) {
      return named
    }
  }
  return null
}

/**
 * Match a location point against stored detected locations.
 * Returns the matching detected location, or null if no match.
 */
export const matchLocationToDetected = (
  lat: number,
  lon: number,
  detectedLocations: StoredDetectedLocation[],
): StoredDetectedLocation | null => {
  for (const detected of detectedLocations) {
    const distance = haversineDistance(lat, lon, detected.lat, detected.lon)
    if (distance <= detected.radius) {
      return detected
    }
  }
  return null
}

/**
 * Get raw GPS points for a time range, suitable for rendering a path on a map.
 */
export const getRawLocationPoints = async (
  user: string,
  start: Date,
  end: Date,
): Promise<{ lat: number; lon: number; time: Date }[]> => {
  const result = await query(
    user,
    `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, time
     FROM locations
     WHERE time >= $1 AND time <= $2
     ORDER BY time`,
    [start, end],
  )

  return result.rows.map((row) => ({
    lat: Number(row.lat),
    lon: Number(row.lon),
    time: new Date(row.time),
  }))
}

interface FixClassification {
  placeName: string
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  address?: string
  detectedLocationId?: string
  namedLocationId?: string
}

/**
 * Classify a single fix to a place: a named location wins, then a detected
 * location, then an OwnTracks region, else "Somewhere" (unknown).
 */
const classifyFix = (
  lat: number,
  lon: number,
  regions: string[],
  namedLocations: NamedLocation[],
  detectedLocations: StoredDetectedLocation[],
): FixClassification => {
  const namedMatch = matchLocationToNamed(lat, lon, namedLocations)
  if (namedMatch) return { namedLocationId: namedMatch.id, placeName: namedMatch.name, source: 'named' }

  const detectedMatch = matchLocationToDetected(lat, lon, detectedLocations)
  if (detectedMatch) {
    return {
      address: detectedMatch.address || undefined,
      detectedLocationId: detectedMatch.id,
      placeName: detectedMatch.address || 'Detected location',
      source: 'detected',
    }
  }

  if (regions.length > 0) return { placeName: regions[0], source: 'owntracks' }
  return { placeName: 'Somewhere', source: 'unknown' }
}

/**
 * Mutable accumulator for a visit being built. `point_count` tracks how many
 * fixes have been folded into the running centroid of an unknown visit (lat/lon
 * hold that centroid); `duration_minutes` is computed when the visit is
 * finalized.
 */
interface VisitAccumulator {
  name: string
  lat: number
  lon: number
  start_time: Date
  end_time: Date
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  address?: string
  detected_location_id?: string
  named_location_id?: string
  point_count: number
}

/**
 * Decide whether `loc` continues `current`. Beyond matching the place identity,
 * an unknown ("Somewhere") visit also breaks on real movement away from its
 * running centroid or after a long data gap — otherwise a single stale fix
 * would swallow travel and the real destination (issue #811).
 */
const continuesVisit = (current: VisitAccumulator, cls: FixClassification, loc: LocationPoint): boolean => {
  if (
    current.named_location_id !== cls.namedLocationId ||
    current.name !== cls.placeName ||
    current.detected_location_id !== cls.detectedLocationId
  ) {
    return false
  }
  if (cls.source !== 'unknown') return true
  const movedAway =
    haversineDistance(current.lat, current.lon, loc.lat, loc.lon) > UNKNOWN_VISIT_BREAK_RADIUS_METERS
  const gapMinutes = (loc.time.getTime() - current.end_time.getTime()) / (1000 * 60)
  return !movedAway && gapMinutes <= MAX_UNKNOWN_VISIT_GAP_MINUTES
}

/** Extend `current` to include `loc`, folding unknown fixes into a running centroid. */
const extendVisit = (current: VisitAccumulator, loc: LocationPoint): void => {
  current.end_time = loc.time
  if (current.source === 'unknown') {
    const n = current.point_count
    current.lat = (current.lat * n + loc.lat) / (n + 1)
    current.lon = (current.lon * n + loc.lon) / (n + 1)
    current.point_count = n + 1
  }
}

/** Convert a visit accumulator into a PlaceVisit (computes duration, drops bookkeeping). */
const finalizeVisit = (v: VisitAccumulator): PlaceVisit => ({
  address: v.address,
  detected_location_id: v.detected_location_id,
  duration_minutes: Math.round((v.end_time.getTime() - v.start_time.getTime()) / (1000 * 60)),
  end_time: v.end_time,
  lat: v.lat,
  lon: v.lon,
  name: v.name,
  named_location_id: v.named_location_id,
  source: v.source,
  start_time: v.start_time,
})

/**
 * Get place visits for a time range, using named locations when available.
 * Falls back to detected locations, then OwnTracks regions.
 */
export const getPlaceVisits = async (user: string, start: Date, end: Date): Promise<PlaceVisit[]> => {
  // Get location data from db with regions
  const result = await query(
    user,
    `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, time, regions
     FROM locations
     WHERE time >= $1 AND time <= $2 AND deleted_at IS NULL
     ORDER BY time`,
    [start, end],
  )

  if (result.rows.length === 0) return []

  const [namedLocations, detectedLocations] = await Promise.all([
    getNamedLocations(user),
    getStoredDetectedLocations(user),
  ])

  interface LocationWithRegion extends LocationPoint {
    regions: string[]
  }

  const locations: LocationWithRegion[] = result.rows.map((row) => ({
    lat: row.lat,
    lon: row.lon,
    regions: row.regions || [],
    time: new Date(row.time),
  }))

  // Group consecutive locations at the same place. named_location_id is part
  // of the identity key (see continuesVisit) so two named locations with the
  // same display name correctly split into separate visits.
  const visits: PlaceVisit[] = []
  let currentVisit: VisitAccumulator | null = null

  for (const loc of locations) {
    const cls = classifyFix(loc.lat, loc.lon, loc.regions, namedLocations, detectedLocations)

    if (currentVisit && continuesVisit(currentVisit, cls, loc)) {
      extendVisit(currentVisit, loc)
      continue
    }

    if (currentVisit) visits.push(finalizeVisit(currentVisit))
    currentVisit = {
      address: cls.address,
      detected_location_id: cls.detectedLocationId,
      end_time: loc.time,
      lat: loc.lat,
      lon: loc.lon,
      name: cls.placeName,
      named_location_id: cls.namedLocationId,
      point_count: 1,
      source: cls.source,
      start_time: loc.time,
    }
  }

  // Don't forget the last visit
  if (currentVisit) {
    visits.push(finalizeVisit(currentVisit))
  }

  // Filter out short "unknown" visits (GPS jumps) and merge into adjacent visits
  return mergeShortUnknownVisits(visits)
}

/**
 * Collapse short "unknown" (Somewhere) visits — typically brief GPS glitches.
 *
 * A short unknown visit is absorbed into an adjacent visit only when it is
 * genuinely *contiguous* with it: close in both space (within
 * `MERGE_BRIDGE_RADIUS_METERS`) and time (gap ≤ `MERGE_BRIDGE_GAP_MINUTES`).
 * That stitches a momentary glitch back into the stay it interrupted, but it
 * refuses to bridge a stay across travel or a long data gap — without this, a
 * chain of brief travel fixes would keep extending a neighbouring stay and
 * re-create the issue #811 swallowing. A short unknown that fits neither
 * neighbour is dropped (it was movement, not a stay).
 */
export const mergeShortUnknownVisits = (visits: PlaceVisit[], minDurationMinutes = 5): PlaceVisit[] => {
  if (visits.length === 0) return visits

  const result: PlaceVisit[] = []

  const contiguous = (a: PlaceVisit, b: PlaceVisit): boolean => {
    // `a` precedes `b` in time; measure the gap between them and the distance.
    const gapMinutes = (b.start_time.getTime() - a.end_time.getTime()) / (1000 * 60)
    return (
      gapMinutes <= MERGE_BRIDGE_GAP_MINUTES &&
      haversineDistance(a.lat, a.lon, b.lat, b.lon) <= MERGE_BRIDGE_RADIUS_METERS
    )
  }

  for (let i = 0; i < visits.length; i++) {
    const visit = visits[i]

    // Keep non-unknown visits and unknown visits >= minDuration.
    if (visit.source !== 'unknown' || visit.duration_minutes >= minDurationMinutes) {
      result.push(visit)
      continue
    }

    const prev = result.length > 0 ? result[result.length - 1] : null
    const next = i + 1 < visits.length ? visits[i + 1] : null

    if (prev && contiguous(prev, visit)) {
      // Extend the previous visit to cover this brief glitch.
      prev.end_time = visit.end_time
      prev.duration_minutes = Math.round((prev.end_time.getTime() - prev.start_time.getTime()) / (1000 * 60))
    } else if (next && contiguous(visit, next)) {
      // No usable previous visit — fold backwards into the next one.
      next.start_time = visit.start_time
      next.duration_minutes = Math.round((next.end_time.getTime() - next.start_time.getTime()) / (1000 * 60))
    }
    // Otherwise drop it: a transient fix not contiguous with either neighbour.
  }

  return result
}

// Re-export CRUD operations from db
export {
  deleteNamedLocation,
  getNamedLocationById,
  getNamedLocations,
  insertNamedLocation,
  type NamedLocation,
  type NamedLocationInput,
  updateNamedLocation,
}
