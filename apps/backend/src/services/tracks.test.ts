import { describe, expect, test } from 'vitest'

import { buildTrack, decodePolyline, polylineToTrackPoints } from './tracks.ts'

const start = new Date('2026-05-01T08:00:00Z')
const at = (seconds: number): Date => new Date(start.getTime() + seconds * 1000)

describe('buildTrack', () => {
  test('writes lon lat z m in EWKT with M in seconds since start', () => {
    const track = buildTrack(
      [
        { alt: 12.34, lat: 59.3293, lon: 18.0686, time: at(0) },
        { alt: 15, lat: 59.33, lon: 18.07, time: at(1.5) },
      ],
      start,
    )
    expect(track).toEqual({
      end: at(1.5),
      ewkt: 'SRID=4326;LINESTRING ZM(18.0686 59.3293 12.3 0, 18.07 59.33 15 1.5)',
      point_count: 2,
      start: at(0),
    })
  })

  test('defaults Z to 0 when altitude is unknown', () => {
    const track = buildTrack(
      [
        { alt: null, lat: 1, lon: 2, time: at(0) },
        { lat: 1.1, lon: 2.1, time: at(10) },
      ],
      start,
    )
    expect(track?.ewkt).toBe('SRID=4326;LINESTRING ZM(2 1 0 0, 2.1 1.1 0 10)')
  })

  test('drops 0,0 fixes and non-finite coordinates', () => {
    const track = buildTrack(
      [
        { lat: 0, lon: 0, time: at(0) },
        { lat: Number.NaN, lon: 18, time: at(1) },
        { lat: 59, lon: 18, time: at(2) },
        { lat: 59.1, lon: 18.1, time: at(3) },
      ],
      start,
    )
    expect(track?.point_count).toBe(2)
    expect(track?.start).toEqual(at(2))
  })

  test('sorts by time and keeps the first of two points sharing a timestamp', () => {
    const track = buildTrack(
      [
        { lat: 3, lon: 3, time: at(20) },
        { lat: 1, lon: 1, time: at(0) },
        { lat: 2, lon: 2, time: at(10) },
        { lat: 9, lon: 9, time: at(10) },
      ],
      start,
    )
    expect(track?.ewkt).toBe('SRID=4326;LINESTRING ZM(1 1 0 0, 2 2 0 10, 3 3 0 20)')
    expect(track?.point_count).toBe(3)
  })

  test('returns null for fewer than two distinct points', () => {
    expect(buildTrack([], start)).toBeNull()
    expect(buildTrack([{ lat: 1, lon: 1, time: at(0) }], start)).toBeNull()
    expect(
      buildTrack(
        [
          { lat: 1, lon: 1, time: at(5) },
          { lat: 2, lon: 2, time: at(5) },
        ],
        start,
      ),
    ).toBeNull()
  })

  test('clamps M at 0 for fixes slightly before the start and drops those over a minute early', () => {
    const track = buildTrack(
      [
        { lat: 5, lon: 5, time: at(-120) },
        { lat: 1, lon: 1, time: at(-30) },
        { lat: 2, lon: 2, time: at(30) },
      ],
      start,
    )
    expect(track?.ewkt).toBe('SRID=4326;LINESTRING ZM(1 1 0 0, 2 2 0 30)')
    expect(track?.start).toEqual(at(-30))
  })
})

describe('decodePolyline', () => {
  test('decodes the Google documentation example', () => {
    expect(decodePolyline('_p~iF~ps|U_ulLnnqC_mqNvxq`@')).toEqual([
      [38.5, -120.2],
      [40.7, -120.95],
      [43.252, -126.453],
    ])
  })

  test('yields [] for an empty or invalid string', () => {
    expect(decodePolyline('')).toEqual([])
    expect(decodePolyline('not a polyline!')).toEqual([])
    expect(decodePolyline('_p~iF~ps|U_ulL')).toEqual([])
  })
})

describe('polylineToTrackPoints', () => {
  test('spreads timestamps evenly from the start to the elapsed time', () => {
    const points = polylineToTrackPoints(
      [
        [1, 2],
        [3, 4],
        [5, 6],
      ],
      start,
      100,
    )
    expect(points).toEqual([
      { lat: 1, lon: 2, time: at(0) },
      { lat: 3, lon: 4, time: at(50) },
      { lat: 5, lon: 6, time: at(100) },
    ])
  })

  test('a single coordinate sits at the start', () => {
    expect(polylineToTrackPoints([[1, 2]], start, 100)).toEqual([{ lat: 1, lon: 2, time: at(0) }])
  })
})
