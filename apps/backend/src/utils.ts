import { isEqual } from 'date-fns'

export { UUID_RE } from '@aurboda/api-spec'

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

/** Maps `items` with at most `limit` calls of `fn` in flight, keeping the input order in the result. */
export const mapWithConcurrency = async <T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results = Array.from<R>({ length: items.length })
  let next = 0
  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}
