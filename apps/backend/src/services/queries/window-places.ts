import { getNamedLocations, getPlaceVisits, type NamedLocation, type PlaceVisit } from '../locations.ts'
import { canonicalPlace } from './places-summary.ts'

export interface TimeWindow {
  end: Date
  start: Date
}

export interface WindowPlacesDeps {
  getNamedLocations: (user: string) => Promise<Pick<NamedLocation, 'name'>[]>
  getPlaceVisits: (user: string, start: Date, end: Date) => Promise<PlaceVisit[]>
}

/** As the detail pages ask `GET /locations` for. */
export const WINDOW_PLACE_LAST_KNOWN_HOURS = 6

const HOUR_MS = 3_600_000

/**
 * The named place of a window (see `canonicalPlace`): of the visits it meets, the named place it
 * overlaps longest. A window that meets no visit gets the place of the last visit ending at most
 * `lastKnownMs` before it, since a phone at rest reports nothing; otherwise it has none.
 * `visits` are in start order.
 */
export const placeOfWindow = (
  visits: PlaceVisit[],
  namedByKey: Map<string, string>,
  window: TimeWindow,
  lastKnownMs: number,
): string | null => {
  const startMs = window.start.getTime()
  const endMs = window.end.getTime()
  const overlaps = new Map<string, number>()
  let met = false
  for (const v of visits) {
    if (v.start_time.getTime() > endMs || v.end_time.getTime() < startMs) continue
    met = true
    const place = canonicalPlace(v, namedByKey)
    if (place === null) continue
    const overlap = Math.max(
      0,
      Math.min(v.end_time.getTime(), endMs) - Math.max(v.start_time.getTime(), startMs),
    )
    overlaps.set(place, (overlaps.get(place) ?? 0) + overlap)
  }
  if (met) {
    let best: [string, number] | undefined
    for (const entry of overlaps) if (!best || entry[1] > best[1]) best = entry
    return best?.[0] ?? null
  }
  const last = visits.findLast((v) => v.end_time.getTime() < startMs)
  return last && startMs - last.end_time.getTime() <= lastKnownMs ? canonicalPlace(last, namedByKey) : null
}

/**
 * The named place of each window, from one pass of place visits over all of them (widened back by
 * the last-known lookback). Resolved per query, so renaming or merging a place needs no backfill.
 */
export const placesOfWindows = async (
  user: string,
  windows: TimeWindow[],
  deps: WindowPlacesDeps = { getNamedLocations, getPlaceVisits },
  lastKnownHours = WINDOW_PLACE_LAST_KNOWN_HOURS,
): Promise<(string | null)[]> => {
  if (windows.length === 0) return []
  const lastKnownMs = lastKnownHours * HOUR_MS
  const startMs = Math.min(...windows.map((w) => w.start.getTime()))
  const endMs = Math.max(...windows.map((w) => w.end.getTime()))
  const [namedLocations, visits] = await Promise.all([
    deps.getNamedLocations(user),
    deps.getPlaceVisits(user, new Date(startMs - lastKnownMs), new Date(endMs)),
  ])
  const namedByKey = new Map(namedLocations.map((n) => [n.name.trim().toLowerCase(), n.name]))
  const sorted = visits.toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
  return windows.map((w) => placeOfWindow(sorted, namedByKey, w, lastKnownMs))
}
