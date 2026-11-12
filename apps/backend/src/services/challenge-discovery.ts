/**
 * Challenge discovery: the open challenges hosted by people the user follows
 * that they have not joined — the "what could I join next?" behind the web
 * challenges page and the Android widget once its challenge is over.
 *
 * Followees come from the ActivityPub following list. Every accepted followee
 * whose actor id has the `<base>/users/<name>` shape is a *candidate* Aurboda
 * peer — Mastodon mints the same shape — and the well-known documents decide
 * (`/.well-known/quantpub` with `challenges: true`, else `/.well-known/aurboda`),
 * cached per instance so a Mastodon followee costs one probe an hour rather
 * than one per page load. A QuantPub peer's public challenges are its
 * challenge listing (`GET <api>/public/<name>/challenges`), an older Aurboda
 * peer's its public-profile listing (`GET <api>/public/<name>/dashboards`); a followee on this very
 * instance is read in-process. Unlisted challenges are not discoverable, by
 * design: they are reachable only by their link.
 *
 * Everything the peer says is untrusted: a listed challenge is kept only when
 * its link points back into that peer's own `/u/<name>/` space, so a rogue
 * instance cannot plant a link to somewhere else in the user's list.
 */
import {
  type DiscoveredChallenge,
  type PublicChallengeListItem,
  type PublicProfileResponse,
  publicProfileResponseSchema,
  type QuantChallengeDocument,
  type QuantChallengeList,
  quantChallengeListSchema,
} from '@aurboda/api-spec'

import type { ChallengeParticipationRecord, ChallengeRecord, FeedFollowingRecord } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  listAcceptedFeedFollowing,
  listChallengeParticipations,
  listChallenges,
  listLeftChallengeUrls,
  listPublicChallenges,
} from '../db/index.ts'
import { isMissingDatabase } from '../db/pg-errors.ts'
import {
  canonicalChallengeUrl,
  type ChallengeHost,
  discoverInstance,
  specFromChallengeDocument,
} from './challenge-federation.ts'
import { specToApi } from './challenge-spec.ts'
import { isTransientFetchError, safeFetchGet } from './safe-fetch.ts'
import { buildProfileUrl, buildShareUrl } from './share-urls.ts'

/** How long a peer may take to list its challenges before it counts as unreachable this round. */
const PEER_TIMEOUT_MS = 4000
/** How long one instance's "is / is not an Aurboda host" answer is remembered. */
const INSTANCE_TTL_MS = 60 * 60_000
const DEFAULT_CONCURRENCY = 4

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

/** The spelling every challenge URL is compared by; unparsable links fall back to their trimmed form. */
const canonical = (url: string): string => canonicalChallengeUrl(url) ?? trimSlashes(url)

export interface ParsedActorUri {
  base: string
  username: string
}

/**
 * Split an actor id of the `<base>/users/<name>` shape (the id Aurboda mints;
 * `base` may carry a sub-path). Null for any other shape — a Mastodon `/@name`
 * profile URL, a nested path, an empty name. A match only says "maybe an
 * Aurboda peer": the well-known lookup has the final word.
 */
export const parseActorUri = (actorUri: string): ParsedActorUri | null => {
  const marker = '/users/'
  const i = actorUri.lastIndexOf(marker)
  if (i <= 0) return null
  const base = trimSlashes(actorUri.slice(0, i))
  if (!/^https?:\/\/[^/]+/.test(base)) return null
  const segments = actorUri
    .slice(i + marker.length)
    .split('/')
    .filter(Boolean)
  if (segments.length !== 1) return null
  try {
    const username = decodeURIComponent(segments[0])
    return username ? { base, username } : null
  } catch {
    return null
  }
}

/** What a well-known probe of an instance concluded. A transient failure throws instead. */
export type InstanceProbe =
  | { kind: 'aurboda'; api_base: string }
  | { kind: 'quantpub'; api_base: string }
  | { kind: 'not_aurboda' }

/** Probe the instance's well-known documents, folding definite negatives into a value. */
export const probeInstance = async (base: string): Promise<InstanceProbe> => {
  try {
    const host = await discoverInstance(base)
    return { api_base: host.apiBase, kind: host.kind }
  } catch (error) {
    if (isTransientFetchError(error)) throw error
    return { kind: 'not_aurboda' }
  }
}

export type ApiBaseResolver = (base: string) => Promise<ChallengeHost | null>

/**
 * A per-instance memo of the well-known probe: a challenge host's protocol and
 * API base, or null for any other server. Both answers are kept for [ttlMs]; a
 * transient failure is not remembered (and rethrown) so the peer is retried
 * next time.
 *
 * The in-flight promise is memoised too: followees are walked concurrently, so
 * without it every followee on one instance would fire its own probe on a cold
 * round (#1098). A rejected probe drops out of the map, leaving the next call
 * to retry.
 */
