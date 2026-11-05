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

/** The largest value among the bars and the overlay line, falling back to 1 when both are empty. */
export const barChartYMax = (barValues: number[], line: BarLinePoint[] = []): number => {
  const values = [...barValues, ...line.map((p) => p.value)]
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
