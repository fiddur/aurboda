/**
 * Location query functions.
 */

import type { PlaceSummary } from './types.ts'

import { getPlaceVisits } from '../locations.ts'

/**
 * Query locations/places for a time range.
 */
export async function queryLocations(user: string, start: Date, end: Date): Promise<PlaceSummary[]> {
  const visits = await getPlaceVisits(user, start, end)
  return visits.map((p) => ({
    address: p.address,
    detected_location_id: p.detected_location_id,
    duration: p.duration_minutes,
    end_time: p.end_time.toISOString(),
    lat: p.lat,
    lon: p.lon,
    name: p.name,
    source: p.source,
    start_time: p.start_time.toISOString(),
  }))
}
