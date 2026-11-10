import type { PlacesSummary, PlacesSummaryNights, PlacesSummaryPlace } from '@aurboda/api-spec'

import { getNamedLocations, getPlaceVisits, type NamedLocation, type PlaceVisit } from '../locations.ts'

export interface PlacesSummaryDeps {
  getNamedLocations: (user: string) => Promise<Pick<NamedLocation, 'name'>[]>
  getPlaceVisits: (user: string, start: Date, end: Date) => Promise<PlaceVisit[]>
}

export interface PlacesSummaryParams {
  end: Date
  homeName?: string
  start: Date
  tz: string
}

/** A visit with its named place, or null when it is elsewhere; `key` tells places apart. */
export interface CanonicalVisit {
  end_time: Date
  key: string
  place: string | null
  start_time: Date
}

export type NightPlace = { kind: 'elsewhere' } | { kind: 'named'; name: string } | { kind: 'no_data' }

export interface NightAttribution {
  date: string
  place: NightPlace
}

const DAY_MS = 86_400_000
const HOUR_MS = 3_600_000
const BRIDGE_MS = 36 * HOUR_MS
const AT_REST_MS = 18 * HOUR_MS
const PROBE_TIME = new Temporal.PlainTime(3, 0)
const TOP_PLACES = 5

const normalize = (name: string): string => name.trim().toLowerCase()

/**
 * A named visit is its named location; an OwnTracks region named like a named location (it often
 * reaches past the named radius) is that named location, in its spelling; anything else is elsewhere.
 */
export const canonicalPlace = (visit: PlaceVisit, namedByKey: Map<string, string>): string | null => {
  if (visit.source === 'named') return visit.name
  if (visit.source === 'owntracks') return namedByKey.get(normalize(visit.name)) ?? null
  return null
}

const canonicalVisit = (visit: PlaceVisit, namedByKey: Map<string, string>): CanonicalVisit => {
  const place = canonicalPlace(visit, namedByKey)
  return { end_time: visit.end_time, key: place ?? `~${visit.name}`, place, start_time: visit.start_time }
}

/** Joins consecutive visits to the same place at most 36 hours apart into one. */
export const mergeVisits = (visits: CanonicalVisit[]): CanonicalVisit[] => {
  const sorted = visits.toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const merged: CanonicalVisit[] = []
  for (const visit of sorted) {
    const last = merged.at(-1)
    if (last && last.key === visit.key && visit.start_time.getTime() - last.end_time.getTime() <= BRIDGE_MS) {
      if (visit.end_time > last.end_time) last.end_time = visit.end_time
    } else {
      merged.push({ ...visit })
    }
  }
  return merged
}

const dateInTz = (epochMs: number, tz: string): Temporal.PlainDate =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tz).toPlainDate()

const placeOf = (visit: CanonicalVisit): NightPlace =>
  visit.place === null ? { kind: 'elsewhere' } : { kind: 'named', name: visit.place }

const placeAt = (visits: CanonicalVisit[], probeMs: number): NightPlace => {
  const nextIndex = visits.findIndex((v) => v.start_time.getTime() > probeMs)
  const prev = visits[(nextIndex === -1 ? visits.length : nextIndex) - 1]
  const next = nextIndex === -1 ? undefined : visits[nextIndex]
  if (!prev) return { kind: 'no_data' }
  const prevEnd = prev.end_time.getTime()
  if (prevEnd >= probeMs) return placeOf(prev)
  if (next && next.key === prev.key && next.start_time.getTime() - prevEnd <= BRIDGE_MS) return placeOf(prev)
  if (probeMs - prevEnd <= AT_REST_MS) return placeOf(prev)
  return { kind: 'no_data' }
}

/**
 * The place of each night whose evening date (in tz) falls in `[start, end]`: where the user was at
 * 03:00 the next morning. A phone at rest reports nothing, so a gap between two visits to the same
 * place, or a short while after the last visit, still counts as being there.
 */
