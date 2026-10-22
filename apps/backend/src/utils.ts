import { isEqual } from 'date-fns'

export const reduceTimeSeries = <T>(series: [Date, T][]): [Date, T][] => {
  return series
    .sort(([a], [b]) => a.getTime() - b.getTime())
    .filter(([date], i, arr) => !isEqual(date, arr[i - 1]?.[0]))
}

/**
 * Appends `items` to `target` in place. `target.push(...items)` passes one
 * argument per element and throws `RangeError: Maximum call stack size
 * exceeded` once `items` reaches ~100k+ elements (a day of per-second samples).
 */
export const pushAll = <T>(target: T[], items: Iterable<T>): T[] => {
  for (const item of items) target.push(item)
  return target
}
