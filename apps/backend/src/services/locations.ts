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
  NamedLocation,
  NamedLocationInput,
  query,
  DetectedLocation as StoredDetectedLocation,
  updateNamedLocation,
} from '../db'

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
  startTime: Date
  endTime: Date
  durationMinutes: number
  points: LocationPoint[]
}

// ============================================================================
// Configuration
// ============================================================================

const DEFAULT_CLUSTER_RADIUS_METERS = 200
const DEFAULT_MIN_STAY_MINUTES = 60

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
            durationMinutes,
            endTime,
            lat: currentCentroid.lat,
            lon: currentCentroid.lon,
            points: currentStay,
            startTime,
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
        durationMinutes,
        endTime,
        lat: currentCentroid.lat,
        lon: currentCentroid.lon,
        points: currentStay,
        startTime,
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
    const totalMinutes = cluster.stays.reduce((sum, s) => sum + s.durationMinutes, 0)
    const firstVisit = cluster.stays.reduce(
      (earliest, s) => (s.startTime < earliest ? s.startTime : earliest),
      cluster.stays[0].startTime,
    )
    const lastVisit = cluster.stays.reduce(
      (latest, s) => (s.endTime > latest ? s.endTime : latest),
      cluster.stays[0].endTime,
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
     WHERE time >= $1 AND time <= $2
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
  startTime: Date
  endTime: Date
  durationMinutes: number
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  address?: string
  detectedLocationId?: string
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
 * Get place visits for a time range, using named locations when available.
 * Falls back to detected locations, then OwnTracks regions.
 */
export const getPlaceVisits = async (user: string, start: Date, end: Date): Promise<PlaceVisit[]> => {
  // Get location data from db with regions
  const result = await query(
    user,
    `SELECT ST_Y(location::geometry) as lat, ST_X(location::geometry) as lon, time, regions
     FROM locations
     WHERE time >= $1 AND time <= $2
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

  // Group consecutive locations at the same place
  const visits: PlaceVisit[] = []
  let currentVisit: {
    name: string
    lat: number
    lon: number
    startTime: Date
    endTime: Date
    source: 'named' | 'detected' | 'owntracks' | 'unknown'
    address?: string
    detectedLocationId?: string
  } | null = null

  for (const loc of locations) {
    // Try to match against named locations first
    const namedMatch = matchLocationToNamed(loc.lat, loc.lon, namedLocations)

    let placeName: string
    let source: 'named' | 'detected' | 'owntracks' | 'unknown'
    let address: string | undefined
    let detectedLocationId: string | undefined

    if (namedMatch) {
      placeName = namedMatch.name
      source = 'named'
    } else {
      // Try to match against detected locations
      const detectedMatch = matchLocationToDetected(loc.lat, loc.lon, detectedLocations)
      if (detectedMatch) {
        placeName = detectedMatch.address || 'Detected location'
        source = 'detected'
        address = detectedMatch.address || undefined
        detectedLocationId = detectedMatch.id
      } else if (loc.regions.length > 0) {
        placeName = loc.regions[0]
        source = 'owntracks'
      } else {
        placeName = 'Somewhere'
        source = 'unknown'
      }
    }

    // Check if this is a continuation of the same visit
    const samePlace =
      currentVisit &&
      currentVisit.name === placeName &&
      currentVisit.detectedLocationId === detectedLocationId

    if (samePlace) {
      // Extend current visit
      currentVisit!.endTime = loc.time
    } else {
      // Finalize previous visit if exists
      if (currentVisit) {
        const duration = (currentVisit.endTime.getTime() - currentVisit.startTime.getTime()) / (1000 * 60)
        visits.push({
          ...currentVisit,
          durationMinutes: Math.round(duration),
        })
      }

      // Start new visit
      currentVisit = {
        address,
        detectedLocationId,
        endTime: loc.time,
        lat: loc.lat,
        lon: loc.lon,
        name: placeName,
        source,
        startTime: loc.time,
      }
    }
  }

  // Don't forget the last visit
  if (currentVisit) {
    const duration = (currentVisit.endTime.getTime() - currentVisit.startTime.getTime()) / (1000 * 60)
    visits.push({
      ...currentVisit,
      durationMinutes: Math.round(duration),
    })
  }

  return visits
}

// Re-export CRUD operations from db
export {
  deleteNamedLocation,
  getNamedLocationById,
  getNamedLocations,
  insertNamedLocation,
  NamedLocation,
  NamedLocationInput,
  updateNamedLocation,
}
