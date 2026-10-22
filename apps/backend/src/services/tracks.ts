import type { ActivityTrack } from '@aurboda/api-spec'

import type { ActivityTrackRecord } from '../db/tracks.ts'

export interface TrackPoint {
  lat: number
  lon: number
  alt?: number | null
  time: Date
}

export interface BuiltTrack {
  ewkt: string
  point_count: number
  start: Date
  end: Date
}

/** A fix this far before the activity start is noise from a previous recording, not part of the track. */
const EARLY_TOLERANCE_MS = 60_000

const round = (value: number, decimals: number): string => {
  const fixed = value.toFixed(decimals)
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed
}

const isUsable = (p: TrackPoint, earliest: number): boolean =>
  Number.isFinite(p.lat) &&
  Number.isFinite(p.lon) &&
  !(p.lat === 0 && p.lon === 0) &&
  Math.abs(p.lat) <= 90 &&
  Math.abs(p.lon) <= 180 &&
  Number.isFinite(p.time.getTime()) &&
  p.time.getTime() >= earliest

/** EWKT `SRID=4326;LINESTRING ZM(lon lat z m, …)` from raw fixes, or null when fewer than two usable points. */
export const buildTrack = (points: TrackPoint[], startTime: Date): BuiltTrack | null => {
  const origin = startTime.getTime()
  const sorted = points
    .filter((p) => isUsable(p, origin - EARLY_TOLERANCE_MS))
    .map((p, index) => ({ index, p }))
    .sort((a, b) => a.p.time.getTime() - b.p.time.getTime() || a.index - b.index)
    .map(({ p }) => p)

  const deduped = sorted.filter((p, i) => i === 0 || p.time.getTime() !== sorted[i - 1].time.getTime())
  if (deduped.length < 2) return null

  const coords = deduped.map((p) => {
    const z = p.alt != null && Number.isFinite(p.alt) ? p.alt : 0
    const m = Math.max(0, (p.time.getTime() - origin) / 1000)
    return `${round(p.lon, 7)} ${round(p.lat, 7)} ${round(z, 1)} ${round(m, 3)}`
  })

  return {
    end: deduped[deduped.length - 1].time,
    ewkt: `SRID=4326;LINESTRING ZM(${coords.join(', ')})`,
    point_count: deduped.length,
    start: deduped[0].time,
  }
}

/** Google encoded polyline (precision 1e-5) → [lat, lon][]; an invalid string yields []. */
export const decodePolyline = (encoded: string): [number, number][] => {
  const values: number[] = []
  let result = 0
  let shift = 0
  for (let i = 0; i < encoded.length; i++) {
    const byte = encoded.charCodeAt(i) - 63
    if (byte < 0 || byte > 63) return []
    result |= (byte & 0x1f) << shift
    shift += 5
    if (byte < 0x20) {
      values.push(result & 1 ? ~(result >> 1) : result >> 1)
      result = 0
      shift = 0
    } else if (shift > 30) {
      return []
    }
  }
  if (shift !== 0 || values.length % 2 !== 0) return []

  const coords: [number, number][] = []
  let lat = 0
  let lon = 0
  for (let i = 0; i < values.length; i += 2) {
    lat += values[i]
    lon += values[i + 1]
    const point: [number, number] = [lat / 1e5, lon / 1e5]
    if (Math.abs(point[0]) > 90 || Math.abs(point[1]) > 180) return []
    coords.push(point)
  }
  return coords
}

/** Evenly spread timestamps over [start, start + elapsedSeconds] for a shape-only polyline. */
export const polylineToTrackPoints = (
  coords: [number, number][],
  start: Date,
  elapsedSeconds: number,
): TrackPoint[] => {
  const last = Math.max(1, coords.length - 1)
  return coords.map(([lat, lon], i) => ({
    lat,
    lon,
    time: new Date(start.getTime() + (i * elapsedSeconds * 1000) / last),
  }))
}

export const serializeActivityTrack = (record: ActivityTrackRecord): ActivityTrack => ({
  activity_id: record.activity_id,
  full_resolution: record.full_resolution,
  length_m: record.length_m,
  point_count: record.point_count,
  points: record.points,
  source: record.source,
})

/** Track points as timestamped fixes, the shape the `gps` field of the full activity detail uses. */
export const trackToGps = (record: ActivityTrackRecord): { lat: number; lon: number; time: string }[] => {
  const origin = record.start_time.getTime()
  return record.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    time: new Date(origin + p.t * 1000).toISOString(),
  }))
}
