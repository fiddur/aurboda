/**
 * Discriminated subtypes + type guards for the activity types whose `data`
 * shape is fixed by system code (not user-defined). Lets both the backend and
 * the frontend narrow `Activity` into a properly-typed subtype without
 * repeating ad-hoc `typeof a.data?.X === 'string' ? ... : ''` checks at every
 * call site.
 *
 * Type guards are generic over the activity shape so they work with either
 * the wire format (`Activity` with ISO-string timestamps) or consumer-side
 * variants (e.g. the frontend's `Activity` with `Date` fields).
 *
 * Activity types not listed here (exercise, sleep, custom user-defined,
 * etc.) keep the generic `Activity` shape with `data?: Record<string, unknown>`.
 */

/** `data` shape for `music_scrobble` activities. */
export interface MusicScrobbleData {
  artist: string
  track: string
  album?: string
}

/** `data` shape for `screentime` activities. `category_path` is `' > '`-joined. */
export interface ScreentimeData {
  category_path: string
  score?: number
}

/** `data` shape for `location_visit` activities. */
export interface LocationVisitData {
  lat: number
  lon: number
  location_name: string
}

/** Minimum surface a value must have before any of the type guards can run. */
type ActivityLike = { activity_type: string; data?: Record<string, unknown> }

export const isMusicScrobbleActivity = <A extends ActivityLike>(
  a: A,
): a is A & { activity_type: 'music_scrobble'; data: MusicScrobbleData } =>
  a.activity_type === 'music_scrobble' &&
  typeof a.data?.artist === 'string' &&
  typeof a.data?.track === 'string'

export const isScreentimeActivity = <A extends ActivityLike>(
  a: A,
): a is A & { activity_type: 'screentime'; data: ScreentimeData } =>
  a.activity_type === 'screentime' && typeof a.data?.category_path === 'string'

export const isLocationVisitActivity = <A extends ActivityLike>(
  a: A,
): a is A & { activity_type: 'location_visit'; data: LocationVisitData } =>
  a.activity_type === 'location_visit' &&
  typeof a.data?.lat === 'number' &&
  typeof a.data?.lon === 'number' &&
  typeof a.data?.location_name === 'string'
