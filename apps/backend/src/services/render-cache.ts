/**
 * A tiny memoising cache with in-flight de-duplication (mirrors og-image-router):
 * repeated fetches for the same key serve the cached value, and concurrent misses
 * collapse to a single `produce`. Producing is expensive (a rasterised image) and
 * the source is effectively immutable per key, so a bounded LRU + process-restart
 * eviction is enough. `produce` returning `null` (no data / unauthorized) is NOT
 * cached. The caller checks eligibility BEFORE consulting this, so an
 * unshared/visibility-changed post 404s and never reaches the cache. Generic over
 * the cached value (defaults to `Buffer` for the image endpoints).
 */
export const createRenderCache = <T = Buffer>(maxEntries = 200) => {
  const cache = new Map<string, T>()
  const inFlight = new Map<string, Promise<T | null>>()
  return async (key: string, produce: () => Promise<T | null>): Promise<T | null> => {
    const cached = cache.get(key)
    if (cached) return cached
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = produce()
    inFlight.set(key, promise)
    try {
      const value = await promise
      if (value) {
        if (cache.size >= maxEntries) {
          const oldest = cache.keys().next().value
          if (oldest !== undefined) cache.delete(oldest)
        }
        cache.set(key, value)
      }
      return value
    } finally {
      inFlight.delete(key)
    }
  }
}

export interface TtlCacheOptions<T> {
  /** How long an entry serves before it is produced afresh; a call may pass its own. */
  ttlMs: number
  /** What the held entries may add up to, by `sizeOf`; the oldest go first past it. */
  maxBytes: number
  sizeOf: (value: T) => number
  now?: () => number
}

/**
 * `createRenderCache`'s in-flight de-duplication with entries that expire instead of
 * rotating keys: the key stays fixed for a version of its source, and the TTL bounds how
 * stale its data may get. Bounded by what it holds rather than by entry count, so a few
 * large values cannot pin more memory than a budget of small ones. A value larger than
 * the whole budget is served but not kept.
 */
export const createTtlCache = <T>({ maxBytes, now = Date.now, sizeOf, ttlMs }: TtlCacheOptions<T>) => {
  const cache = new Map<string, { bytes: number; expires: number; value: T }>()
  const inFlight = new Map<string, Promise<T | null>>()
  let held = 0

  const drop = (key: string) => {
    const entry = cache.get(key)
    if (entry === undefined) return
    held -= entry.bytes
    cache.delete(key)
  }

  const evict = () => {
    const at = now()
    for (const [key, entry] of cache) {
      if (held <= maxBytes && entry.expires > at) break
      drop(key)
    }
  }

  return async (key: string, produce: () => Promise<T | null>, ttl = ttlMs): Promise<T | null> => {
    const entry = cache.get(key)
    if (entry !== undefined) {
      if (entry.expires > now()) return entry.value
      drop(key)
    }
    const pending = inFlight.get(key)
    if (pending) return pending
    const promise = produce()
    inFlight.set(key, promise)
    try {
      const value = await promise
      if (value) {
        const bytes = sizeOf(value)
        if (bytes <= maxBytes) {
          cache.set(key, { bytes, expires: now() + ttl, value })
          held += bytes
          evict()
        }
      }
      return value
    } finally {
      inFlight.delete(key)
    }
  }
}
