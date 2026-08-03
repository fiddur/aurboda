/**
 * GPS precedence: an activity's own GPS track beats passive phone tracking.
 *
 * A watch or bike computer fixes position far more accurately than a phone in a
 * pocket, and keeping both interleaves two tracks into one zig-zagging path. So
 * when an activity brings its own GPS, locations from other sources are
 * soft-deleted for the activity's whole span — not just the range the track
 * happens to cover, since the track is downsampled and its first and last fixes
 * usually sit inside the activity.
 */

export interface ActivitySpan {
  start: Date
  end: Date
}

/**
 * Range in which an activity's GPS track supersedes other sources: the activity
 * span widened to cover the track itself. Falls back to the track's own range
 * when the span is unknown.
 */
export const gpsPrecedenceSpan = (
  gpsPoints: { time: Date }[],
  activitySpan?: ActivitySpan | null,
): ActivitySpan => {
  const times = gpsPoints.map((p) => p.time.getTime())
  if (activitySpan) times.push(activitySpan.start.getTime(), activitySpan.end.getTime())

  return { end: new Date(Math.max(...times)), start: new Date(Math.min(...times)) }
}