export const attributeNights = (
  visits: CanonicalVisit[],
  params: Pick<PlacesSummaryParams, 'end' | 'start' | 'tz'>,
): NightAttribution[] => {
  const sorted = visits.toSorted((a, b) => a.start_time.getTime() - b.start_time.getTime())
  const lastNight = dateInTz(params.end.getTime(), params.tz)
  const nights: NightAttribution[] = []
  for (
    let night = dateInTz(params.start.getTime(), params.tz);
    Temporal.PlainDate.compare(night, lastNight) <= 0;
    night = night.add({ days: 1 })
  ) {
    const probe = night
      .add({ days: 1 })
      .toZonedDateTime({ plainTime: PROBE_TIME, timeZone: params.tz }).epochMilliseconds
    nights.push({ date: night.toString(), place: placeAt(sorted, probe) })
  }
  return nights
}

const overlapHours = (v: CanonicalVisit, startMs: number, endMs: number): number =>
  Math.max(0, Math.min(v.end_time.getTime(), endMs) - Math.max(v.start_time.getTime(), startMs)) / HOUR_MS

const countNights = (nights: NightAttribution[], homeName: string) => {
  const byPlace = new Map<string, number>()
  let elsewhere = 0
  let noData = 0
  for (const { place } of nights) {
    if (place.kind === 'named') byPlace.set(place.name, (byPlace.get(place.name) ?? 0) + 1)
    else if (place.kind === 'elsewhere') elsewhere++
    else noData++
  }
  const nightsByPlace: PlacesSummaryNights[] = [...byPlace]
    .map(([name, count]) => ({ name, nights: count }))
    .sort((a, b) => b.nights - a.nights || a.name.localeCompare(b.name))
  const home = normalize(homeName)
  const nightsHome = nightsByPlace.filter((p) => normalize(p.name) === home).reduce((n, p) => n + p.nights, 0)
  return {
    byPlace,
    nights_away: nights.length - noData - nightsHome,
    nights_by_place: nightsByPlace,
    nights_elsewhere: elsewhere,
    nights_home: nightsHome,
    nights_no_data: noData,
  }
}

const namedPlaces = (
  visits: CanonicalVisit[],
  nights: Map<string, number>,
  startMs: number,
  endMs: number,
): PlacesSummaryPlace[] => {
  const byName = new Map<string, { hours: number; visits: number }>()
  for (const v of visits) {
    if (v.place === null) continue
    const totals = byName.getOrInsert(v.place, { hours: 0, visits: 0 })
    totals.hours += overlapHours(v, startMs, endMs)
    totals.visits++
  }
  return [...byName].map(([name, totals]) => ({
    hours: Math.round(totals.hours * 10) / 10,
    name,
    nights: nights.get(name) ?? 0,
    visits: totals.visits,
  }))
}

/**
 * Where the nights of `[start, end]` were spent and the named places visited. Visits are fetched
 * over the range widened by two days each side, so the nights at its edges have visits around them.
 */
export const getPlacesSummary = async (
  user: string,
  params: PlacesSummaryParams,
  deps: PlacesSummaryDeps = { getNamedLocations, getPlaceVisits },
): Promise<PlacesSummary> => {
  const startMs = params.start.getTime()
  const endMs = params.end.getTime()
  const [namedLocations, visits] = await Promise.all([
    deps.getNamedLocations(user),
    deps.getPlaceVisits(user, new Date(startMs - 2 * DAY_MS), new Date(endMs + 2 * DAY_MS)),
  ])
  const namedByKey = new Map(namedLocations.map((n) => [normalize(n.name), n.name]))
  const merged = mergeVisits(visits.map((v) => canonicalVisit(v, namedByKey)))
  const { byPlace, ...nights } = countNights(attributeNights(merged, params), params.homeName ?? 'Home')
  const places = namedPlaces(
    merged.filter((v) => v.end_time.getTime() >= startMs && v.start_time.getTime() <= endMs),
    byPlace,
    startMs,
    endMs,
  )
  return {
    ...nights,
    distinct_places: places.length,
    places: places
      .toSorted((a, b) => b.nights - a.nights || b.hours - a.hours || a.name.localeCompare(b.name))
      .slice(0, TOP_PLACES),
    visits: places.reduce((n, p) => n + p.visits, 0),
  }
}
