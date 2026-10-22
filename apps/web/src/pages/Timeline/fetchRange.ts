import {
  addDays,
  addHours,
  differenceInCalendarDays,
  endOfDay,
  formatISO,
  parseISO,
  startOfDay,
  subDays,
  subHours,
} from 'date-fns'

export interface FetchRange {
  from: string
  to: string
}

const MARGIN_DAYS = 3
const EDGE_PAD_HOURS = 12
const DAY_MS = 86_400_000

const toIsoDate = (date: Date): string => formatISO(date, { representation: 'date' })

/** The fetched window as instants: local midnight of `from` to the end of local day `to`.
 * `parseISO` reads a date-only string as local time; `new Date('yyyy-mm-dd')` would read
 * UTC midnight and shift the window a day early west of UTC. */
export const fetchWindowFromRange = (range: FetchRange): { start: Date; end: Date } => ({
  end: endOfDay(parseISO(range.to)),
  start: startOfDay(parseISO(range.from)),
})

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

/** The fetch window widened by half a day on each side, so items and buckets straddling an
 * edge are fetched. Hours, not `subDays(x, 0.5)`: date-fns truncates fractional days. */
export const padFetchWindow = (start: Date, end: Date): [Date, Date] => [
  subHours(start, EDGE_PAD_HOURS),
  addHours(end, EDGE_PAD_HOURS),
]
