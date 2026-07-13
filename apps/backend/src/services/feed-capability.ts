import type { FeedVisibility } from '@aurboda/api-spec'

/**
 * Capability-token authorization for a shared post's data endpoints.
 *
 * `public`/`unlisted` posts are always served. A `followers`-only post is served
 * only when the request carries the post's unguessable `image_token` (`?token=…`),
 * which is embedded solely in the Note delivered to followers. Shared by the media
 * (chart / route image) and structured-post endpoints so both enforce it
 * identically — a follower's instance reuses the same token (lifted from the
 * delivered image URL) to fetch the native structured chart.
 */
import { timingSafeEqual } from 'node:crypto'

import { isPubliclyVisible } from './activitypub/object.ts'

/** Constant-time string compare (avoids leaking the token via response timing). */
export const tokenMatches = (provided: string, expected: string): boolean => {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  return a.length === b.length && timingSafeEqual(a, b)
}

/**
 * Whether a request (optionally carrying `token`) may see this post's shared
 * data: `public`/`unlisted` always; a `followers`-only post only with a matching
 * capability token.
 */
export const isCapabilityAuthorized = (
  post: { visibility: FeedVisibility; image_token: string },
  token: string | undefined,
): boolean => isPubliclyVisible(post.visibility) || (token != null && tokenMatches(token, post.image_token))
