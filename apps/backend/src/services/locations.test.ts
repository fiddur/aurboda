import { describe, expect, test } from 'vitest'
import {
  clusterStays,
  detectStays,
  LocationPoint,
  mergeShortUnknownVisits,
  PlaceVisit,
  Stay,
} from './locations'

describe('detectStays', () => {
  const makePoint = (lat: number, lon: number, minutesOffset: number): LocationPoint => ({
    lat,
    lon,
    time: new Date(Date.UTC(2024, 0, 15, 10, minutesOffset, 0)),
  })

  test('returns empty array for empty input', () => {
    expect(detectStays([])).toEqual([])
  })

  test('returns empty array for single point', () => {
    const points = [makePoint(59.33, 18.07, 0)]
    expect(detectStays(points)).toEqual([])
  })

  test('detects a stay when points are within radius for 60+ minutes', () => {
    // Points within ~100m of each other over 90 minutes
    const points = [
      makePoint(59.33, 18.07, 0),
      makePoint(59.33005, 18.07005, 15),
      makePoint(59.3301, 18.0701, 30),
      makePoint(59.33005, 18.07005, 45),
      makePoint(59.33, 18.07, 60),
      makePoint(59.33005, 18.07005, 90),
    ]

    const stays = detectStays(points, 200, 60)

    expect(stays).toHaveLength(1)
    expect(stays[0].durationMinutes).toBe(90)
    expect(stays[0].lat).toBeCloseTo(59.33, 2)
    expect(stays[0].lon).toBeCloseTo(18.07, 2)
  })

  test('does not detect stay if duration is less than minimum', () => {
    // Points within radius but only 45 minutes
    const points = [
      makePoint(59.33, 18.07, 0),
      makePoint(59.33005, 18.07005, 15),
      makePoint(59.3301, 18.0701, 30),
      makePoint(59.33005, 18.07005, 45),
    ]

    const stays = detectStays(points, 200, 60)
    expect(stays).toHaveLength(0)
  })

  test('detects multiple stays', () => {
    // First stay: 0-90 minutes at location A
    // Movement: 100 minutes
    // Second stay: 110-200 minutes at location B (far away)
    const points = [
      // Stay 1 (59.33, 18.07)
      makePoint(59.33, 18.07, 0),
      makePoint(59.33005, 18.07005, 30),
      makePoint(59.33, 18.07, 60),
      makePoint(59.33005, 18.07005, 90),
      // Movement
      makePoint(59.35, 18.1, 100),
      // Stay 2 (59.40, 18.15) - ~10km away
      makePoint(59.4, 18.15, 110),
      makePoint(59.40005, 18.15005, 140),
      makePoint(59.4, 18.15, 170),
      makePoint(59.40005, 18.15005, 200),
    ]

    const stays = detectStays(points, 200, 60)

    expect(stays).toHaveLength(2)
    expect(stays[0].durationMinutes).toBe(90)
    expect(stays[0].lat).toBeCloseTo(59.33, 2)
    expect(stays[1].durationMinutes).toBe(90)
    expect(stays[1].lat).toBeCloseTo(59.4, 2)
  })

  test('respects custom radius', () => {
    // Points are ~150m apart - should be one stay with 200m radius, two with 100m
    const points = [
      makePoint(59.33, 18.07, 0),
      makePoint(59.331, 18.071, 30), // ~140m away
      makePoint(59.33, 18.07, 60),
      makePoint(59.331, 18.071, 90),
    ]

    const staysLargeRadius = detectStays(points, 200, 60)
    expect(staysLargeRadius).toHaveLength(1)

    const staysSmallRadius = detectStays(points, 100, 60)
    expect(staysSmallRadius).toHaveLength(0) // Can't form valid stay with small radius
  })
})

