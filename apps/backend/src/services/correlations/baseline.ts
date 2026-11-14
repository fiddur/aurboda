import type { BaselineResult } from './types.ts'

import { getTimeSeriesStats } from '../../db/index.ts'
import {
  countFlaggedSamples,
  flaggedExclusion,
  loadFlaggedWindows,
  withoutFlagged,
} from '../flagged-windows.ts'
import { queryMetrics } from '../queries/index.ts'

const BASELINE_METRICS = ['hrv_rmssd', 'resting_heart_rate', 'stress_level']

/** With `excludeFlagged`, the samples inside activities flagged exclude_from_baseline are left out. */
// eslint-disable-next-line complexity -- TODO: refactor
export async function getBaseline(
  user: string,
  referenceDate?: Date,
  options: { excludeFlagged?: boolean } = {},
): Promise<BaselineResult> {
  const now = referenceDate ?? new Date()

  const end7day = new Date(now)
  end7day.setHours(23, 59, 59, 999)
  const start7day = new Date(now)
  start7day.setDate(start7day.getDate() - 7)
  start7day.setHours(0, 0, 0, 0)

  const end30day = new Date(now)
  end30day.setHours(23, 59, 59, 999)
  const start30day = new Date(now)
  start30day.setDate(start30day.getDate() - 30)
  start30day.setHours(0, 0, 0, 0)

  // Previous 30-day period for trend calculation
  const prevStart30day = new Date(start30day)
  prevStart30day.setDate(prevStart30day.getDate() - 30)
  const prevEnd30day = new Date(start30day)
  prevEnd30day.setMilliseconds(-1)

  const flagged = await loadFlaggedWindows(user, prevStart30day, end30day, options.excludeFlagged)
  const statsOf = (metrics: string[], start: Date, end: Date) =>
    getTimeSeriesStats(user, metrics, start, end, flagged)

  // Prefer the contextual sleep HRV signal; fall back to raw hrv_rmssd when no
  // samples overlap the user's tracked sleep windows so the widget mirrors what
  // /api/metrics/latest/hrv_rmssd surfaces (see #747).
  //
  // hrv_sleep is fetched once over the union of the three windows. A sample is
  // sleep iff it lies in a sleep session, and widening the range only adds
  // sessions, so each window's subset is what a per-window fetch would return.
  const sleepHrvPromise = queryMetrics(user, 'hrv_sleep', prevStart30day, end30day).then(
    (result) =>
      withoutFlagged(
        result.data.map((d) => ({ time: new Date(d.time).getTime(), value: d.value })),
        (d) => d.time,
        flagged,
      ).kept,
  )

  const getHrvAvg = async (start: Date, end: Date): Promise<number | null> => {
    const sleep = (await sleepHrvPromise).filter((d) => d.time >= start.getTime() && d.time <= end.getTime())
    if (sleep.length > 0) {
      const sum = sleep.reduce((acc, d) => acc + d.value, 0)
      return sum / sleep.length
    }
    const rawStats = await statsOf(['hrv_rmssd'], start, end)
    const raw = rawStats[0]
    return raw && raw.count > 0 && raw.avg ? raw.avg : null
  }

  const [
    hrvAvg7day,
    hrvAvg30day,
    hrvAvgPrev30day,
    hrStats7day,
    hrStats30day,
    hrStatsPrev30day,
    stressStats7day,
    stressStats30day,
    stressStatsPrev30day,
    excludedPoints,
  ] = await Promise.all([
    getHrvAvg(start7day, end7day),
    getHrvAvg(start30day, end30day),
    getHrvAvg(prevStart30day, prevEnd30day),
    statsOf(['resting_heart_rate'], start7day, end7day),
    statsOf(['resting_heart_rate'], start30day, end30day),
    statsOf(['resting_heart_rate'], prevStart30day, prevEnd30day),
    statsOf(['stress_level'], start7day, end7day),
    statsOf(['stress_level'], start30day, end30day),
    statsOf(['stress_level'], prevStart30day, prevEnd30day),
    countFlaggedSamples(user, BASELINE_METRICS, flagged, prevStart30day, end30day),
  ])

  const hrvTrend =
    hrvAvg30day !== null && hrvAvgPrev30day !== null
      ? ((hrvAvg30day - hrvAvgPrev30day) / hrvAvgPrev30day) * 100
      : null

  const hrTrend =
    hrStats30day[0]?.avg && hrStatsPrev30day[0]?.avg
      ? ((hrStats30day[0].avg - hrStatsPrev30day[0].avg) / hrStatsPrev30day[0].avg) * 100
      : null

  const stressTrend =
    stressStats30day[0]?.avg && stressStatsPrev30day[0]?.avg
      ? ((stressStats30day[0].avg - stressStatsPrev30day[0].avg) / stressStatsPrev30day[0].avg) * 100
      : null

  return {
    ...flaggedExclusion(flagged, { excluded_points: excludedPoints }),
    hrv: {
      avg7day: hrvAvg7day !== null ? Math.round(hrvAvg7day * 10) / 10 : null,
      avg30day: hrvAvg30day !== null ? Math.round(hrvAvg30day * 10) / 10 : null,
      trend_percent: hrvTrend !== null ? Math.round(hrvTrend * 10) / 10 : null,
    },
    period: {
      end: end30day.toISOString(),
      start: start30day.toISOString(),
    },
    resting_hr: {
      avg7day: hrStats7day[0]?.avg ? Math.round(hrStats7day[0].avg * 10) / 10 : null,
      avg30day: hrStats30day[0]?.avg ? Math.round(hrStats30day[0].avg * 10) / 10 : null,
      trend_percent: hrTrend !== null ? Math.round(hrTrend * 10) / 10 : null,
    },
    stress: {
      avg7day: stressStats7day[0]?.avg ? Math.round(stressStats7day[0].avg * 10) / 10 : null,
      avg30day: stressStats30day[0]?.avg ? Math.round(stressStats30day[0].avg * 10) / 10 : null,
      trend_percent: stressTrend !== null ? Math.round(stressTrend * 10) / 10 : null,
    },
  }
}
