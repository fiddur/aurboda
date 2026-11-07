interface TrendPoint {
  date: string
  value: number
}

/**
 * Drops the points before a trend's first non-zero value. Trends that count a day without samples
 * as 0 (sums, activity types) report 0 for every day before the first sample too, which reads as
 * a real zero; those days hold no data, so they become a gap. Zeros after the first sample are
 * kept, and an all-zero series is left as it is.
 */
export const trimLeadingZeros = <P extends TrendPoint>(points: P[]): P[] => {
  const first = points.findIndex((p) => p.value !== 0)
  return first <= 0 ? points : points.slice(first)
}

const historyDomain = (histories: TrendPoint[][]): [Date, Date] | undefined => {
  const dates = histories.flat().map((p) => p.date)
  if (dates.length === 0) return undefined
  const sorted = [...dates].sort()
  return [new Date(sorted[0]), new Date(sorted[sorted.length - 1])]
}

/** One trend history ready to plot: leading zeros trimmed, the x-axis still spanning the whole history. */
export const trendPlot = <P extends TrendPoint>(history: P[]): { data: P[]; xDomain?: [Date, Date] } => ({
  data: trimLeadingZeros(history),
  xDomain: historyDomain([history]),
})

/** Breakdown series ready to plot: each trimmed, the x-axis spanning every series' history. */
export const trendPlotSeries = <S extends { data: TrendPoint[] }>(
  series: S[],
): { series: S[]; xDomain?: [Date, Date] } => ({
  series: series.map((s) => ({ ...s, data: trimLeadingZeros(s.data) })),
  xDomain: historyDomain(series.map((s) => s.data)),
})
