import { type RouteEffort, type RoutesQuery, type RouteSort, routeSortOrders } from '@aurboda/api-spec'

/** Elapsed seconds as `"H:MM:SS"`, or `"M:SS"` under an hour. */
export const formatElapsed = (seconds: number): string => {
  const total = Math.round(seconds)
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const ss = s.toString().padStart(2, '0')
  return h > 0 ? `${h}:${m.toString().padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/**
 * One chart point per run that has the value, oldest first (efforts come newest
 * first). Pace is charted in minutes per km.
 */
export const effortSeries = (
  efforts: RouteEffort[],
  field: 'avg_hr' | 'pace_s_per_km',
): { date: string; value: number }[] =>
  efforts
    .flatMap((e) => {
      const value = e[field]
      if (value === undefined) return []
      return [
        {
          date: e.start_time,
          value: field === 'pace_s_per_km' ? Math.round((value / 60) * 100) / 100 : value,
        },
      ]
    })
    .reverse()

/** The type's display name, or the raw name while definitions are loading or for an unknown type. */
export const typeDisplayName = (
  name: string,
  definitions: { name: string; display_name: string }[],
): string => definitions.find((d) => d.name === name)?.display_name ?? name

const isRouteSort = (value: string | undefined): value is RouteSort =>
  routeSortOrders.some((order) => order === value)

/** The route list's filter and order from the page URL's `type` and `sort`; unknown sorts are ignored. */
export const routesQueryFromParams = (params: Record<string, string>): Partial<RoutesQuery> => ({
  ...(params.type ? { activity_type: params.type } : {}),
  ...(isRouteSort(params.sort) && params.sort !== 'last_run' ? { sort: params.sort } : {}),
})

/** The page URL's query string for a filter and order, `''` for the defaults. */
export const searchFromRoutesQuery = (query: Partial<RoutesQuery>): string => {
  const params = new URLSearchParams()
  if (query.activity_type) params.set('type', query.activity_type)
  if (query.sort && query.sort !== 'last_run') params.set('sort', query.sort)
  const search = params.toString()
  return search ? `?${search}` : ''
}
