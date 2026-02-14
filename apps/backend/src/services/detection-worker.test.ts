import { describe, expect, test } from 'vitest'
import { DetectedLocation } from '../db'
import {
  determineAllActions,
  determineClusterAction,
  haversineDistance,
  mergeClusterWithStored,
} from './detection-worker'
import { DetectedLocation as DetectedCluster } from './locations'

describe('haversineDistance', () => {
  test('returns 0 for same point', () => {
    expect(haversineDistance(59.33, 18.07, 59.33, 18.07)).toBe(0)
  })

  test('calculates correct distance for known points', () => {
    // Stockholm city center to Södermalm (~1.5km)
    const distance = haversineDistance(59.3293, 18.0686, 59.3174, 18.0722)
    expect(distance).toBeGreaterThan(1300)
    expect(distance).toBeLessThan(1400)
  })

  test('calculates correct distance for nearby points', () => {
    // ~100m apart
    const distance = haversineDistance(59.33, 18.07, 59.3309, 18.07)
    expect(distance).toBeGreaterThan(90)
    expect(distance).toBeLessThan(110)
  })
})

describe('determineClusterAction', () => {
  const makeCluster = (
    lat: number,
    lon: number,
    totalMinutes: number = 120,
    visitCount: number = 1,
  ): DetectedCluster => ({
    firstVisit: '2024-01-15T10:00:00Z',
    lastVisit: '2024-01-15T12:00:00Z',
    lat,
    lon,
    suggestedRadius: 200,
    totalMinutes,
    visitCount,
  })

  const makeStored = (id: string, lat: number, lon: number): DetectedLocation => ({
    address: null,
    created_at: new Date('2024-01-10'),
    first_visit: new Date('2024-01-10T10:00:00Z'),
    geocode_status: 'success',
    id,
    last_visit: new Date('2024-01-14T12:00:00Z'),
    lat,
    lon,
    radius: 200,
    total_minutes: 500,
    updated_at: new Date('2024-01-14'),
    visit_count: 5,
  })

  test('returns create action when no stored locations exist', () => {
    const cluster = makeCluster(59.33, 18.07)
    const action = determineClusterAction(cluster, [])

    expect(action.type).toBe('create')
    if (action.type === 'create') {
      expect(action.cluster).toBe(cluster)
    }
  })

  test('returns create action when cluster is far from all stored locations', () => {
    const cluster = makeCluster(59.33, 18.07)
    const stored = [makeStored('1', 59.4, 18.15)] // ~10km away

    const action = determineClusterAction(cluster, stored)

    expect(action.type).toBe('create')
  })

  test('returns update action when cluster is near a stored location', () => {
    const cluster = makeCluster(59.33, 18.07)
    const stored = [makeStored('1', 59.33005, 18.07005)] // ~70m away

    const action = determineClusterAction(cluster, stored)

    expect(action.type).toBe('update')
    if (action.type === 'update') {
      expect(action.id).toBe('1')
    }
  })

  test('sets needsReGeocode true when location moved more than threshold', () => {
    const cluster = makeCluster(59.33, 18.07)
    const stored = [makeStored('1', 59.3308, 18.0708)] // ~120m away

    const action = determineClusterAction(cluster, stored, 50) // 50m threshold

    expect(action.type).toBe('update')
    if (action.type === 'update') {
      expect(action.needsReGeocode).toBe(true)
    }
  })

  test('sets needsReGeocode false when location moved less than threshold', () => {
    const cluster = makeCluster(59.33, 18.07)
    const stored = [makeStored('1', 59.33002, 18.07002)] // ~30m away

    const action = determineClusterAction(cluster, stored, 50) // 50m threshold

    expect(action.type).toBe('update')
    if (action.type === 'update') {
      expect(action.needsReGeocode).toBe(false)
    }
  })

  test('matches to nearest stored location when multiple exist', () => {
    const cluster = makeCluster(59.33, 18.07)
    const stored = [
      makeStored('far', 59.335, 18.075), // ~700m away
      makeStored('near', 59.33005, 18.07005), // ~70m away
    ]

    const action = determineClusterAction(cluster, stored)

    expect(action.type).toBe('update')
    if (action.type === 'update') {
      expect(action.id).toBe('near')
    }
  })
})

