/**
 * Enrich a received timeline post with its native Aurboda structured data.
 *
 * A delivered `Note` carries the QuantPub scalar summary in-band (#896), but
 * not the high-resolution series data. So when a followed *Aurboda* instance
 * posts, we fetch the richer structured payload it serves at
 * `GET /public/:user/feed/:postId` (the FEP §7 id-convention path — reliable
 * even when a typed consumer drops in-band extension properties) and store it
 * on the timeline entry, letting the web render a native chart + typed stats
 * instead of the text.
 *
 * Strictly best-effort and defensive:
 * - Only Notes whose id matches Aurboda's own object-dispatcher path
 *   (`/users/{user}/feed/{postId}`) are candidates — a Mastodon status id never
 *   matches, so no needless fetch is made for non-Aurboda posts.
 * - A post whose origin IS this instance (a local-to-local follow) resolves
 *   **in-process** via the same `resolveStructuredPost` the public endpoint
 *   serves — an HTTP fetch of our own public origin would hairpin through the
 *   reverse proxy and, from inside the container, typically resolve to a
 *   private address the SSRF guard rightly refuses (#996).
 * - A remote fetch goes through `safeFetchGet` (SSRF-guarded: public hosts
 *   only, no redirects, size + time bounded) and the origin is the *accepted
 *   followee's* host (already validated by `noteToTimelineInput`).
 * - Any failure (non-federating host, 404, malformed body, timeout) resolves to
 *   `null` — the post still shows with its HTML — but is LOGGED by the default
 *   enricher, so a broken enrichment path is diagnosable instead of looking
 *   identical to a Mastodon post (#996).
 *
 * The network dependencies are injected so the mapping is unit-testable offline.
 */
import {
  feedPostStructuredResponseSchema,
  type FeedStructuredPost,
  type TimelineImage,
  type WellKnownAurboda,
} from '@aurboda/api-spec'
import axios from 'axios'

import { isValidUsername } from '../../api/auth-routes.ts'
import { discoverInstance } from '../challenge-federation.ts'
import { resolveStructuredPost } from '../feed-structured.ts'
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
  /**
   * Same-instance shortcut: when the object's origin IS this instance, resolve
   * the payload in-process instead of HTTP-fetching our own public URL (which
   * would hairpin through the proxy and trip the SSRF guard on the private
   * address it resolves to from inside the container).
   */
  local?: {
    origin: string
    resolve: (user: string, postId: string, token?: string) => Promise<FeedStructuredPost | null>
  }
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
 * Fetch the structured payload for an Aurboda feed-post object URI. Returns
 * `null` when the URI isn't Aurboda-shaped (a Mastodon status — the common,
 * silent case) or when the origin answers without a payload (post gone, or a
 * `followers`-only post without a valid token). THROWS on everything else —
 * failed discovery, unreachable host, malformed body — so the caller can log
 * the reason; the plain `enrichFromAurboda` never swallows.
 * `token` (lifted from the delivered image URL) authorizes a `followers`-only
 * post; a public post needs none.
 */
export const enrichFromAurboda = async (
  objectUri: string,
  deps: AurbodaEnrichDeps,
  token?: string,
): Promise<FeedStructuredPost | null> => {
  const parsed = parseAurbodaFeedUrl(objectUri)
  if (parsed == null) return null
  if (deps.local && parsed.origin === trimSlashes(deps.local.origin)) {
    return deps.local.resolve(parsed.user, parsed.postId, token)
  }
  const wellKnown = await deps.discover(parsed.origin)
  const base = `${trimSlashes(wellKnown.api_base)}/public/${encodeURIComponent(parsed.user)}/feed/${parsed.postId}`
  const url = token == null ? base : `${base}?token=${encodeURIComponent(token)}`
  const body = await deps.fetchStructured(url)
  const result = feedPostStructuredResponseSchema.safeParse(body)
  if (!result.success) throw new Error('malformed structured response')
  return result.data.structured ?? null
}

/** Total time budget for one post's enrichment (discovery + structured fetch). */
const ENRICH_TIMEOUT_MS = 12_000

/** An enricher: object URI (+ optional capability token) → structured payload or null. */
export type TimelineEnricher = (objectUri: string, token?: string) => Promise<FeedStructuredPost | null>

/** The real dependency wiring shared by both enricher variants below. */
const realEnrichDeps = (origin: string): AurbodaEnrichDeps => ({
  discover: discoverInstance,
  fetchStructured: async (url) => (await safeFetchGet(url)).data,
  local: {
    origin,
    // Same well-formedness guard as the HTTP route, before the name reaches the
    // DB layer (defense in depth — the ingest host check already gates callers).
    resolve: (user, postId, token) =>
      isValidUsername(user) ? resolveStructuredPost(user, postId, token) : Promise.resolve(null),
  },
})

/**
 * The default enricher wired into the inbox handler: in-process resolution for
 * this instance's own posts (`origin` is our public web origin), real discovery
 * + guarded fetch for remote peers, bounded by a total timeout so a slow peer
 * can't stall ingest. Every error still resolves to `null` (enrichment is never
 * allowed to fail ingest) but is logged first — an Aurboda-shaped post that
 * loses its native chart must be visible in the logs, not indistinguishable
 * from a Mastodon post (#996).
 */
export const createAurbodaEnricher = (origin: string): TimelineEnricher => {
  const attempt = createAurbodaEnrichAttempt(origin)
  return async (objectUri, token) => {
    try {
      return await attempt(objectUri, token)
    } catch (error) {
      console.warn(`⚠️ timeline enrichment failed for ${objectUri}:`, error)
      return null
    }
  }
}

/**
 * True when an enrichment error is a DEFINITIVE outcome retrying can't fix: a
 * malformed payload, or a definite HTTP answer (4xx — the origin's `GET
 * /public/:username/feed/:postId` answers 404 for a gone / unauthorized /
 * non-resolving post, which axios rejects on since `safeFetchGet` sets no
 * `validateStatus`). Connection errors, timeouts, and 5xx stay transient.
 */
export const isDefinitiveEnrichError = (error: unknown): boolean =>
  (error instanceof Error && error.message === 'malformed structured response') ||
  (axios.isAxiosError(error) && error.response != null && error.response.status < 500)

/**
 * Like {@link createAurbodaEnricher} but PROPAGATES transient failures (network
 * errors, timeouts, 5xx) instead of swallowing them, so the retro-enrichment
 * pass can retry such an entry later (#1014). Definitive outcomes still resolve
 * `null`: a non-Aurboda URI, a gone/unauthorized post (the origin's 404), or a
 * malformed payload — retrying those can't help — with the failure cases
 * logged like the default enricher.
 */
export const createAurbodaEnrichAttempt = (origin: string): TimelineEnricher => {
  const deps = realEnrichDeps(origin)
  return async (objectUri, token) => {
    if (parseAurbodaFeedUrl(objectUri) == null) return null
    let structured: FeedStructuredPost | null
    try {
      structured = await withTimeout(enrichFromAurboda(objectUri, deps, token), ENRICH_TIMEOUT_MS)
    } catch (error) {
      if (isDefinitiveEnrichError(error)) {
        console.warn(`⚠️ timeline enrichment: no payload for ${objectUri}:`, error)
        return null
      }
      throw error
    }
    if (structured == null) {
      console.warn(`⚠️ timeline enrichment: no payload for ${objectUri} (post gone or unauthorized)`)
    }
    return structured
  }
}