export const createApiBaseResolver = (
  probe: (base: string) => Promise<InstanceProbe> = probeInstance,
  ttlMs = INSTANCE_TTL_MS,
  now: () => number = Date.now,
): ApiBaseResolver => {
  const cache = new Map<string, { host: ChallengeHost | null; expiresAt: number }>()
  const inFlight = new Map<string, Promise<ChallengeHost | null>>()
  return async (base) => {
    const hit = cache.get(base)
    if (hit && hit.expiresAt > now()) return hit.host
    const pending = inFlight.get(base)
    if (pending) return pending
    const request = probe(base)
      .then((outcome) => {
        const host =
          outcome.kind === 'not_aurboda'
            ? null
            : { apiBase: trimSlashes(outcome.api_base), kind: outcome.kind }
        cache.set(base, { expiresAt: now() + ttlMs, host })
        return host
      })
      .finally(() => {
        inFlight.delete(base)
      })
    inFlight.set(base, request)
    return request
  }
}

/**
 * A QuantPub listing item in the shape discovery maps from. An item this
 * instance could not score (an unknown extension key) is left out: the user
 * could not join it anyway.
 */
export const quantListItemToPublic = (item: QuantChallengeDocument): PublicChallengeListItem | null => {
  try {
    const spec = specToApi(specFromChallengeDocument(item))
    return {
      end_ts: item.endTime,
      name: item.name,
      share_url: item.url,
      slug: item.url.replace(/\/+$/, '').split('/').pop() ?? '',
      spec,
      start_ts: item.startTime,
      timezone: item.timezone,
    }
  } catch {
    return null
  }
}

/** The public-profile listing of one hosted challenge (shared with the public profile route). */
export const toPublicChallengeListItem = (
  record: ChallengeRecord,
  webHost: string,
  username: string,
): PublicChallengeListItem => ({
  end_ts: record.end_ts.toISOString(),
  name: record.name,
  share_url: buildShareUrl(webHost, username, record.slug),
  slug: record.slug,
  spec: specToApi(record.spec),
  start_ts: record.start_ts.toISOString(),
  timezone: record.timezone,
})

export interface ChallengeDiscoveryDeps {
  webHost: string
  listFollowing: (user: string) => Promise<FeedFollowingRecord[]>
  listHosted: (user: string) => Promise<ChallengeRecord[]>
  listParticipations: (user: string) => Promise<ChallengeParticipationRecord[]>
  /** URLs of challenges the user left (the leave tombstones). */
  listLeft: (user: string) => Promise<string[]>
  /** Public challenges of a user on THIS instance — no HTTP round trip. */
  listLocalPublic: (username: string) => Promise<ChallengeRecord[]>
  resolveApiBase: ApiBaseResolver
  fetchPeerProfile: (apiBase: string, username: string) => Promise<PublicProfileResponse>
  /** A QuantPub host's public challenge listing. */
  fetchPeerChallenges: (apiBase: string, username: string) => Promise<QuantChallengeList>
  now?: () => Date
  concurrency?: number
}

export interface ChallengeDiscoveryResult {
  challenges: DiscoveredChallenge[]
  /** Followed *instances* that did not answer this round — one dead host counts once. */
  peers_unreachable: number
}

export type DiscoverChallenges = (user: string) => Promise<ChallengeDiscoveryResult>

const mapWithConcurrency = async <T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> => {
  const results: R[] = []
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const i = next++
      results[i] = await fn(items[i])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

/**
 * One followee's public challenge listing: `null` when the followee is not an
 * Aurboda user (nothing to list), the items otherwise. Throws when the peer
 * could not be asked.
 */
const listPeerChallenges = async (
  deps: ChallengeDiscoveryDeps,
  parsed: ParsedActorUri,
): Promise<PublicChallengeListItem[] | null> => {
  if (parsed.base === trimSlashes(deps.webHost)) {
    if (!isValidUsername(parsed.username)) return null
    try {
      const records = await deps.listLocalPublic(parsed.username)
      return records.map((r) => toPublicChallengeListItem(r, deps.webHost, parsed.username))
    } catch (error) {
      if (isMissingDatabase(error)) return null
      throw error
    }
  }
  const host = await deps.resolveApiBase(parsed.base)
  if (host == null) return null
  if (host.kind === 'quantpub') {
    const list = await deps.fetchPeerChallenges(host.apiBase, parsed.username)
    return list.items.flatMap((item) => quantListItemToPublic(item) ?? [])
  }
  const profile = await deps.fetchPeerProfile(host.apiBase, parsed.username)
  return profile.challenges ?? []
}

const toDiscovered = (
  item: PublicChallengeListItem,
  followee: FeedFollowingRecord,
  parsed: ParsedActorUri,
  now: Date,
): DiscoveredChallenge | null => {
  // A peer from before the listing carried windows can't tell us whether the
  // challenge is still open, so it is left out rather than shown as "ongoing".
  if (!item.start_ts || !item.end_ts || !item.spec || !item.timezone) return null
  const start = new Date(item.start_ts)
  const end = new Date(item.end_ts)
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || end <= now) return null
  // The link must point into the host's own space on their own instance.
  if (!item.share_url.startsWith(`${parsed.base}/u/${encodeURIComponent(parsed.username)}/`)) return null
  return {
    end_ts: item.end_ts,
    host_actor_uri: followee.actor_uri,
    host_display_name: followee.display_name,
    host_handle: followee.handle,
    host_identity: buildProfileUrl(parsed.base, parsed.username),
    name: item.name,
    share_url: item.share_url,
    spec: item.spec,
    start_ts: item.start_ts,
    status: start > now ? 'upcoming' : 'ongoing',
    timezone: item.timezone,
  }
}

