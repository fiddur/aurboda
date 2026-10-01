interface TimeBucket {
  start: Date
  end: Date
}

/**
 * The buckets worth drawing for the visible x-range `[startMs, endMs]`.
 *
 * Everything drawn from the result must look exactly as if all buckets had been
 * passed, so the cut is widened:
 * - to whole `alignMs` windows (bars are re-aggregated on that epoch grid, and a
 *   partially included window would draw a short bar),
 * - by one bucket on each side, so lines and bands run to the viewport edge,
 * - to index multiples of `chunk` (line charts merge every N consecutive
 *   buckets counted from the array start).
 */
export const visibleBuckets = <T extends TimeBucket>(
  buckets: T[],
  startMs: number,
  endMs: number,
  alignMs: number,
  chunk: number,
): T[] => {
  if (buckets.length === 0) return buckets

  const windowStartMs = Math.floor(startMs / alignMs) * alignMs
  const windowEndMs = Math.ceil(endMs / alignMs) * alignMs

  let first = buckets.findIndex((b) => b.end.getTime() > windowStartMs)
  if (first === -1) first = buckets.length
  first = Math.max(0, first - 1)
  first = Math.floor(first / chunk) * chunk

  let afterLast = buckets.findIndex((b) => b.start.getTime() >= windowEndMs)
  if (afterLast === -1) afterLast = buckets.length
  afterLast = Math.min(buckets.length, afterLast + 1)
  afterLast = Math.min(buckets.length, Math.ceil(afterLast / chunk) * chunk)

  if (first === 0 && afterLast === buckets.length) return buckets
  return buckets.slice(first, afterLast)
}
