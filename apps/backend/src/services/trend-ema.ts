import type { TrendDisplayPeriod, TrendHistoryPoint } from '@aurboda/api-spec'

/**
 * Natural log of 2, used for EMA decay calculation.
 * exp(-LN2 * days / halfLife) gives weight that drops to 50% after halfLife days.
 */
export const LN2 = 0.693147

/**
 * The summed EMA weight of a display period's days. A zero-filled series divides by at least this, so until it is
 * one period old the days before its first sample are counted as zeros: a lone first session then reads as itself per
 * period, not as that day's amount scaled up to a period. Beyond the first period the floor has no effect.
 */
export const firstPeriodWeight = (halfLifeDays: number, periodDays: number): number =>
  Array.from({ length: Math.max(1, periodDays) }, (_, k) => Math.exp((-LN2 * k) / halfLifeDays)).reduce(
    (a, b) => a + b,
    0,
  )

/**
 * Days of warm-up before the lookback: three half-lives, and at least a display period less a day so the oldest
 * displayed point of a series older than the window weighs a full period and `firstPeriodWeight` only ever bites at a
 * series' real start.
 */
export const warmupLength = (halfLifeDays: number, periodDays: number): number =>
  Math.max(3 * halfLifeDays, periodDays - 1)

const DAY_MS = 86_400_000

/**
 * The zero-filled EMA over `days`, by the same formula as the SQL trends: for each day,
 * multiplier * sum(value_i * weight_i) / max(sum(weight_i), firstPeriodWeight), with
 * weight_i = exp(-LN2 * daysAgo / halfLife) over at most the 90 days ending that day. Days before `firstDay` are
 * not part of the series: they have no weight and no point. Only points from `displayStartIdx` on are returned.
 */
export const computeEma = (
  dailyValues: Map<string, number>,
  days: string[],
  halfLifeDays: number,
  multiplier: number,
  { displayStartIdx = 0, firstDay = days[0] }: { displayStartIdx?: number; firstDay?: string } = {},
): TrendHistoryPoint[] => {
  const firstIdx = days.findIndex((day) => day >= firstDay)
  if (firstIdx === -1) return []
  const floor = firstPeriodWeight(halfLifeDays, multiplier)
  const history: TrendHistoryPoint[] = []

  for (let i = firstIdx; i < days.length; i++) {
    let weightedSum = 0
    let weightSum = 0
    const currentDay = Date.parse(days[i])

    for (let j = i; j >= firstIdx && i - j < 90; j--) {
      const daysAgo = (currentDay - Date.parse(days[j])) / DAY_MS
      const weight = Math.exp((-LN2 * daysAgo) / halfLifeDays)
      weightedSum += (dailyValues.get(days[j]) ?? 0) * weight
      weightSum += weight
    }

    if (i >= displayStartIdx) {
      history.push({ date: days[i], value: (multiplier * weightedSum) / Math.max(weightSum, floor) })
    }
  }

  return history
}

export const displayUnits: Record<TrendDisplayPeriod, string> = {
  daily: 'per day',
  monthly: 'per month',
  weekly: 'per week',
}
