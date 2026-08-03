/**
 * GPS precedence: an activity's own GPS track beats passive phone tracking.
 *
 * A watch or bike computer fixes position far more accurately than a phone in a
 * pocket, and keeping both interleaves two tracks into one zig-zagging path. So
 * when an activity brings its own GPS, locations from passive sources are
 * soft-deleted for the activity's whole span — not just the range the track
 * happens to cover, since the track's first and last fixes usually sit inside
 * the activity.
 */

/**
 * Sources that record a GPS track for an activity, as opposed to tracking
 * position continuously in the background.
 *
 * These never supersede each other. Their tracks describe the same route within
 * GPS error, so overlaying two of them is cosmetic, while letting them delete
 * each other is not: Strava downsamples to 60 s where Garmin keeps every sample,
 * and neither integration revisits an activity once synced — so "most recent
 * sync wins" would permanently demote a full-resolution track to a coarse one.
 */
export const activityTrackSources = ['garmin', 'strava']

/**
 * How far a track may legitimately extend beyond the activity it belongs to.
 * Absorbs clock skew and rounding between the activity row and the detail
 * response without letting one bogus timestamp widen the range arbitrarily.
 */
const TRACK_OVERHANG_TOLERANCE_MS = 5 * 60_000

export interface ActivitySpan {
  start: Date
  end: Date
}

/**
 * Range in which an activity's GPS track supersedes passive sources: the
 * activity span, widened to cover the track but never by more than
 * `TRACK_OVERHANG_TOLERANCE_MS`. Without a span, falls back to the track's own
 * range. Returns null when there is nothing to derive a range from.
 */
export const gpsPrecedenceSpan = (
  gpsPoints: { time: Date }[],
  activitySpan?: ActivitySpan | null,
): ActivitySpan | null => {
  // Clamp each track time into the tolerated window, so a single outlier
  // timestamp cannot stretch the range across months of phone history.
  const bounds = activitySpan
    ? {
        max: activitySpan.end.getTime() + TRACK_OVERHANG_TOLERANCE_MS,
        min: activitySpan.start.getTime() - TRACK_OVERHANG_TOLERANCE_MS,
      }
    : null
  const clamp = (time: number): number => (bounds ? Math.min(Math.max(time, bounds.min), bounds.max) : time)

  let min = activitySpan ? activitySpan.start.getTime() : Infinity
  let max = activitySpan ? activitySpan.end.getTime() : -Infinity

  // A loop rather than Math.min(...times): the Garmin path keeps every GPS
  // sample, so a long activity would exceed V8's argument limit. NaN from an
  // unparseable Date fails both comparisons and is skipped.
  for (const point of gpsPoints) {
    const time = clamp(point.time.getTime())
    if (time < min) min = time
    if (time > max) max = time
  }

  if (!Number.isFinite(min) || !Number.isFinite(max)) return null

  return { end: new Date(max), start: new Date(min) }
}
