/**
 * Preprocesses time series data to insert nulls at gaps, allowing
 * the line chart to show breaks in the data.
 *
 * @param data - Array of [Date, value] tuples
 * @param gapThresholdMinutes - Minimum gap in minutes to insert a null
 * @returns Array with nulls inserted at gaps
 */
export const preprocessData = (
  data: [Date, number][],
  gapThresholdMinutes: number,
): ([Date, number] | null)[] => {
  if (data.length === 0) return []
  const thresholdMs = gapThresholdMinutes * 60 * 1000
  const result: ([Date, number] | null)[] = [data[0]!]
  for (let i = 1; i < data.length; i++) {
    const prev = data[i - 1]!
    const curr = data[i]!
    if (curr[0].getTime() - prev[0].getTime() > thresholdMs) {
      result.push(null)
    }
    result.push(curr)
  }
  return result
}
