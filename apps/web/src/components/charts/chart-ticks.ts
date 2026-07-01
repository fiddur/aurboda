/**
 * Choose the x-axis tick interval (in days) for a time-scale chart.
 *
 * For short spans we place ticks on day boundaries so labels stay distinct
 * (a 3-day challenge shows each day instead of repeating one), but never emit
 * more than ~6 ticks — the same label budget as the previous fixed `.ticks(6)`,
 * so shared/compact call sites (dashboard widgets, mini charts) don't get more
 * crowded than before.
 *
 * Returns the day step for spans of 1–31 days, or null to fall back to d3's
 * default ~6 auto-ticks for longer (or non-positive) spans.
 */
export function daySpanTickStep(spanDays: number): number | null {
  if (spanDays <= 0 || spanDays > 31) return null
  return Math.max(1, Math.ceil(spanDays / 6))
}