describe('determineAllActions', () => {
  const makeCluster = (lat: number, lon: number): DetectedCluster => ({
    firstVisit: '2024-01-15T10:00:00Z',
    lastVisit: '2024-01-15T12:00:00Z',
    lat,
    lon,
    suggestedRadius: 200,
    totalMinutes: 120,
    visitCount: 1,
  })

  const makeStored = (id: string, lat: number, lon: number): DetectedLocation => ({
    address: null,
    created_at: new Date('2024-01-10'),
    first_visit: new Date('2024-01-10T10:00:00Z'),
    geocode_status: 'success',
    id,
    last_visit: new Date('2024-01-14T12:00:00Z'),
    lat,
    lon,
    radius: 200,
    total_minutes: 500,
    updated_at: new Date('2024-01-14'),
    visit_count: 5,
  })

  test('returns action for each cluster', () => {
    const clusters = [makeCluster(59.33, 18.07), makeCluster(59.4, 18.15)]
    const stored = [makeStored('1', 59.33005, 18.07005)]

    const actions = determineAllActions(clusters, stored)

    expect(actions).toHaveLength(2)
    expect(actions[0].type).toBe('update')
    expect(actions[1].type).toBe('create')
  })
})

describe('mergeClusterWithStored', () => {
  const makeCluster = (
    firstVisit: string,
    lastVisit: string,
    totalMinutes: number,
    visitCount: number,
  ): DetectedCluster => ({
    firstVisit,
    lastVisit,
    lat: 59.33,
    lon: 18.07,
    suggestedRadius: 200,
    totalMinutes,
    visitCount,
  })

  const makeStored = (
    firstVisit: Date,
    lastVisit: Date,
    totalMinutes: number,
    visitCount: number,
  ): DetectedLocation => ({
    address: null,
    created_at: new Date('2024-01-10'),
    first_visit: firstVisit,
    geocode_status: 'success',
    id: '1',
    last_visit: lastVisit,
    lat: 59.33005,
    lon: 18.07005,
    radius: 200,
    total_minutes: totalMinutes,
    updated_at: new Date('2024-01-14'),
    visit_count: visitCount,
  })

  test('adds up total minutes', () => {
    const cluster = makeCluster('2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.total_minutes).toBe(620)
  })

  test('adds up visit counts', () => {
    const cluster = makeCluster('2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z', 120, 2)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.visit_count).toBe(7)
  })

  test('uses earlier firstVisit', () => {
    const cluster = makeCluster('2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.first_visit).toEqual(new Date('2024-01-10T10:00:00Z'))
  })

  test('uses earlier cluster firstVisit when cluster is earlier', () => {
    const cluster = makeCluster('2024-01-05T10:00:00Z', '2024-01-05T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.first_visit).toEqual(new Date('2024-01-05T10:00:00Z'))
  })

  test('uses later lastVisit', () => {
    const cluster = makeCluster('2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.last_visit).toEqual(new Date('2024-01-15T12:00:00Z'))
  })

  test('uses stored lastVisit when stored is later', () => {
    const cluster = makeCluster('2024-01-10T10:00:00Z', '2024-01-10T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-05T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.last_visit).toEqual(new Date('2024-01-14T12:00:00Z'))
  })

  test('uses cluster coordinates', () => {
    const cluster = makeCluster('2024-01-15T10:00:00Z', '2024-01-15T12:00:00Z', 120, 1)
    const stored = makeStored(new Date('2024-01-10T10:00:00Z'), new Date('2024-01-14T12:00:00Z'), 500, 5)

    const merged = mergeClusterWithStored(cluster, stored)

    expect(merged.lat).toBe(59.33)
    expect(merged.lon).toBe(18.07)
  })
})
