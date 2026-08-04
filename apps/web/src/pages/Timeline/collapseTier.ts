/**
 * Map pixels-per-hour-of-visible-time to a hierarchy collapse depth tier.
 *
 *   > 30 pph: depth 0 — sub-types stay individually clickable (typical
 *             single-day view: 24h in 1000+px, exercise sub-types stay split).
 *   5 – 30:   depth 1 — collapse one parent_type hop (3-day to ~14-day view).
 *   ≤ 5:      depth Infinity — walk to root (broad multi-week view).
 *
 * Pixel-based gating (#658) supersedes the prior span-based gate (#650) so a
 * 7-day view on a 360px mobile gets the same density treatment as a 14-day
 * view on a 1080px desktop, instead of being driven by absolute days.
 *
 * Pure: thresholds tuned at 1000px container width to match the previous
 * day-based tiers (1d ≈ 42 pph, 3d ≈ 14 pph, 14d ≈ 3 pph).
 */
export const collapseDepthForPixelsPerHour = (pixelsPerHour: number): number => {
  // NaN / non-positive values mean "no zoom info yet" — keep everything
  // distinct (depth 0) until a real measurement arrives. Positive Infinity
  // is allowed through to fall into the > 30 branch (max zoom = depth 0
  // via the correct semantic path, not the early-return guard).
  if (Number.isNaN(pixelsPerHour) || pixelsPerHour <= 0) return 0
  if (pixelsPerHour > 30) return 0
  if (pixelsPerHour >= 5) return 1
  return Number.POSITIVE_INFINITY
}

/**
 * Compute pixels-per-hour given the chart's pixel dimension along the time
 * axis and the visible time range. Returns 0 when inputs aren't usable yet
 * (pre-mount, pre-measure) — the caller should treat that as "no zoom info,
 * default to depth 0".
 */
export const computePixelsPerHour = (
  timeAxisPixels: number,
  visibleStart: Date,
  visibleEnd: Date,
): number => {
  if (!Number.isFinite(timeAxisPixels) || timeAxisPixels <= 0) return 0
  const ms = visibleEnd.getTime() - visibleStart.getTime()
  if (!Number.isFinite(ms) || ms <= 0) return 0
  const hours = ms / 3_600_000
  return timeAxisPixels / hours
}

/**
 * On-screen gap (px) below which two adjacent same-type bars are bridged into
 * one. Tuned so that a 24h view in a 1000px container reproduces the previous
 * fixed 10-minute gap.
 */
const MERGE_GAP_PX = 7

/** Widest gap bridged in the pixel tier (views crossing <= 2 calendar-day boundaries). */
const FINE_MERGE_GAP_CAP_MS = 10 * 60 * 1000

/**
 * Gap below which adjacent same-type activities merge into a single bar.
 *
 * Zoomed out, fixed tiers bridge large gaps so a long string of small same-type
 * activities reads as one bar. At views crossing <= 2 calendar-day boundaries
 * (so anything up to just under 72 elapsed hours) the gap instead tracks
 * pixels-per-hour: only gaps too small to see on screen are bridged, so zooming
 * in pulls separate sessions apart — two yoga sessions nine minutes apart used
 * to stay welded together at every zoom level, because
 * `differenceInCalendarDays` is 0 for any view inside one day.
 *
 * Not unconditional: the merge test is `gap <= this`, and this is always > 0 for
 * a finite `pixelsPerHour`, so two sessions that abut exactly never split at any
 * zoom. Tightening to `<` is not the answer — a zero gap is exactly what makes
 * contiguous screentime sampling spans read as one bar.
 *
 * Capped at the previous fixed floor. The cap binds below ~42 pixels-per-hour —
 * a narrow container, or a range stretched toward the 2-boundary limit — where
 * 7px would otherwise work out to far more than 10 minutes: a 3-day-elapsed view
 * that still counts as 2 boundaries on a 360px phone is ~5 pph, i.e. ~84
 * minutes. Above that the pixel gap is already under 10 minutes and the cap never
 * applies.
 */
export const mergeGapForZoom = (days: number, pixelsPerHour: number): number => {
  if (days > 50) return 4 * 60 * 60 * 1000
  if (days > 2) return 60 * 60 * 1000
  if (Number.isNaN(pixelsPerHour) || pixelsPerHour <= 0) return FINE_MERGE_GAP_CAP_MS

  const gap = Math.min(FINE_MERGE_GAP_CAP_MS, (MERGE_GAP_PX / pixelsPerHour) * 3_600_000)
  // Quantized to whole seconds: this feeds the `collapseToParentType` memos in
  // `useTimelineData`, so an unrounded float would re-run the whole collapse and
  // hand downstream a fresh array on every 1px `ResizeObserver` tick during a
  // window drag. #658 quantized `collapseDepthForPixelsPerHour` for the same
  // reason. Activity gaps are never sub-second-precise, so no merge decision
  // changes.
  return Math.round(gap / 1000) * 1000
}
