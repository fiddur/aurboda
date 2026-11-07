/** "avg N min", or null for point activities, which have no duration. */
export const formatAvgDuration = (avgDurationMin: number | null | undefined): string | null =>
  avgDurationMin === null || avgDurationMin === undefined ? null : `avg ${avgDurationMin} min`

/** Occurrence count for an HRV-context row, with the average duration when there is one. */
export const describeOccurrences = (
  occurrences: number,
  avgDurationMin: number | null | undefined,
): string => {
  const avg = formatAvgDuration(avgDurationMin)
  return avg ? `${occurrences}× (${avg})` : `${occurrences}×`
}
