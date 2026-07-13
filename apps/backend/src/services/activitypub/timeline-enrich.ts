/**
 * Enrich a received timeline post with its native Aurboda structured data.
 *
 * A `Note` delivered over ActivityPub carries only the Mastodon-compatible HTML
 * (Fedify's typed vocab drops the `aurboda:` extension). So when a followed
 * *Aurboda* instance posts, we fetch the richer structured payload it serves at
 * `GET /public/:user/feed/:postId` and store it on the timeline entry, letting
 * the web render a native chart + typed stats instead of the text.
 *
 * Strictly best-effort and defensive:
 * - Only Notes whose id matches Aurboda's own object-dispatcher path
 *   (`/users/{user}/feed/{postId}`) are candidates — a Mastodon status id never
 *   matches, so no needless fetch is made for non-Aurboda posts.
 * - The fetch goes through `safeFetchGet` (SSRF-guarded: public hosts only, no
 *   redirects, size + time bounded) and the origin is the *accepted followee's*
 *   host (already validated by `noteToTimelineInput`), not an arbitrary target.
 * - Any failure (non-Aurboda host, 404, malformed body, timeout) resolves to
 *   `null`; the post still shows with its HTML.
 *
 * The network dependencies are injected so the mapping is unit-testable offline.
 */
import {
  type FeedStructured,
  feedPostStructuredResponseSchema,
  type TimelineImage,
  type WellKnownAurboda,
} from '@aurboda/api-spec'

import { discoverInstance } from '../challenge-federation.ts'
import { safeFetchGet } from '../safe-fetch.ts'
import { withTimeout } from '../with-timeout.ts'

/** Aurboda's object-dispatcher path: `/users/{identifier}/feed/{postId}` (postId is a UUID). */
const FEED_OBJECT_PATH =
  /^\/users\/([^/]+)\/feed\/([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i

export interface ParsedFeedObject {
  origin: string
  user: string
  postId: string
}

/**
 * Parse an Aurboda feed-post object URI into its origin + user + postId, or null
 * if it isn't shaped like one (e.g. a Mastodon status URL).
 */
export const parseAurbodaFeedUrl = (raw: string): ParsedFeedObject | null => {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return null
  }
  const match = url.pathname.match(FEED_OBJECT_PATH)
  if (!match) return null
  return { origin: url.origin, postId: match[2], user: decodeURIComponent(match[1]) }
}

export interface AurbodaEnrichDeps {
  /** Resolve an instance's federation metadata (throws if not an Aurboda host). */
  discover: (base: string) => Promise<WellKnownAurboda>
  /** Fetch + JSON-decode a public URL (SSRF-guarded). */
  fetchStructured: (url: string) => Promise<unknown>
}

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/**
 * The capability token embedded in a `followers`-only post's delivered image URL
 * (`…/chart.png?token=…`), reused to authorize the structured fetch for the same
 * post — or undefined for a public post (no token) or a post with no images. It's
 * the same `image_token` the origin instance checks, so an accepted follower's
 * instance can fetch the native chart it was already allowed to see the image of.
 */
export const capabilityTokenFrom = (images: TimelineImage[]): string | undefined => {
  for (const img of images) {
    try {
      const token = new URL(img.url).searchParams.get('token')
      if (token) return token
    } catch {
      // A malformed image URL carries no usable token — skip it.
    }
  }
  return undefined
}

/**
 * Fetch the structured payload for an Aurboda feed-post object URI, or null if
 * the post isn't an Aurboda post, the host doesn't federate, or anything fails.
 * `token` (lifted from the delivered image URL) authorizes a `followers`-only
 * post; a public post needs none.
 */
export const enrichFromAurboda = async (
  objectUri: string,
  deps: AurbodaEnrichDeps,
  token?: string,
): Promise<FeedStructured | null> => {
  const parsed = parseAurbodaFeedUrl(objectUri)
  if (parsed == null) return null
  try {
    const wellKnown = await deps.discover(parsed.origin)
    const base = `${trimSlashes(wellKnown.api_base)}/public/${encodeURIComponent(parsed.user)}/feed/${parsed.postId}`
    const url = token == null ? base : `${base}?token=${encodeURIComponent(token)}`
    const body = await deps.fetchStructured(url)
    const result = feedPostStructuredResponseSchema.safeParse(body)
    if (!result.success || !result.data.structured) return null
    return result.data.structured
  } catch {
    return null
  }
}

/** Total time budget for one post's enrichment (discovery + structured fetch). */
const ENRICH_TIMEOUT_MS = 12_000

/**
 * The default enricher wired into the inbox handler: real discovery + guarded
 * fetch, bounded by a total timeout so a slow peer can't stall ingest, and
 * swallowing every error to `null` (enrichment is never allowed to fail ingest).
 */
export const createAurbodaEnricher = (): ((
  objectUri: string,
  token?: string,
) => Promise<FeedStructured | null>) => {
  const deps: AurbodaEnrichDeps = {
    discover: discoverInstance,
    fetchStructured: async (url) => (await safeFetchGet(url)).data,
  }
  return async (objectUri, token) => {
    try {
      return await withTimeout(enrichFromAurboda(objectUri, deps, token), ENRICH_TIMEOUT_MS)
    } catch {
      return null
    }
  }
}
