import type { Express, Request, RequestHandler, Response } from 'express'

import type { Auth } from '../auth.ts'

import {
  createFailureBackoff,
  createTokenBucketLimiter,
  RATE_LIMITS,
  type TokenBucketLimiter,
  tooManyRequestsMessage,
} from '../services/rate-limit.ts'
import { isBlockedAddress } from '../services/safe-fetch.ts'

/** Express's `trust proxy`: `loopback` trusts the bundled nginx alone. */
export const DEFAULT_TRUST_PROXY = 'loopback'

/** `TRUST_PROXY` takes Express's `trust proxy` forms: a hop count, or addresses, subnets and `loopback`/`uniquelocal`. */
export const trustProxySetting = (value: string | undefined): string | number => {
  const trimmed = value?.trim()
  if (!trimmed) return DEFAULT_TRUST_PROXY
  return /^\d+$/.test(trimmed) ? Number(trimmed) : trimmed
}

const withoutIpv4Mapping = (ip: string) => ip.replace(/^::ffff:(?=\d+\.\d+\.\d+\.\d+$)/i, '')

export const isPublicAddress = (ip: string): boolean => !isBlockedAddress(withoutIpv4Mapping(ip))

/**
 * The client's address for per-IP limits, or undefined to skip them. A private
 * address means the request came from the LAN, or through a proxy in front of
 * nginx that `trust proxy` does not cover; limiting that address would put
 * every visitor in one bucket, so the IP limits stand aside and say so once.
 */
export const createClientIp = (warn: (message: string) => void) => {
  let warned = false
  return (req: Request): string | undefined => {
    const ip = req.ip
    if (ip && isPublicAddress(ip)) return ip
    const forwarded = req.get('x-forwarded-for')
    if (!warned && forwarded?.split(',').some((hop) => isPublicAddress(hop.trim()))) {
      warned = true
      warn(
        `⚠️ Requests arrive through a proxy at ${ip} that the backend does not trust, so per-IP rate limits are off. ` +
          'Set TRUST_PROXY (see docs/docker.md, "Behind your own proxy").',
      )
    }
    return undefined
  }
}

export const sendTooManyRequests = (res: Response, retryAfterSeconds: number, error: string) => {
  res.set('Retry-After', String(retryAfterSeconds))
  res.status(429).json({ error, success: false })
}

export const limitBy =
  (limiter: TokenBucketLimiter, keyOf: (req: Request) => string | undefined): RequestHandler =>
  (req, res, next) => {
    const key = keyOf(req)
    if (key === undefined) return next()
    const decision = limiter.take(key)
    if (decision.allowed) return next()
    sendTooManyRequests(
      res,
      decision.retry_after_seconds,
      tooManyRequestsMessage(decision.retry_after_seconds),
    )
  }

export type LoginAttempt =
  | { allowed: false; retry_after_seconds: number }
  | {
      allowed: true
      /** The password was right: clears the username's failures and takes back this attempt's. */
      succeeded: () => void
      /** No verdict on the password (the database was unreachable): takes back this attempt's failure. */
      inconclusive: () => void
    }

/**
 * Failed password logins, counted per client IP and per username; the longer
 * wait of the two applies. `begin` books the attempt as a failure before the
 * password is checked, synchronously, so guesses sent together cannot all read
 * "no wait" while the first is still awaiting Postgres; an attempt that turns
 * out not to be a failure is taken back. A rejected password needs no call.
 */
export interface FailedLogins {
  begin: (req: Request, username: string) => LoginAttempt
  /** Forgets the username's failures, after its password was reset. */
  clear: (username: string) => void
}

export interface RateLimits {
  authRequests: RequestHandler
  signups: RequestHandler
  publicReads: RequestHandler
  uploads: RequestHandler
  failedLogins: FailedLogins
}

export interface RateLimitsDeps {
  now: () => number
  clientIp: (req: Request) => string | undefined
  /** The account a request's bearer token names, without the auth middleware's checks. */
  accountOf: (req: Request) => string | undefined
  uploadLimiter: TokenBucketLimiter
}

export const createRateLimits = ({ now, clientIp, accountOf, uploadLimiter }: RateLimitsDeps): RateLimits => {
  const failuresByIp = createFailureBackoff(RATE_LIMITS.failed_logins_by_ip, now)
  const failuresByUsername = createFailureBackoff(RATE_LIMITS.failed_logins_by_username, now)
  const usernameKey = (username: string) => String(username).trim().toLowerCase()

  return {
    authRequests: limitBy(createTokenBucketLimiter(RATE_LIMITS.auth_requests, now), clientIp),
    failedLogins: {
      begin: (req, username) => {
        const ip = clientIp(req)
        const user = usernameKey(username)
        const wait = Math.max(
          ip ? failuresByIp.retryAfterSeconds(ip) : 0,
          failuresByUsername.retryAfterSeconds(user),
        )
        if (wait > 0) return { allowed: false, retry_after_seconds: wait }
        if (ip) failuresByIp.recordFailure(ip)
        failuresByUsername.recordFailure(user)
        return {
          allowed: true,
          inconclusive: () => {
            if (ip) failuresByIp.undoFailure(ip)
            failuresByUsername.undoFailure(user)
          },
          succeeded: () => {
            if (ip) failuresByIp.undoFailure(ip)
            failuresByUsername.reset(user)
          },
        }
      },
      clear: (username) => failuresByUsername.reset(usernameKey(username)),
    },
    publicReads: limitBy(createTokenBucketLimiter(RATE_LIMITS.public_reads, now), clientIp),
    signups: limitBy(createTokenBucketLimiter(RATE_LIMITS.signups, now), clientIp),
    uploads: limitBy(uploadLimiter, accountOf),
  }
}

export const bearerAccount =
  (auth: Pick<Auth, 'getUsernameFromToken'>) =>
  (req: Request): string | undefined => {
    const header = req.headers.authorization
    if (typeof header !== 'string') return undefined
    try {
      return auth.getUsernameFromToken(header.slice('bearer '.length))
    } catch {
      return undefined
    }
  }

/**
 * Every limited path in one place, mounted ahead of the routes they guard.
 * Authenticated API traffic other than uploads (the Android app's sync and
 * notification polling among it) is deliberately absent, and so are the
 * federation inboxes, which signatures gate and remote servers retry.
 */
export const mountRateLimits = (httpd: Express, limits: RateLimits) => {
  httpd.post(
    [
      '/login',
      '/account/email/verify',
      '/account/recovery/request',
      '/account/recovery/complete',
      '/authorize',
      '/token',
      '/register',
      '/webauthn/auth/options',
      '/webauthn/auth/verify',
      '/webauthn/signup/options',
      '/auth/oidc/:provider/start',
      '/auth/oidc/exchange',
      '/account/oidc/link/complete',
    ],
    limits.authRequests,
  )
  httpd.get(['/auth/oidc/callback', '/auth/oidc/signup-info'], limits.authRequests)
  httpd.post(['/signup', '/webauthn/signup/verify', '/auth/oidc/signup'], limits.signups)
  httpd.post(['/profile/avatar', '/challenges/:id/banner', '/feed/images'], limits.uploads)
  httpd.use(['/public', '/u', '/oembed'], limits.publicReads)
}
