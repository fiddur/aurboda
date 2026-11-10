const PARAM = 'period'

/** `href` with `?period=` set to `period`, or without it for the latest finished period (null). */
export const withPeriodParam = (href: string, period: string | null): string => {
  const url = new URL(href)
  if (period === null) url.searchParams.delete(PARAM)
  else url.searchParams.set(PARAM, period)
  return `${url.pathname}${url.search}${url.hash}`
}

export const periodParamOf = (search: string): string | null => new URLSearchParams(search).get(PARAM)

/**
 * The shown period lives in the URL so a chosen period survives a reload and can be linked; the latest
 * one has no parameter. replaceState rather than a route change: the router would remount the board.
 */
export const readPeriodParam = (): string | null => {
  try {
    return periodParamOf(window.location.search)
  } catch {
    return null
  }
}

export const writePeriodParam = (period: string | null): void => {
  try {
    const next = withPeriodParam(window.location.href, period)
    window.history.replaceState(window.history.state, '', next)
  } catch {
    // Without history access the period still switches; it just is not in the URL.
  }
}

/**
 * Whether the board switched from one period granularity to another, which drops the selected period.
 * Coming from null is the config arriving (the home board starts from a default without a period), not
 * a switch, so a period named in the URL survives it.
 */
export const isGranularitySwitch = (previous: string | null, next: string | null): boolean =>
  previous !== null && previous !== next
