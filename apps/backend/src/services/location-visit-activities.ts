/**
 * Convert place visits to `location_visit` activities, for named locations
 * the user has opted into with `auto_create_activity=true`.
 *
 * Place visits are computed on-demand from raw GPS data via getPlaceVisits;
 * they are not persisted. This module turns the ephemeral visits into
 * first-class activities so they show up in charts, daily summaries, and
 * deduction-rule queries that read from the unified activities table.
 *
 * Idempotent: external_id is `locvisit_${named_location_id}_${startEpochMs}`,
 * so re-running for the same range upserts cleanly via the
 * (source, external_id) unique index.
 */

import type { Activity, NamedLocation } from '../db/types.ts'
import type { PlaceVisit } from './locations.ts'

/** Minimum visit duration before we materialize an activity. */
const MIN_VISIT_MINUTES = 10

export const visitsToActivities = (visits: PlaceVisit[], namedLocations: NamedLocation[]): Activity[] => {
  const optedInById = new Map<string, NamedLocation>()
  for (const nl of namedLocations) {
    if (nl.auto_create_activity) optedInById.set(nl.id, nl)
  }
  if (optedInById.size === 0) return []

  const activities: Activity[] = []
  for (const visit of visits) {
    if (visit.source !== 'named' || !visit.named_location_id) continue
    const named = optedInById.get(visit.named_location_id)
    if (!named) continue
    if (visit.duration_minutes < MIN_VISIT_MINUTES) continue
    activities.push({
      activity_type: 'location_visit',
      data: {
        lat: visit.lat,
        location_name: visit.name,
        lon: visit.lon,
      },
      end_time: visit.end_time,
      external_id: `locvisit_${visit.named_location_id}_${visit.start_time.getTime()}`,
      source: 'location-detection',
      start_time: visit.start_time,
    })
  }
  return activities
}
