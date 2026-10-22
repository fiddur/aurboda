import {
  type DetectedLocation,
  type DetectedLocationInput,
  getDetectedLocations as getStoredDetectedLocations,
  insertDetectedLocation,
  updateDetectedLocation,
} from '../db/index.ts'
import {
  clusterStays,
  type DetectedLocation as DetectedCluster,
  detectStays,
  getLocationPoints,
} from './locations.ts'

/**
 * 200m covers typical GPS accuracy variance and building footprints.
 */
const DEFAULT_CLUSTER_RADIUS_METERS = 200

/**
 * 60 minutes filters out brief stops like traffic or quick errands.
 */
const DEFAULT_MIN_STAY_MINUTES = 60

/**
 * 50m accounts for GPS drift while catching genuine location changes.
 * Triggers re-geocoding when exceeded.
 */
const LOCATION_MOVE_THRESHOLD_METERS = 50

/**
 * 7 days provides enough data for pattern detection while keeping queries fast.
 */
const DEFAULT_LOOKBACK_DAYS = 7

/**
 * Calculate haversine distance between two points in meters.
 */
export const haversineDistance = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
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

export type DetectionAction =
  | { type: 'create'; cluster: DetectedCluster }
  | {
      type: 'update'
      id: string
      cluster: DetectedCluster
      needsReGeocode: boolean
    }
  | { type: 'skip'; cluster: DetectedCluster; reason: string }

export const determineClusterAction = (
  cluster: DetectedCluster,
  storedLocations: DetectedLocation[],
  moveThresholdMeters: number = LOCATION_MOVE_THRESHOLD_METERS,
): DetectionAction => {
  let nearestLocation: DetectedLocation | null = null
  let nearestDistance = Infinity

  for (const stored of storedLocations) {
    const distance = haversineDistance(cluster.lat, cluster.lon, stored.lat, stored.lon)
    if (distance < nearestDistance) {
      nearestDistance = distance
      nearestLocation = stored
    }
  }

  if (!nearestLocation || nearestDistance > DEFAULT_CLUSTER_RADIUS_METERS) {
    return { cluster, type: 'create' }
  }

  const needsReGeocode = nearestDistance > moveThresholdMeters

  return {
    cluster,
    id: nearestLocation.id,
    needsReGeocode,
    type: 'update',
  }
}

export const determineAllActions = (
  clusters: DetectedCluster[],
  storedLocations: DetectedLocation[],
  moveThresholdMeters: number = LOCATION_MOVE_THRESHOLD_METERS,
): DetectionAction[] => {
  return clusters.map((cluster) => determineClusterAction(cluster, storedLocations, moveThresholdMeters))
}

export const mergeClusterWithStored = (
  cluster: DetectedCluster,
  stored: DetectedLocation,
): {
  total_minutes: number
  visit_count: number
  first_visit: Date
  last_visit: Date
  lat: number
  lon: number
} => {
  const clusterFirstVisit = new Date(cluster.firstVisit)
  const clusterLastVisit = new Date(cluster.lastVisit)

  return {
    first_visit: clusterFirstVisit < stored.first_visit ? clusterFirstVisit : stored.first_visit,
    last_visit: clusterLastVisit > stored.last_visit ? clusterLastVisit : stored.last_visit,
    lat: cluster.lat,
    lon: cluster.lon,
    total_minutes: stored.total_minutes + cluster.totalMinutes,
    visit_count: stored.visit_count + cluster.visitCount,
  }
}

export interface DetectionResult {
  created: number
  updated: number
  needsGeocode: string[]
}

export const runDetectionForUser = async (
  user: string,
  lookbackDays: number = DEFAULT_LOOKBACK_DAYS,
): Promise<DetectionResult> => {
  const end = new Date()
  const start = new Date(end.getTime() - lookbackDays * 24 * 60 * 60 * 1000)

  const points = await getLocationPoints(user, start, end)
  if (points.length === 0) {
    return { created: 0, needsGeocode: [], updated: 0 }
  }

  const stays = detectStays(points, DEFAULT_CLUSTER_RADIUS_METERS, DEFAULT_MIN_STAY_MINUTES)
  if (stays.length === 0) {
    return { created: 0, needsGeocode: [], updated: 0 }
  }

  const clusters = clusterStays(stays, DEFAULT_CLUSTER_RADIUS_METERS)
  if (clusters.length === 0) {
    return { created: 0, needsGeocode: [], updated: 0 }
  }

  const storedLocations = await getStoredDetectedLocations(user)

  const actions = determineAllActions(clusters, storedLocations)

  const result: DetectionResult = { created: 0, needsGeocode: [], updated: 0 }

  for (const action of actions) {
    if (action.type === 'create') {
      const input: DetectedLocationInput = {
        first_visit: new Date(action.cluster.firstVisit),
        last_visit: new Date(action.cluster.lastVisit),
        lat: action.cluster.lat,
        lon: action.cluster.lon,
        radius: action.cluster.suggestedRadius,
        total_minutes: action.cluster.totalMinutes,
        visit_count: action.cluster.visitCount,
      }
      const created = await insertDetectedLocation(user, input)
      result.created++
      result.needsGeocode.push(created.id)
    } else if (action.type === 'update') {
      const stored = storedLocations.find((s) => s.id === action.id)
      if (!stored) continue

      const merged = mergeClusterWithStored(action.cluster, stored)

      await updateDetectedLocation(user, action.id, {
        first_visit: merged.first_visit,
        geocode_status: action.needsReGeocode ? 'pending' : undefined,
        last_visit: merged.last_visit,
        lat: merged.lat,
        lon: merged.lon,
        total_minutes: merged.total_minutes,
        visit_count: merged.visit_count,
      })
      result.updated++

      if (action.needsReGeocode) {
        result.needsGeocode.push(action.id)
      }
    }
  }

  return result
}
