import {
  addDays,
  addMonths,
  addWeeks,
  endOfDay,
  endOfMonth,
  endOfWeek,
  startOfDay,
  startOfMonth,
  startOfWeek,
} from 'date-fns'

export type RangePreset = 'day' | 'week' | 'month'

export const RANGE_PRESETS: readonly RangePreset[] = ['day', 'week', 'month']

export interface ViewRange {
  start: Date
  end: Date
}

const TOLERANCE_MS = 5 * 60_000
const DAY_MS = 86_400_000

const midpointOf = (start: Date, end: Date): Date => new Date((start.getTime() + end.getTime()) / 2)

/** The local day, Monday-to-Sunday week, or calendar month that contains `at`. */
export const presetRange = (preset: RangePreset, at: Date): ViewRange => {
  if (preset === 'day') return { end: endOfDay(at), start: startOfDay(at) }
  if (preset === 'week') {
    return { end: endOfWeek(at, { weekStartsOn: 1 }), start: startOfWeek(at, { weekStartsOn: 1 }) }
  }
  return { end: endOfMonth(at), start: startOfMonth(at) }
}

/** Which preset the view is, within a few minutes of its boundaries; null for a free zoom. */
export const rangePresetOf = (start: Date, end: Date): RangePreset | null => {
  const mid = midpointOf(start, end)
  return (
    RANGE_PRESETS.find((preset) => {
      const range = presetRange(preset, mid)
      return (
        Math.abs(range.start.getTime() - start.getTime()) <= TOLERANCE_MS &&
        Math.abs(range.end.getTime() - end.getTime()) <= TOLERANCE_MS
      )
    }) ?? null
  )
}

const shiftBy: Record<RangePreset, (date: Date, amount: number) => Date> = {
  day: addDays,
  month: addMonths,
  week: addWeeks,
}

/** The neighbouring period of the active preset, or the view moved by one day for a free zoom. */
export const stepRange = (view: ViewRange, direction: 1 | -1): ViewRange => {
  const preset = rangePresetOf(view.start, view.end)
  if (!preset) return { end: addDays(view.end, direction), start: addDays(view.start, direction) }
  return presetRange(
    preset,
    shiftBy[preset](presetRange(preset, midpointOf(view.start, view.end)).start, direction),
  )
}

/** Whether the range starts no later than `now`: the timeline does not step into the future. */
export const isReachable = (range: ViewRange, now: Date): boolean => range.start.getTime() <= now.getTime()

/** Whether the view covers more than three days: the span at which the daily metric tracks show. */
export const isMultiDaySpan = (start: Date, end: Date): boolean =>
  end.getTime() - start.getTime() > 3 * DAY_MS