/** Ongoing first, soonest to end; then upcoming, soonest to start. */
export const sortDiscovered = (list: DiscoveredChallenge[]): DiscoveredChallenge[] =>
  [...list].sort((a, b) => {
    if (a.status !== b.status) return a.status === 'ongoing' ? -1 : 1
    return a.status === 'ongoing'
      ? Date.parse(a.end_ts) - Date.parse(b.end_ts)
      : Date.parse(a.start_ts) - Date.parse(b.start_ts)
  })

export const createChallengeDiscovery =
  (deps: ChallengeDiscoveryDeps): DiscoverChallenges =>
  async (user) => {
    const now = (deps.now ?? (() => new Date()))()
    const [following, hosted, participations, left] = await Promise.all([
      deps.listFollowing(user),
      deps.listHosted(user),
      deps.listParticipations(user),
      deps.listLeft(user),
    ])
    // Everything the user already has a row for — hosted, joined, or left
    // (leaving was a choice; the widget/page shouldn't nag) — is never
    // suggested.
    const mine = new Set([
      ...hosted.map((c) => canonical(buildShareUrl(deps.webHost, user, c.slug))),
      ...participations.map((p) => canonical(p.challenge_url)),
      ...left.map((url) => canonical(url)),
    ])

    const peers = following.flatMap((followee) => {
      const parsed = parseActorUri(followee.actor_uri)
      return parsed ? [{ followee, parsed }] : []
    })
    // A transient failure is not cached by the resolver, and the pool walks
    // followees mostly one after another, so without this every followee on a
    // throttling or hanging instance would probe it again this round.
    const failedBases = new Set<string>()
    const listings = await mapWithConcurrency(
      peers,
      deps.concurrency ?? DEFAULT_CONCURRENCY,
      async ({ followee, parsed }) => {
        if (failedBases.has(parsed.base)) return { followee, items: undefined, parsed }
        try {
          return { followee, items: await listPeerChallenges(deps, parsed), parsed }
        } catch (error) {
          if (isTransientFetchError(error)) failedBases.add(parsed.base)
          console.warn(
            `⚠️ Challenge discovery: could not list ${followee.actor_uri}:`,
            error instanceof Error ? error.message : error,
          )
          return { followee, items: undefined, parsed }
        }
      },
    )

    const unreachableBases = new Set<string>()
    const found: DiscoveredChallenge[] = []
    for (const { followee, items, parsed } of listings) {
      if (items === undefined) {
        unreachableBases.add(parsed.base)
        continue
      }
      if (items === null) continue
      for (const item of items) {
        const discovered = toDiscovered(item, followee, parsed, now)
        if (discovered && !mine.has(canonical(discovered.share_url))) found.push(discovered)
      }
    }
    return { challenges: sortDiscovered(found), peers_unreachable: unreachableBases.size }
  }

/** The production wiring: real DB reads, SSRF-guarded peer fetches, a memoised well-known probe. */
export const defaultChallengeDiscoveryDeps = (webHost: string): ChallengeDiscoveryDeps => ({
  fetchPeerChallenges: async (apiBase, username) => {
    const res = await safeFetchGet(`${apiBase}/public/${encodeURIComponent(username)}/challenges`, {
      timeout: PEER_TIMEOUT_MS,
    })
    return quantChallengeListSchema.parse(res.data)
  },
  fetchPeerProfile: async (apiBase, username) => {
    const res = await safeFetchGet(`${apiBase}/public/${encodeURIComponent(username)}/dashboards`, {
      timeout: PEER_TIMEOUT_MS,
    })
    return publicProfileResponseSchema.parse(res.data)
  },
  listFollowing: listAcceptedFeedFollowing,
  listHosted: listChallenges,
  listLeft: listLeftChallengeUrls,
  listLocalPublic: listPublicChallenges,
  listParticipations: listChallengeParticipations,
  resolveApiBase: createApiBaseResolver(),
  webHost,
})
