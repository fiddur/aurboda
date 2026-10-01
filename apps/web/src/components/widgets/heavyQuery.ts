/** For analytic queries that are expensive server-side: don't refire on every tab
 * focus, and don't retry a failing heavy query. */
export const HEAVY_QUERY_OPTIONS = { refetchOnWindowFocus: false, retry: 0 } as const
