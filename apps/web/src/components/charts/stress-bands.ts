/** Garmin's stress bands: rest 0–25, low 26–50, medium 51–75, high 76–100. */
export const STRESS_BAND_COLORS = {
  high: '#c2410c',
  low: '#fdba74',
  medium: '#f97316',
  rest: '#3b82f6',
} as const

export type StressBand = keyof typeof STRESS_BAND_COLORS

export const stressBand = (value: number): StressBand =>
  value <= 25 ? 'rest' : value <= 50 ? 'low' : value <= 75 ? 'medium' : 'high'

export const stressBandColor = (value: number): string => STRESS_BAND_COLORS[stressBand(value)]

export interface BarChartStyle {
  kind: 'bars'
  domain: [number, number]
  color: (value: number) => string
}

/** Metrics drawn as value-coloured bars instead of a line. */
export const METRIC_CHART_STYLES: Partial<Record<string, BarChartStyle>> = {
  stress_level: { color: stressBandColor, domain: [0, 100], kind: 'bars' },
}

/** Bar width: 80% of the median gap between neighbouring points, at least 1px. */
export const barWidth = (xs: number[]): number => {
  const gaps = xs
    .slice(1)
    .map((x, i) => x - (xs[i] ?? x))
    .filter((g) => g > 0)
    .toSorted((a, b) => a - b)
  if (gaps.length === 0) return 1
  const mid = Math.floor(gaps.length / 2)
  const median = gaps.length % 2 === 0 ? ((gaps[mid - 1] ?? 0) + (gaps[mid] ?? 0)) / 2 : (gaps[mid] ?? 0)
  return Math.max(1, median * 0.8)
}
