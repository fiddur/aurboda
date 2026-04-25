/**
 * Location query functions.
 */

import type { PlaceSummary } from './types.ts'

import { getNamedLocations, insertActivities } from '../../db/index.ts'
import { materializeFromVisits } from '../location-visit-activities.ts'
import { getPlaceVisits } from '../locations.ts'

/**
 * Query locations/places for a time range.
 *
 * Side effect: visits to named locations with auto_create_activity=true are
 * fire-and-forget materialized as location_visit activities. This is a
 * backstop — the proactive path runs after each GPS ingestion (see
 * detection-trigger). Idempotent via (source, external_id) upsert, so the
 * two paths can't double-insert.
 */
export async function queryLocations(user: string, start: Date, end: Date): Promise<PlaceSummary[]> {
  const visits = await getPlaceVisits(user, start, end)

  // Fire-and-forget. Don't let materialization failures surface to the user —
  // the /locations response is still valid GPS data either way.
  void materializeFromVisits(user, visits, { getNamedLocations, insertActivities }).catch((err) => {
    console.error('location_visit activity materialization failed:', err)
  })

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
