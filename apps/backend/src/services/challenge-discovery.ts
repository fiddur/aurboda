/**
 * Challenge discovery: the open challenges hosted by people the user follows
 * that they have not joined — the "what could I join next?" behind the web
 * challenges page and the Android widget once its challenge is over.
 *
 * Followees come from the ActivityPub following list. Every accepted followee
 * whose actor id has the `<base>/users/<name>` shape is a *candidate* Aurboda
 * peer — Mastodon mints the same shape — and `/.well-known/aurboda` decides,
 * cached per instance so a Mastodon followee costs one probe an hour rather
 * than one per page load. A peer's public challenges are its public-profile
 * listing (`GET <api>/public/<name>/dashboards`); a followee on this very
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
} from '@aurboda/api-spec'
import { isAxiosError } from 'axios'

import type { ChallengeParticipationRecord, ChallengeRecord, FeedFollowingRecord } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  listAcceptedFeedFollowing,
  listChallengeParticipations,
  listChallenges,
  listPublicChallenges,
} from '../db/index.ts'
import { isMissingDatabase } from '../db/pg-errors.ts'
import { discoverInstance } from './challenge-federation.ts'
import { specToApi } from './challenge-spec.ts'
import { safeFetchGet } from './safe-fetch.ts'
import { buildProfileUrl, buildShareUrl } from './share-urls.ts'

/** How long a peer may take to list its challenges before it counts as unreachable this round. */
const PEER_TIMEOUT_MS = 4000
/** How long one instance's "is / is not an Aurboda host" answer is remembered. */
const INSTANCE_TTL_MS = 60 * 60_000
const DEFAULT_CONCURRENCY = 4

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

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
export type InstanceProbe = { kind: 'aurboda'; api_base: string } | { kind: 'not_aurboda' }

/**
 * A failure that says nothing about whether the host is an Aurboda instance —
 * no answer at all, or a server error — as opposed to a definite "no" (a 404 for
 * the well-known document, a non-Aurboda body, a private address we refuse).
 */
export const isTransientFetchError = (error: unknown): boolean =>
  isAxiosError(error) && (error.response == null || error.response.status >= 500)

/** Probe `<base>/.well-known/aurboda`, folding definite negatives into a value. */
export const probeInstance = async (base: string): Promise<InstanceProbe> => {
  try {
    const wellKnown = await discoverInstance(base)
    return { api_base: wellKnown.api_base, kind: 'aurboda' }
  } catch (error) {
    if (isTransientFetchError(error)) throw error
    return { kind: 'not_aurboda' }
  }
}

export type ApiBaseResolver = (base: string) => Promise<string | null>

/**
 * A per-instance memo of the well-known probe: an Aurboda host's API base, or
 * null for any other server. Both answers are kept for [ttlMs]; a transient
 * failure is not remembered (and rethrown) so the peer is retried next time.
 */
export const createApiBaseResolver = (
  probe: (base: string) => Promise<InstanceProbe> = probeInstance,
  ttlMs = INSTANCE_TTL_MS,
  now: () => number = Date.now,
): ApiBaseResolver => {
  const cache = new Map<string, { apiBase: string | null; expiresAt: number }>()
  return async (base) => {
    const hit = cache.get(base)
    if (hit && hit.expiresAt > now()) return hit.apiBase
    const outcome = await probe(base)
    const apiBase = outcome.kind === 'aurboda' ? trimSlashes(outcome.api_base) : null
    cache.set(base, { apiBase, expiresAt: now() + ttlMs })
    return apiBase
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
  /** Public challenges of a user on THIS instance — no HTTP round trip. */
  listLocalPublic: (username: string) => Promise<ChallengeRecord[]>
  resolveApiBase: ApiBaseResolver
  fetchPeerProfile: (apiBase: string, username: string) => Promise<PublicProfileResponse>
  now?: () => Date
  concurrency?: number
}

export interface ChallengeDiscoveryResult {
  challenges: DiscoveredChallenge[]
  /** Followed Aurboda instances that did not answer this round. */
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
  const apiBase = await deps.resolveApiBase(parsed.base)
  if (apiBase == null) return null
  const profile = await deps.fetchPeerProfile(apiBase, parsed.username)
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
    const [following, hosted, participations] = await Promise.all([
      deps.listFollowing(user),
      deps.listHosted(user),
      deps.listParticipations(user),
    ])
    // Everything the user already has a row for — hosted, joined, or left
    // (leaving was a choice; the widget/page shouldn't nag) — is never suggested.
    const mine = new Set([
      ...hosted.map((c) => trimSlashes(buildShareUrl(deps.webHost, user, c.slug))),
      ...participations.map((p) => trimSlashes(p.challenge_url)),
    ])

    const peers = following.flatMap((followee) => {
      const parsed = parseActorUri(followee.actor_uri)
      return parsed ? [{ followee, parsed }] : []
    })
    const listings = await mapWithConcurrency(
      peers,
      deps.concurrency ?? DEFAULT_CONCURRENCY,
      async ({ followee, parsed }) => {
        try {
          return { followee, items: await listPeerChallenges(deps, parsed), parsed }
        } catch (error) {
          console.warn(
            `⚠️ Challenge discovery: could not list ${followee.actor_uri}:`,
            error instanceof Error ? error.message : error,
          )
          return { followee, items: undefined, parsed }
        }
      },
    )

    let peersUnreachable = 0
    const found: DiscoveredChallenge[] = []
    for (const { followee, items, parsed } of listings) {
      if (items === undefined) {
        peersUnreachable += 1
        continue
      }
      if (items === null) continue
      for (const item of items) {
        const discovered = toDiscovered(item, followee, parsed, now)
        if (discovered && !mine.has(trimSlashes(discovered.share_url))) found.push(discovered)
      }
    }
    return { challenges: sortDiscovered(found), peers_unreachable: peersUnreachable }
  }

/** The production wiring: real DB reads, SSRF-guarded peer fetches, a memoised well-known probe. */
export const defaultChallengeDiscoveryDeps = (webHost: string): ChallengeDiscoveryDeps => ({
  fetchPeerProfile: async (apiBase, username) => {
    const res = await safeFetchGet(`${apiBase}/public/${encodeURIComponent(username)}/dashboards`, {
      timeout: PEER_TIMEOUT_MS,
    })
    return publicProfileResponseSchema.parse(res.data)
  },
  listFollowing: listAcceptedFeedFollowing,
  listHosted: listChallenges,
  listLocalPublic: listPublicChallenges,
  listParticipations: listChallengeParticipations,
  resolveApiBase: createApiBaseResolver(),
  webHost,
})
