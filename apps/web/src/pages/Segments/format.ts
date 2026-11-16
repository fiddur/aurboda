import {
  type SegmentEffort,
  type SegmentMatchResult,
  type SegmentsQuery,
  type SegmentSort,
  segmentSortOrders,
} from '@aurboda/api-spec'

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
