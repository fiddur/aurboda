/**
 * In-process request limiting: one container serves an instance, so the state
 * lives in memory and starts empty after a restart. Each limiter takes its
 * clock, so tests drive time without fake timers.
 */

export type RateDecision = { allowed: true } | { allowed: false; retry_after_seconds: number }

export interface TokenBucketPolicy {
  /** Requests a key may make at once. */
  capacity: number
  /** Requests a key regains per second, up to `capacity`. */
  refill_per_second: number
}

export interface FailureBackoffPolicy {
  /** Failures a key may have before the first delay. */
  free_failures: number
  base_delay_ms: number
  /** The delay doubles with each further failure, up to this: a slowdown, never a lockout. */
  max_delay_ms: number
  /** A key's failures are forgotten this long after its last one. */
  forget_after_ms: number
}

export interface TokenBucketLimiter {
  take: (key: string) => RateDecision
}

export interface FailureBackoff {
  /** Seconds the key must wait before its next attempt, 0 when it may try now. */
  retryAfterSeconds: (key: string) => number
  recordFailure: (key: string) => void
  /** Takes back one `recordFailure`, for an attempt booked as a failure before its outcome was known. */
  undoFailure: (key: string) => void
  reset: (key: string) => void
}

const SWEEP_INTERVAL_MS = 60_000
const DEFAULT_MAX_KEYS = 100_000

/**
 * Drops idle entries once a minute, and the oldest ones past `maxKeys`, so a
 * flood of distinct keys cannot grow the map without bound.
 */
const createKeyedState = <T>(
  now: () => number,
  isIdle: (entry: T, at: number) => boolean,
  maxKeys: number,
) => {
  const entries = new Map<string, T>()
  let lastSweep = now()

  const sweep = (at: number) => {
    if (at - lastSweep >= SWEEP_INTERVAL_MS) {
      lastSweep = at
      for (const [key, entry] of entries) if (isIdle(entry, at)) entries.delete(key)
    }
    for (const key of entries.keys()) {
      if (entries.size < maxKeys) break
      entries.delete(key)
    }
  }

  return {
    delete: (key: string) => entries.delete(key),
    get: (key: string) => entries.get(key),
    set: (key: string, entry: T) => {
      if (!entries.has(key)) sweep(now())
      entries.delete(key)
      entries.set(key, entry)
    },
    size: () => entries.size,
  }
}

interface Bucket {
  tokens: number
  updated_at: number
}

export const createTokenBucketLimiter = (
  policy: TokenBucketPolicy,
  now: () => number,
  maxKeys = DEFAULT_MAX_KEYS,
): TokenBucketLimiter & { size: () => number } => {
  const tokensAt = (bucket: Bucket, at: number) =>
    Math.min(policy.capacity, bucket.tokens + ((at - bucket.updated_at) / 1000) * policy.refill_per_second)
  const state = createKeyedState<Bucket>(
    now,
    (bucket, at) => tokensAt(bucket, at) >= policy.capacity,
    maxKeys,
  )

  return {
    size: state.size,
    take: (key) => {
      const at = now()
      const bucket = state.get(key)
      const tokens = bucket ? tokensAt(bucket, at) : policy.capacity
      if (tokens >= 1) {
        state.set(key, { tokens: tokens - 1, updated_at: at })
        return { allowed: true }
      }
      state.set(key, { tokens, updated_at: at })
      return { allowed: false, retry_after_seconds: Math.ceil((1 - tokens) / policy.refill_per_second) }
    },
  }
}

interface Failures {
  count: number
  last_at: number
}

export const createFailureBackoff = (
  policy: FailureBackoffPolicy,
  now: () => number,
  maxKeys = DEFAULT_MAX_KEYS,
): FailureBackoff & { size: () => number } => {
  const isForgotten = (entry: Failures, at: number) => at - entry.last_at >= policy.forget_after_ms
  const state = createKeyedState<Failures>(now, isForgotten, maxKeys)

  const current = (key: string, at: number): Failures | undefined => {
    const entry = state.get(key)
    if (entry && isForgotten(entry, at)) {
      state.delete(key)
      return undefined
    }
    return entry
  }

  const delayMs = (count: number) =>
    count <= policy.free_failures
      ? 0
      : Math.min(policy.max_delay_ms, policy.base_delay_ms * 2 ** (count - policy.free_failures - 1))

  return {
    recordFailure: (key) => {
      const at = now()
      state.set(key, { count: (current(key, at)?.count ?? 0) + 1, last_at: at })
    },
    reset: (key) => void state.delete(key),
    retryAfterSeconds: (key) => {
      const at = now()
      const entry = current(key, at)
      if (!entry) return 0
      return Math.max(0, Math.ceil((entry.last_at + delayMs(entry.count) - at) / 1000))
    },
    size: state.size,
    undoFailure: (key) => {
      const entry = current(key, now())
      if (!entry) return
      if (entry.count <= 1) state.delete(key)
      else state.set(key, { ...entry, count: entry.count - 1 })
    },
  }
}

const waitMessage = (seconds: number) => `Try again in ${seconds} second${seconds === 1 ? '' : 's'}.`

export const tooManyRequestsMessage = (seconds: number) => `Too many requests. ${waitMessage(seconds)}`

export const tooManyFailedLoginsMessage = (seconds: number) =>
  `Too many failed sign-in attempts. ${waitMessage(seconds)}`

const MINUTE_MS = 60_000
const HOUR_S = 3600

/**
 * Generous on purpose: a person signing in, a family signing up, someone
 * scrolling a feed full of charts, the Android app's sync and an article
 * with a gallery of pictures all stay well inside them. Authenticated API
 * traffic other than uploads is not limited at all.
 */
export const RATE_LIMITS = {
  /** Per client IP: the login, passkey, OAuth and account recovery endpoints. Claude's MCP token refreshes share a few IPs. */
  auth_requests: { capacity: 30, refill_per_second: 0.5 },
  /** Per client IP, failed password logins (`/login`, the OAuth sign-in form). */
  failed_logins_by_ip: {
    base_delay_ms: 1000,
    forget_after_ms: 15 * MINUTE_MS,
    free_failures: 20,
    max_delay_ms: MINUTE_MS,
  },
  failed_logins_by_username: {
    base_delay_ms: 1000,
    forget_after_ms: 15 * MINUTE_MS,
    free_failures: 5,
    max_delay_ms: MINUTE_MS,
  },
  /** Per admin: test mails from the admin settings. */
  admin_test_mails: { capacity: 10, refill_per_second: 10 / HOUR_S },
  /** Per account: password reset and recovery links; requests beyond it are dropped silently. */
  recovery_mails: { capacity: 3, refill_per_second: 3 / HOUR_S },
  /** Per account: email verification links, REST and MCP together. */
  verification_mails: { capacity: 3, refill_per_second: 3 / HOUR_S },
  /** Per client IP: the unauthenticated public pages, images and payloads under `/public`, `/u` and `/oembed`. */
  public_reads: { capacity: 300, refill_per_second: 3 },
  /** Per client IP: new accounts, by password or passkey. */
  signups: { capacity: 5, refill_per_second: 1 / 600 },
  /** Per account: avatar, challenge banner and feed picture uploads, REST and MCP together. */
  uploads: { capacity: 30, refill_per_second: 1 / 6 },
} as const satisfies Record<string, TokenBucketPolicy | FailureBackoffPolicy>

/** Shared by the REST upload routes and MCP's `add_feed_image`, so one account has one budget. */
export const accountUploadLimiter = createTokenBucketLimiter(RATE_LIMITS.uploads, Date.now)
