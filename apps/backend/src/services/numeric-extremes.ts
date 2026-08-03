/**
 * Min/max over arbitrarily long numeric arrays.
 *
 * `Math.max(...values)` passes one argument per element, so it throws
 * `RangeError: Maximum call stack size exceeded` somewhere above ~65k elements
 * — the exact size a per-second metric series reaches after a day or two. These
 * loop instead, so the bound is memory rather than the call stack.
 *
 * Both return undefined for an empty array rather than the ∓Infinity that
 * `Math.max()`/`Math.min()` yield with no arguments, which would otherwise leak
 * into stored summaries. NaN entries are skipped.
 */

const extreme = (values: readonly number[], keepLeft: (a: number, b: number) => boolean) => {
  let found: number | undefined
  for (const value of values) {
    if (Number.isNaN(value)) continue
    if (found === undefined || keepLeft(value, found)) found = value
  }
  return found
}

/** Largest value, or undefined when there is none. */
export const maxOf = (values: readonly number[]): number | undefined =>
  extreme(values, (candidate, best) => candidate > best)

/** Smallest value, or undefined when there is none. */
export const minOf = (values: readonly number[]): number | undefined =>
  extreme(values, (candidate, best) => candidate < best)
