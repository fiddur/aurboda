import type { FlaggedExclusion } from '@aurboda/api-spec'

import { countTimeSeriesInWindows, type FlaggedWindow, getFlaggedWindows } from '../db/index.ts'
import { dayKey } from './day-keys.ts'

export type { FlaggedWindow }

const DAY_MS = 86_400_000

/**
 * The windows an analysis of `[start, end)` leaves out: activities flagged exclude_from_baseline,
 * or none when the caller asks to keep them. The one read every analysis shares.
 */
export const loadFlaggedWindows = async (
  user: string,
  start: Date,
  end: Date,
  excludeFlagged: boolean | undefined,
): Promise<FlaggedWindow[]> => (excludeFlagged ? getFlaggedWindows(user, start, end) : [])

/** The windows cut to `[start, end]`, so a count over them stays inside the analysed range. */
export const clipWindows = (windows: FlaggedWindow[], start: Date, end: Date): FlaggedWindow[] =>
  windows.map((w) => ({
    ...w,
    end: w.end > end ? end : w.end,
    start: w.start < start ? start : w.start,
  }))

/** Stored samples of `metrics` in the flagged windows within `[start, end]`; no read without windows. */
export const countFlaggedSamples = async (
  user: string,
  metrics: string[],
  windows: FlaggedWindow[],
  start: Date,
  end: Date,
): Promise<number> =>
  windows.length === 0 ? 0 : countTimeSeriesInWindows(user, metrics, clipWindows(windows, start, end))

export const inFlaggedWindow = (windows: FlaggedWindow[], ms: number): boolean =>
  windows.some((w) => ms >= w.start.getTime() && ms < w.end.getTime())

/** The items whose time is in no flagged window, and how many were left out. */
export const withoutFlagged = <T>(
  items: T[],
  timeOf: (item: T) => number,
  windows: FlaggedWindow[],
): { excluded: number; kept: T[] } => {
  if (windows.length === 0) return { excluded: 0, kept: items }
  const kept = items.filter((item) => !inFlaggedWindow(windows, timeOf(item)))
  return { excluded: items.length - kept.length, kept }
}

interface BinnedSeries {
  times: number[]
  values: number[]
}

const binsWithoutFlagged = (series: BinnedSeries, windows: FlaggedWindow[]): BinnedSeries => {
  const keep = series.times.map((t) => !inFlaggedWindow(windows, t))
  return { times: series.times.filter((_, i) => keep[i]), values: series.values.filter((_, i) => keep[i]) }
}

/** Binned series by name without the bins starting in a flagged window, and how many were left out. */
export const seriesWithoutFlagged = <T extends Record<string, BinnedSeries>>(
  series: T,
  windows: FlaggedWindow[],
): { excluded: number; kept: T } => {
  if (windows.length === 0) return { excluded: 0, kept: series }
  const entries = Object.entries(series).map(([name, s]) => [name, binsWithoutFlagged(s, windows)] as const)
  const before = Object.values(series).reduce((n, s) => n + s.times.length, 0)
  const after = entries.reduce((n, [, s]) => n + s.times.length, 0)
  return { excluded: before - after, kept: Object.fromEntries(entries) as T }
}

/** The day keys (in `tz`, UTC by default) of every day a flagged window overlaps. */
export const flaggedDays = (windows: FlaggedWindow[], tz = 'UTC'): Set<string> => {
  const days = new Set<string>()
  for (const w of windows) {
    const last = w.end.getTime() - 1
    for (let ms = w.start.getTime(); ms <= last; ms += DAY_MS) days.add(dayKey(new Date(ms), tz))
    days.add(dayKey(new Date(last), tz))
  }
  return days
}

/** The response's account of what was left out; none when no flagged window overlaps. */
export const flaggedExclusion = (
  windows: FlaggedWindow[],
  counts: Pick<FlaggedExclusion, 'excluded_days' | 'excluded_points'>,
): { flagged_exclusion?: FlaggedExclusion } =>
  windows.length === 0
    ? {}
    : {
        flagged_exclusion: {
          ...counts,
          windows: windows.map((w) => ({
            activity_id: w.activity_id,
            activity_type: w.activity_type,
            end_time: w.end.toISOString(),
            start_time: w.start.toISOString(),
          })),
        },
      }
