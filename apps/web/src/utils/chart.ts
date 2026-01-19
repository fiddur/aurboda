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
  const thresholdMs = gapThresholdMinutes * 60 * 1000
  return data.reduce<([Date, number] | null)[]>((acc, curr) => {
    const last = acc.at(-1)
    return last && curr[0].getTime() - (last as [Date, number])[0].getTime() > thresholdMs ?
        [...acc, null, curr]
      : [...acc, curr]
  }, [])
}
