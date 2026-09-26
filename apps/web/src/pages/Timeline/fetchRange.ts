import {
  addDays,
  differenceInCalendarDays,
  endOfDay,
  formatISO,
  parseISO,
  startOfDay,
  subDays,
} from 'date-fns'

export interface FetchRange {
  from: string
  to: string
}

const MARGIN_DAYS = 3
const DAY_MS = 86_400_000

const toIsoDate = (date: Date): string => formatISO(date, { representation: 'date' })

/**
 * The fetch range follows the view rather than accumulating: once the view leaves the
 * fetched range, or the range is far wider than the view (after zooming in), it is
 * re-centred on the view plus a margin. Returns `current` itself when nothing changes.
 */
export const nextFetchRange = (
  view: { start: Date; end: Date },
  current: FetchRange,
  today: Date,
): FetchRange => {
  const currentFrom = parseISO(current.from)
  const currentTo = parseISO(current.to)
  const viewSpanDays = (view.end.getTime() - view.start.getTime()) / DAY_MS
  const currentSpanDays = differenceInCalendarDays(currentTo, currentFrom) + 1
  const contained = view.start >= startOfDay(currentFrom) && view.end <= endOfDay(currentTo)
  if (contained && currentSpanDays <= 3 * viewSpanDays + 7) return current

  const todayStr = toIsoDate(today)
  const desiredTo = toIsoDate(addDays(view.end, MARGIN_DAYS))
  const desired = {
    from: toIsoDate(subDays(view.start, MARGIN_DAYS)),
    to: desiredTo > todayStr ? todayStr : desiredTo,
  }
  return desired.from === current.from && desired.to === current.to ? current : desired
}
