/**
 * A tiny memoising cache with in-flight de-duplication (mirrors og-image-router):
 * repeated fetches for the same key serve the cached value, and concurrent misses
 * collapse to a single `produce`. Producing is expensive (a rasterised image, or
 * a many-block structured payload) and the source is effectively immutable per
 * key, so a bounded LRU + process-restart eviction is enough. `produce` returning
 * `null` (no data / unauthorized) is NOT cached. The caller checks eligibility
 * BEFORE consulting this, so an unshared/visibility-changed post 404s and never
 * reaches the cache. Generic over the cached value (defaults to `Buffer` for the
 * image endpoints; the structured endpoint caches its payload object).
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
