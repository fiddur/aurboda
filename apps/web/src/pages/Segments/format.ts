import {
  type SegmentDetail,
  type SegmentEffort,
  type SegmentMatchResult,
  type SegmentsQuery,
  type SegmentSort,
  segmentSortOrders,
  type SuggestedSegmentScanResult,
} from '@aurboda/api-spec'

/** Where the segment was cut from, named when the activity's title or the route's name is known. */
export const cutFromLink = (
  segment: Pick<
    SegmentDetail,
    | 'created_from_activity_id'
    | 'created_from_activity_title'
    | 'created_from_route_id'
    | 'created_from_route_name'
  >,
): { href: string; label: string } | null => {
  if (segment.created_from_activity_id) {
    return {
      href: `/detail/activity/${segment.created_from_activity_id}`,
      label: segment.created_from_activity_title || 'an activity',
    }
  }
  if (segment.created_from_route_id) {
    return {
      href: `/routes/${segment.created_from_route_id}`,
      label: segment.created_from_route_name || 'a route',
    }
  }
  return null
}

const isSegmentSort = (value: string | undefined): value is SegmentSort =>
  segmentSortOrders.some((order) => order === value)

/** The segment list's filter and order from the page URL's `type` and `sort`; unknown sorts are ignored. */
export const segmentsQueryFromParams = (params: Record<string, string>): Partial<SegmentsQuery> => ({
  ...(params.type ? { activity_type: params.type } : {}),
  ...(isSegmentSort(params.sort) && params.sort !== 'last_effort' ? { sort: params.sort } : {}),
})

/** The page URL's query string for a filter and order, `''` for the defaults. */
export const searchFromSegmentsQuery = (query: Partial<SegmentsQuery>): string => {
  const params = new URLSearchParams()
  if (query.activity_type) params.set('type', query.activity_type)
  if (query.sort && query.sort !== 'last_effort') params.set('sort', query.sort)
  const search = params.toString()
  return search ? `?${search}` : ''
}

/**
 * Elapsed time in minutes per effort, oldest first (efforts come newest first).
 * Approximate efforts are left out when there are timed ones to chart.
 */
export const segmentEffortSeries = (efforts: SegmentEffort[]): { date: string; value: number }[] => {
  const exact = efforts.filter((e) => !e.approximate)
  const charted = exact.length > 0 ? exact : efforts
  return charted
    .map((e) => ({ date: e.activity_start_time, value: Math.round((e.elapsed_s / 60) * 100) / 100 }))
    .reverse()
}

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`

export const formatEffortCount = (n: number): string => plural(n, 'effort', 'efforts')

export const formatMatchResult = (result: SegmentMatchResult): string =>
  `Timed ${formatEffortCount(result.efforts)} on ${plural(result.activities, 'activity', 'activities')}`

export const formatPassedOn = (activityCount: number): string =>
  `passed on ${plural(activityCount, 'activity', 'activities')}`

/** The km range sent with "Add as segment": nothing when it is the whole line. */
export const promoteTrim = (
  lengthM: number,
  startKm: number,
  endKm: number,
): { start_km: number; end_km: number } | Record<string, never> =>
  startKm > 0 || endKm * 1000 < lengthM ? { end_km: endKm, start_km: startKm } : {}

/** A suggestion's whole length in km as the "To km" field shows it: rounded up to 0.1. */
export const lengthKm = (lengthM: number): number => Math.ceil(lengthM / 100) / 10

export const MAX_SCAN_ROUNDS = 10

/** Whether to run another scan: more is left, the last run got through something, and the rounds are not used up. */
export const shouldScanAgain = (result: SuggestedSegmentScanResult, rounds: number): boolean =>
  rounds < MAX_SCAN_ROUNDS && result.remaining > 0 && result.scanned > 0

export const formatScanTotals = ({
  scanned,
  suggested,
  more = false,
}: {
  scanned: number
  suggested: number
  more?: boolean
}): string => {
  const found =
    scanned === 0
      ? 'Nothing new to look through.'
      : `Looked through ${plural(scanned, 'activity', 'activities')} and found ${plural(suggested, 'new suggestion', 'new suggestions')}.`
  return more ? `${found} There is more to look through: press again to go on.` : found
}
