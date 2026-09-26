/** Sample count per (rounded) value. */
export type Histogram = Map<number, number>

export interface ValueDistributionRow {
  min: number
  q1: number
  median: number
  q3: number
  max: number
  avg: number
  sample_count: number
}

export const mergeHistograms = (histograms: Histogram[]): Histogram => {
  const merged: Histogram = new Map()
  for (const h of histograms) for (const [v, n] of h) merged.set(v, (merged.get(v) ?? 0) + n)
  return merged
}

/**
 * Five-number summary and mean of the samples a histogram counts. Quartiles interpolate linearly
 * between order statistics, like `percentile_cont` and the web's `fiveNumberSummary`.
 */
export const summarizeHistogram = (h: Histogram): ValueDistributionRow | undefined => {
  const entries = [...h.entries()].filter(([, n]) => n > 0).toSorted(([a], [b]) => a - b)
  const count = entries.reduce((sum, [, n]) => sum + n, 0)
  if (count === 0) return undefined

  const valueAtRank = (rank: number): number => {
    let seen = 0
    for (const [v, n] of entries) {
      seen += n
      if (rank < seen) return v
    }
    return entries.at(-1)![0]
  }
  const quantile = (p: number): number => {
    const rank = p * (count - 1)
    const lo = valueAtRank(Math.floor(rank))
    const hi = valueAtRank(Math.ceil(rank))
    return lo + (hi - lo) * (rank - Math.floor(rank))
  }

  return {
    avg: entries.reduce((sum, [v, n]) => sum + v * n, 0) / count,
    max: entries.at(-1)![0],
    median: quantile(0.5),
    min: entries[0]![0],
    q1: quantile(0.25),
    q3: quantile(0.75),
    sample_count: count,
  }
}
