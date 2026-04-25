/**
 * Overnight stay detection and location summary queries.
 *
 * Detects nights spent at a named location and aggregates visit statistics.
 * Computed at query time from PlaceVisits — no schema changes required.
 */

import type {
  LocationSummary,
  LocationSummaryBucket,
  LocationSummaryGroupBy,
  OvernightStay,
} from '@aurboda/api-spec'

import { Temporal } from '@js-temporal/polyfill'

import { getPlaceVisits as defaultGetPlaceVisits, type PlaceVisit } from '../locations.ts'

const DEFAULT_DEPARTURE_AFTER = '17:00'
const DEFAULT_ARRIVAL_BEFORE = '10:00'

interface HourMinute {
  hour: number
  minute: number
}

const parseHHMM = (hhmm: string): HourMinute => {
  const [h, m] = hhmm.split(':').map(Number)
  return { hour: h, minute: m }
}

/** Epoch ms for `date` at `time` (HH:MM) in tz. */
const epochAt = (date: Temporal.PlainDate, time: HourMinute, tz: string): number =>
  date.toZonedDateTime({ plainTime: new Temporal.PlainTime(time.hour, time.minute), timeZone: tz })
    .epochMilliseconds

/** YYYY-MM-DD of `instant` in tz. */
const dateInTz = (epochMs: number, tz: string): Temporal.PlainDate =>
  Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO(tz).toPlainDate()

interface OvernightOptions {
  departureAfter?: string
  arrivalBefore?: string
}

/**
 * Detect overnight stays from a set of place visits to a single location.
 * A night between day D and day D+1 counts when any visit spans both
 *   `D at departureAfter` (e.g. 17:00) and `D+1 at arrivalBefore` (e.g. 10:00),
 * all in the requested timezone.
 *
 * Multi-night visits (e.g. Fri 18:00 → Sun 10:00) yield one entry per night.
 */
export const detectOvernightStays = (
  visits: PlaceVisit[],
  tz: string,
  options: OvernightOptions = {},
): OvernightStay[] => {
  const evening = parseHHMM(options.departureAfter ?? DEFAULT_DEPARTURE_AFTER)
  const morning = parseHHMM(options.arrivalBefore ?? DEFAULT_ARRIVAL_BEFORE)

  const stays: OvernightStay[] = []
  for (const visit of visits) {
    const visitStart = visit.start_time.getTime()
    const visitEnd = visit.end_time.getTime()
    if (visitEnd <= visitStart) continue

    // For each midnight boundary (D → D+1) crossed by the visit, count an
    // overnight when the visit overlaps both the evening window on D
    // (>=17:00 of D) and the morning window on D+1 (<=10:00 of D+1).
    const startDay = dateInTz(visitStart, tz)
    const endDay = dateInTz(visitEnd, tz)
    let day = startDay
    while (Temporal.PlainDate.compare(day, endDay) < 0) {
      const eveningEpoch = epochAt(day, evening, tz)
      const nextDay = day.add({ days: 1 })
      const morningEpoch = epochAt(nextDay, morning, tz)
      if (visitEnd >= eveningEpoch && visitStart <= morningEpoch) {
        stays.push({
          arrival: visit.start_time.toISOString(),
          departure: visit.end_time.toISOString(),
          duration_hours: Math.round(((visitEnd - visitStart) / 3_600_000) * 10) / 10,
          overnight_date: day.toString(),
        })
      }
      day = nextDay
    }
  }
  return stays
}

interface SummaryOptions {
  groupBy?: LocationSummaryGroupBy
  tz: string
}

const periodKey = (date: Temporal.PlainDate, groupBy: LocationSummaryGroupBy): string => {
  switch (groupBy) {
    case 'day':
      return date.toString()
    case 'week': {
      const wy = date.weekOfYear ?? 1
      const yow = date.yearOfWeek ?? date.year
      return `${yow}-W${String(wy).padStart(2, '0')}`
    }
    case 'month':
      return `${date.year}-${String(date.month).padStart(2, '0')}`
    case 'year':
      return String(date.year)
  }
}

/**
 * Aggregate stats for a set of visits to a single location.
 */
