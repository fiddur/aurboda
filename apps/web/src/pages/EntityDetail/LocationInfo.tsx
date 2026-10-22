import { useQuery } from '@tanstack/react-query'
import { format, isSameDay } from 'date-fns'

import { fetchPlaceVisits, type PlaceVisit } from '../../state/api'

/** How far after a meal's time to look for location data (meals have no end_time). */
export const MEAL_LOCATION_WINDOW_MS = 60 * 60_000 // 1 hour

const LOCATION_STALE_TIME_MS = 5 * 60_000 // 5 minutes

/** A phone at rest reports no fixes, so a stay may only show up as the last fix before it. */
const LAST_KNOWN_HOURS = 6

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

const placeHref = (place: PlaceVisit) =>
  `/places?date=${format(place.start_time, 'yyyy-MM-dd')}&name=${encodeURIComponent(place.name)}`

const placeName = (place: PlaceVisit) => (place.source === 'unknown' ? 'Unknown' : place.name)

const LastSeen = ({ place }: { place: PlaceVisit }) => {
  if (!place.inferred_from) return null
  const time = place.inferred_from
  return (
    <span class="location-inferred" title="No GPS fix in this time; this is where the last one before it was">
      {' '}
      last seen {format(time, isSameDay(time, place.start_time) ? 'HH:mm' : 'd MMM HH:mm')}
    </span>
  )
}

const PlaceEntry = ({ place }: { place: PlaceVisit }) => (
  <a href={placeHref(place)} class="location-entry" title={place.address ?? undefined}>
    <span
      class="location-dot"
      style={{ backgroundColor: SOURCE_COLORS[place.source] ?? SOURCE_COLORS.unknown }}
    />
    <span class="location-name">{placeName(place)}</span>
    {place.inferred_from ? (
      <LastSeen place={place} />
    ) : (
      <span class="location-duration">{formatDuration(place.durationMinutes)}</span>
    )}
  </a>
)

const SinglePlace = ({ place }: { place: PlaceVisit }) => (
  <>
    <a href={placeHref(place)} class="location-link" title={place.address ?? undefined}>
      <span
        class="location-dot"
        style={{ backgroundColor: SOURCE_COLORS[place.source] ?? SOURCE_COLORS.unknown }}
      />
      {placeName(place)}
    </a>
    <LastSeen place={place} />
  </>
)

const Places = ({ places }: { places: PlaceVisit[] }) =>
  places.length === 1 && places[0] ? (
    <SinglePlace place={places[0]} />
  ) : (
    <div class="location-list">
      {places.map((p, i) => (
        <PlaceEntry key={i} place={p} />
      ))}
    </div>
  )

const usePlaceVisits = (start: Date, end: Date) =>
  useQuery({
    enabled: end > start,
    queryFn: () => fetchPlaceVisits(start, end, LAST_KNOWN_HOURS),
    queryKey: ['entity-places', start.toISOString(), end.toISOString(), LAST_KNOWN_HOURS],
    staleTime: LOCATION_STALE_TIME_MS,
  }).data ?? []

export const LocationInfo = ({ start, end }: { start: Date; end: Date }) => {
  const places = usePlaceVisits(start, end)
  if (places.length === 0) return null
  return (
    <div class="entity-fields">
      <div class={places.length === 1 ? 'field-row' : 'field-row field-row-top'}>
        <span class="field-label">{places.length === 1 ? 'Location' : 'Locations'}</span>
        <span class="field-value">
          <Places places={places} />
        </span>
      </div>
    </div>
  )
}

export const LocationStatRow = ({ start, end }: { start: Date; end: Date }) => {
  const places = usePlaceVisits(start, end)
  if (places.length === 0) return null
  return (
    <tr>
      <th scope="row">{places.length === 1 ? 'Location' : 'Locations'}</th>
      <td>
        <Places places={places} />
      </td>
    </tr>
  )
}
