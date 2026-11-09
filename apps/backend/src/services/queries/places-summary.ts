import type { PlacesSummary, PlacesSummaryPlace } from '@aurboda/api-spec'

import { getPlaceVisits, type PlaceVisit } from '../locations.ts'
import { detectOvernightStays } from './location-stays.ts'

export interface PlacesSummaryDeps {
  getPlaceVisits: (user: string, start: Date, end: Date) => Promise<PlaceVisit[]>
}

export interface PlacesSummaryParams {
  end: Date
  homeName?: string
  start: Date
  tz: string
}

const DAY_MS = 86_400_000
const TOP_PLACES = 5

const groupByName = (visits: PlaceVisit[]): Map<string, PlaceVisit[]> => {
  const byName = new Map<string, PlaceVisit[]>()
  for (const v of visits) byName.getOrInsert(v.name, []).push(v)
  return byName
}

const overlapHours = (v: PlaceVisit, startMs: number, endMs: number): number =>
  Math.max(0, Math.min(v.end_time.getTime(), endMs) - Math.max(v.start_time.getTime(), startMs)) / 3_600_000

/** YYYY-MM-DD of `epochMs` in tz; overnight dates compare as strings. */
const dateInTz = (epochMs: number, tz: string): string =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tz).toPlainDate().toString()

const nightsByPlace = (byName: Map<string, PlaceVisit[]>, params: PlacesSummaryParams, home: string) => {
  const firstNight = dateInTz(params.start.getTime(), params.tz)
  const lastNight = dateInTz(params.end.getTime(), params.tz)
  const homeNights = new Set<string>()
  const awayNights = new Set<string>()
  for (const [name, visits] of byName) {
    const nights = name.toLowerCase() === home ? homeNights : awayNights
    for (const stay of detectOvernightStays(visits, params.tz)) {
      if (stay.overnight_date >= firstNight && stay.overnight_date <= lastNight)
        {nights.add(stay.overnight_date)}
    }
  }
  return {
    nights_away: [...awayNights].filter((night) => !homeNights.has(night)).length,
    nights_home: homeNights.size,
  }
}

const topPlaces = (byName: Map<string, PlaceVisit[]>, startMs: number, endMs: number): PlacesSummaryPlace[] =>
  [...byName]
    .map(([name, visits]) => ({
      hours: visits.reduce((total, v) => total + overlapHours(v, startMs, endMs), 0),
      name,
      visits: visits.length,
    }))
    .sort((a, b) => b.visits - a.visits || b.hours - a.hours || a.name.localeCompare(b.name))
    .slice(0, TOP_PLACES)
    .map((p) => ({ ...p, hours: Math.round(p.hours * 10) / 10 }))

/**
 * Visits to named and detected places over `[start, end]`. Overnight stays are detected per place
 * over the range widened by a day each side, and a night belongs to the range when its evening date
 * (in tz) does, so a stay running across the range's end still counts its nights inside it; a night
 * with stays both at home and elsewhere counts as home.
 */
export const getPlacesSummary = async (
  user: string,
  params: PlacesSummaryParams,
  deps: PlacesSummaryDeps = { getPlaceVisits },
): Promise<PlacesSummary> => {
  const startMs = params.start.getTime()
  const endMs = params.end.getTime()
  const visits = (
    await deps.getPlaceVisits(user, new Date(startMs - DAY_MS), new Date(endMs + DAY_MS))
  ).filter((v) => v.source !== 'unknown' && v.name.trim() !== '')
  const inRange = visits.filter((v) => v.end_time.getTime() >= startMs && v.start_time.getTime() <= endMs)
  const inRangeByName = groupByName(inRange)
  return {
    ...nightsByPlace(groupByName(visits), params, (params.homeName ?? 'Home').toLowerCase()),
    distinct_places: inRangeByName.size,
    places: topPlaces(inRangeByName, startMs, endMs),
    visits: inRange.length,
  }
}
