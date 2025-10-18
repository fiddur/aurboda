import { isEqual } from 'date-fns'

export const reduceTimeSeries = <T>(series: [Date, T][]): [Date, T][] => {
  return series
    .sort(([a], [b]) => a.getTime() - b.getTime())
    .filter(([date], i, arr) => !isEqual(date, arr[i - 1]?.[0]))
}
