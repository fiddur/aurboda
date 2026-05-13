/**
 * Empty-state copy for the Sleep Score Trend chart.
 *
 * The chart has two distinct empty conditions:
 * 1. No sleep activity at all → user hasn't recorded any sleep yet.
 * 2. Sleep activity exists but no score data → no sleep-scoring source
 *    (Oura, Garmin, …) is connected. Tell the user that specifically so
 *    they don't read "not enough data" as "the chart is broken" (#749).
 */
export interface SleepScoreEmptyState {
  message: string
  /** Path to link the user to (when relevant). */
  linkHref?: string
  /** Label for the link. */
  linkLabel?: string
}

export const getSleepScoreEmptyState = (
  scoreCount: number,
  hasSleepSessions: boolean,
): SleepScoreEmptyState | null => {
  if (scoreCount >= 2) return null
  if (hasSleepSessions) {
    return {
      linkHref: '/data-sources',
      linkLabel: 'Connect a sleep scoring source',
      message: 'Sleep Score Trend requires a scoring source (e.g. Oura or Garmin).',
    }
  }
  return { message: 'Not enough sleep data to display chart.' }
}