describe('clusterStays', () => {
  const makeStay = (lat: number, lon: number, durationMinutes: number, dayOffset: number): Stay => ({
    durationMinutes,
    endTime: new Date(Date.UTC(2024, 0, 15 + dayOffset, 12, 0, 0)),
    lat,
    lon,
    points: [{ lat, lon, time: new Date(Date.UTC(2024, 0, 15 + dayOffset, 10, 0, 0)) }],
    startTime: new Date(Date.UTC(2024, 0, 15 + dayOffset, 10, 0, 0)),
  })

  test('returns empty array for empty input', () => {
    expect(clusterStays([])).toEqual([])
  })

  test('returns single cluster for single stay', () => {
    const stays = [makeStay(59.33, 18.07, 120, 0)]

    const clusters = clusterStays(stays)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].lat).toBeCloseTo(59.33, 2)
    expect(clusters[0].lon).toBeCloseTo(18.07, 2)
    expect(clusters[0].totalMinutes).toBe(120)
    expect(clusters[0].visitCount).toBe(1)
  })

  test('clusters nearby stays together', () => {
    // Two stays at the same location on different days
    const stays = [
      makeStay(59.33, 18.07, 120, 0),
      makeStay(59.3305, 18.0705, 90, 1), // ~70m away
    ]

    const clusters = clusterStays(stays, 200)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].totalMinutes).toBe(210)
    expect(clusters[0].visitCount).toBe(2)
  })

  test('keeps distant stays as separate clusters', () => {
    // Two stays at different locations
    const stays = [
      makeStay(59.33, 18.07, 120, 0),
      makeStay(59.4, 18.15, 90, 1), // ~10km away
    ]

    const clusters = clusterStays(stays, 200)

    expect(clusters).toHaveLength(2)
    expect(clusters[0].totalMinutes).toBe(120)
    expect(clusters[1].totalMinutes).toBe(90)
  })

  test('tracks first and last visit times', () => {
    const stays = [
      makeStay(59.33, 18.07, 60, 0),
      makeStay(59.33, 18.07, 60, 5),
      makeStay(59.33, 18.07, 60, 10),
    ]

    const clusters = clusterStays(stays)

    expect(clusters).toHaveLength(1)
    expect(clusters[0].visitCount).toBe(3)
    expect(clusters[0].firstVisit).toContain('2024-01-15')
    expect(clusters[0].lastVisit).toContain('2024-01-25')
  })
})

describe('mergeShortUnknownVisits', () => {
  const makeVisit = (
    name: string,
    source: PlaceVisit['source'],
    startMinutes: number,
    durationMinutes: number,
  ): PlaceVisit => {
    const startTime = new Date(Date.UTC(2024, 0, 15, 10, startMinutes, 0))
    const endTime = new Date(startTime.getTime() + durationMinutes * 60 * 1000)
    return {
      durationMinutes,
      endTime,
      lat: 59.33,
      lon: 18.07,
      name,
      source,
      startTime,
    }
  }

  test('returns empty array for empty input', () => {
    expect(mergeShortUnknownVisits([])).toEqual([])
  })

  test('keeps all visits when none are short unknown', () => {
    const visits = [makeVisit('Home', 'named', 0, 60), makeVisit('Office', 'named', 70, 120)]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Home')
    expect(result[1].name).toBe('Office')
  })

  test('keeps unknown visits that are >= 5 minutes', () => {
    const visits = [
      makeVisit('Home', 'named', 0, 60),
      makeVisit('Somewhere', 'unknown', 60, 10),
      makeVisit('Office', 'named', 70, 120),
    ]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(3)
    expect(result[1].name).toBe('Somewhere')
  })

  test('merges short unknown visit into previous visit', () => {
    const visits = [
      makeVisit('Home', 'named', 0, 60),
      makeVisit('Somewhere', 'unknown', 60, 3), // short GPS jump
      makeVisit('Office', 'named', 63, 120),
    ]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Home')
    expect(result[0].durationMinutes).toBe(63) // extended to cover the gap
    expect(result[1].name).toBe('Office')
  })

  test('extends next visit backwards when no previous visit exists', () => {
    const visits = [
      makeVisit('Somewhere', 'unknown', 0, 2), // short GPS jump at start
      makeVisit('Home', 'named', 2, 60),
    ]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('Home')
    expect(result[0].durationMinutes).toBe(62) // extended backwards
  })

  test('drops short unknown visit if it is the only visit', () => {
    const visits = [makeVisit('Somewhere', 'unknown', 0, 2)]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(0)
  })

  test('handles multiple short unknown visits in sequence', () => {
    const visits = [
      makeVisit('Home', 'named', 0, 60),
      makeVisit('Somewhere', 'unknown', 60, 2),
      makeVisit('Somewhere', 'unknown', 62, 1),
      makeVisit('Office', 'named', 63, 120),
    ]

    const result = mergeShortUnknownVisits(visits)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Home')
    expect(result[0].durationMinutes).toBe(63) // extended through both gaps
    expect(result[1].name).toBe('Office')
  })

  test('respects custom minDurationMinutes', () => {
    const visits = [
      makeVisit('Home', 'named', 0, 60),
      makeVisit('Somewhere', 'unknown', 60, 8), // 8 min, below 10 min threshold
      makeVisit('Office', 'named', 68, 120),
    ]

    const result = mergeShortUnknownVisits(visits, 10)

    expect(result).toHaveLength(2)
    expect(result[0].name).toBe('Home')
    expect(result[0].durationMinutes).toBe(68) // extended
  })
})
