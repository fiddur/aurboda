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
  if (!Number.isFinite(pixelsPerHour) || pixelsPerHour <= 0) return 0
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
  const ms = visibleEnd.getTime() - visibleStart.getTime()
  if (timeAxisPixels <= 0 || ms <= 0) return 0
  const hours = ms / 3_600_000
  return timeAxisPixels / hours
}