export const summarizeVisits = (visits: PlaceVisit[], options: SummaryOptions): LocationSummary => {
  const totalHours = visits.reduce((sum, v) => sum + v.duration_minutes / 60, 0)
  const overnight = detectOvernightStays(visits, options.tz)

  const summary: LocationSummary = {
    total_hours: Math.round(totalHours * 10) / 10,
    total_nights: overnight.length,
    total_visits: visits.length,
  }

  if (!options.groupBy) return summary

  const buckets = new Map<string, LocationSummaryBucket>()
  for (const v of visits) {
    const date = dateInTz(v.start_time.getTime(), options.tz)
    const key = periodKey(date, options.groupBy)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { hours: 0, nights: 0, period: key, visits: 0 }
      buckets.set(key, bucket)
    }
    bucket.visits += 1
    bucket.hours += v.duration_minutes / 60
  }
  for (const stay of overnight) {
    const date = Temporal.PlainDate.from(stay.overnight_date)
    const key = periodKey(date, options.groupBy)
    let bucket = buckets.get(key)
    if (!bucket) {
      bucket = { hours: 0, nights: 0, period: key, visits: 0 }
      buckets.set(key, bucket)
    }
    bucket.nights += 1
  }
  // Round hours after summation to avoid drift.
  const breakdown = [...buckets.values()]
    .map((b) => ({ ...b, hours: Math.round(b.hours * 10) / 10 }))
    .sort((a, b) => a.period.localeCompare(b.period))
  summary.breakdown = breakdown
  return summary
}

interface QueryDeps {
  getPlaceVisits: (user: string, start: Date, end: Date) => Promise<PlaceVisit[]>
}

const defaultDeps: QueryDeps = { getPlaceVisits: defaultGetPlaceVisits }

/** Filter visits to a single named location by name (case-insensitive). */
const filterByName = (visits: PlaceVisit[], name: string): PlaceVisit[] => {
  const target = name.toLowerCase()
  return visits.filter((v) => v.source === 'named' && v.name.toLowerCase() === target)
}

export interface OvernightStaysParams {
  arrivalBefore?: string
  departureAfter?: string
  end: Date
  locationName: string
  start: Date
  tz: string
}

export interface OvernightStaysResult {
  data: OvernightStay[]
  total_nights: number
}

/**
 * Detect overnight stays at a named location within [start, end].
 * Widens the visit query by ±24h so visits that bridge the range edge are
 * still considered, then drops nights whose overnight_date falls outside
 * the requested window (in tz).
 */
export const queryOvernightStays = async (
  user: string,
  params: OvernightStaysParams,
  deps: QueryDeps = defaultDeps,
): Promise<OvernightStaysResult> => {
  const widenedStart = new Date(params.start.getTime() - 24 * 3_600_000)
  const widenedEnd = new Date(params.end.getTime() + 24 * 3_600_000)
  const allVisits = await deps.getPlaceVisits(user, widenedStart, widenedEnd)
  const visits = filterByName(allVisits, params.locationName)

  const stays = detectOvernightStays(visits, params.tz, {
    arrivalBefore: params.arrivalBefore,
    departureAfter: params.departureAfter,
  })

  // Keep stays whose departure (wake-up) falls within the requested window.
  const startMs = params.start.getTime()
  const endMs = params.end.getTime()
  const filtered = stays.filter((s) => {
    const departure = new Date(s.departure).getTime()
    return departure >= startMs && departure <= endMs
  })

  return { data: filtered, total_nights: filtered.length }
}

export interface LocationSummaryParams {
  end: Date
  groupBy?: LocationSummaryGroupBy
  locationName: string
  start: Date
  tz: string
}

/**
 * Aggregate visit statistics (visits, hours, overnight nights) for a named
 * location within [start, end], optionally grouped by day/week/month/year.
 */
export const getLocationSummary = async (
  user: string,
  params: LocationSummaryParams,
  deps: QueryDeps = defaultDeps,
): Promise<LocationSummary> => {
  const visits = filterByName(await deps.getPlaceVisits(user, params.start, params.end), params.locationName)
  return summarizeVisits(visits, { groupBy: params.groupBy, tz: params.tz })
}
