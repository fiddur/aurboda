/**
 * Displays named location(s) overlapping an entity's time range.
 * Uses the existing fetchPlaceVisits API to resolve time ranges to place visits.
 */
import { useQuery } from '@tanstack/react-query'
import { format } from 'date-fns'

import { fetchPlaceVisits, type PlaceVisit } from '../../state/api'

/** How far after a meal's time to look for location data (meals have no end_time). */
export const MEAL_LOCATION_WINDOW_MS = 60 * 60_000 // 1 hour

const LOCATION_STALE_TIME_MS = 5 * 60_000 // 5 minutes

const SOURCE_COLORS: Record<string, string> = {
  detected: '#f97316',
  named: '#22c55e',
  owntracks: '#3b82f6',
  unknown: '#9ca3af',
}

const formatDuration = (minutes: number): string => {
  if (minutes < 60) return `${Math.round(minutes)}m`
  const h = Math.floor(minutes / 60)
  const m = Math.round(minutes % 60)
  return m > 0 ? `${h}h ${m}m` : `${h}h`
}

const PlaceEntry = ({ place }: { place: PlaceVisit }) => {
  const color = SOURCE_COLORS[place.source] ?? SOURCE_COLORS.unknown
  const dateStr = format(place.start_time, 'yyyy-MM-dd')
  const href = `/places?date=${dateStr}&name=${encodeURIComponent(place.name)}`

  return (
    <a href={href} class="location-entry" title={place.address ?? undefined}>
      <span class="location-dot" style={{ backgroundColor: color }} />
      <span class="location-name">{place.source === 'unknown' ? 'Unknown' : place.name}</span>
      <span class="location-duration">{formatDuration(place.durationMinutes)}</span>
    </a>
  )
}

export const LocationInfo = ({ start, end }: { start: Date; end: Date }) => {
  const { data: places } = useQuery({
    enabled: end > start,
    queryFn: () => fetchPlaceVisits(start, end),
    queryKey: ['entity-places', start.toISOString(), end.toISOString()],
    staleTime: LOCATION_STALE_TIME_MS,
  })

  if (!places || places.length === 0) return null

  // Single location — render inline as a field row
  if (places.length === 1) {
    const p = places[0]
    const color = SOURCE_COLORS[p.source] ?? SOURCE_COLORS.unknown
    const dateStr = format(p.start_time, 'yyyy-MM-dd')
    const href = `/places?date=${dateStr}&name=${encodeURIComponent(p.name)}`

    return (
      <div class="entity-fields">
        <div class="field-row">
          <span class="field-label">Location</span>
          <span class="field-value">
            <a href={href} class="location-link">
              <span class="location-dot" style={{ backgroundColor: color }} />
              {p.source === 'unknown' ? 'Unknown' : p.name}
            </a>
          </span>
        </div>
      </div>
    )
  }

  // Multiple locations — render as a list
  return (
    <div class="entity-fields">
      <div class="field-row field-row-top">
        <span class="field-label">Locations</span>
        <div class="location-list">
          {places.map((p, i) => (
            <PlaceEntry key={i} place={p} />
          ))}
        </div>
      </div>
    </div>
  )
}
