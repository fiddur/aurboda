export interface BarLinePoint {
  date: Date
  value: number
}

export interface BarChartLine {
  data: { date: string; value: number }[]
  color?: string
}

export const parseLinePoints = (data: { date: string; value: number }[]): BarLinePoint[] =>
  data.map((d) => ({ date: new Date(d.date), value: d.value }))

/** The largest value among the bars and the overlay lines, falling back to 1 when all are empty. */
export const barChartYMax = (barValues: number[], ...lines: BarLinePoint[][]): number => {
  const values = [...barValues, ...lines.flat().map((p) => p.value)]
  return values.length > 0 ? Math.max(...values) : 1
}

/**
 * The overlay line's points inside the x domain; undefined when nothing is left to draw. Without a
 * `color` the stroke comes from the `.bar-chart-line` rule, one shade per color scheme.
 */
export const overlayLine = (
  line: BarChartLine | undefined,
  [from, to]: [Date, Date],
): { color?: string; points: BarLinePoint[] } | undefined => {
  if (!line) return undefined
  const points = parseLinePoints(line.data).filter((p) => p.date >= from && p.date <= to)
  return points.length > 0 ? { points, ...(line.color && { color: line.color }) } : undefined
}

/**
 * Each overlay line's points inside the x domain, dropping lines with nothing to draw. The first
 * line without a color keeps the `.bar-chart-line` stroke; a later one takes `palette[index]`, so
 * the palette's first entry can stay the bars' own color.
 */
export const overlayLines = (
  lines: BarChartLine[],
  domain: [Date, Date],
  palette: readonly string[],
): { color?: string; points: BarLinePoint[] }[] =>
  lines.flatMap((line, i) => {
    const color = line.color ?? (i === 0 ? undefined : palette[i % palette.length])
    const overlay = overlayLine(color ? { ...line, color } : line, domain)
    return overlay ? [overlay] : []
  })

/**
 * A bar's horizontal span cut to the plot area `[0, plotWidth]`, or null when nothing of it is
 * inside. A bucket can start before an explicit range start (a week bucket begins on Monday while
 * the range starts at the first session), and an unclipped bar would be drawn over the y axis.
 */
export const clipBarSpan = (
  left: number,
  width: number,
  plotWidth: number,
): { x: number; width: number } | null => {
  const from = Math.max(left, 0)
  const to = Math.min(left + width, plotWidth)
  return to > from ? { width: to - from, x: from } : null
}

export interface StackSegment {
  name: string
  value: number
  base: number
  top: number
}

export interface StackedBucket {
  bucket_start: string
  segments: StackSegment[]
  total: number
}

/**
 * Series stacked per bucket, bottom-up in series order, leaving out values of 0 or less; buckets in
 * time order. `max_total` is the largest bucket total, 1 when nothing is drawn, as the y domain.
 */
export const stackBuckets = (
  series: { name: string; data: { bucket_start: string; value: number }[] }[],
): { buckets: StackedBucket[]; max_total: number } => {
  const starts = [...new Set(series.flatMap((s) => s.data.map((d) => d.bucket_start)))].sort()
  const values = series.map((s) => ({
    byBucket: new Map(s.data.map((d) => [d.bucket_start, d.value])),
    name: s.name,
  }))
  const buckets = starts.map((bucket_start) => {
    let total = 0
    const segments: StackSegment[] = []
    for (const { byBucket, name } of values) {
      const value = byBucket.get(bucket_start) ?? 0
      if (value <= 0) continue
      segments.push({ base: total, name, top: total + value, value })
      total += value
    }
    return { bucket_start, segments, total }
  })
  const max_total = Math.max(0, ...buckets.map((b) => b.total))
  return { buckets, max_total: max_total > 0 ? max_total : 1 }
}
