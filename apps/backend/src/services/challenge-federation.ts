/**
 * Cross-instance challenge federation — server-to-server HTTP.
 *
 * The first real cross-instance traffic in Aurboda. A joining instance fetches
 * the challenge spec from the host, creates a local participation backing a
 * capability data endpoint, and registers itself back to the host. The host
 * later pulls each remote member's data endpoint to build standings.
 *
 * Trust model: a member's instance is trusted to report honest numbers
 * (Strava-style). Capability tokens + the unguessable slug are the only gates.
 */
import {
  type ChallengeDataResponse,
  challengeDataResponseSchema,
  type PublicChallenge,
  publicChallengeResponseSchema,
  type WellKnownAurboda,
  wellKnownAurbodaSchema,
} from '@aurboda/api-spec'
import axios from 'axios'

import {
  type ChallengeParticipationRecord,
  createChallengeParticipation,
  deleteChallengeParticipation,
  getChallengeBySlug,
  upsertChallengeMember,
} from '../db/index.ts'
import { buildProfileUrl, buildShareUrl } from './share-urls.ts'

export type JoinChallengeErrorKind = 'invalid_url' | 'not_found' | 'federation'

/** Error subclass so callers can map join failures to HTTP statuses. */
export class JoinChallengeError extends Error {
  readonly kind: JoinChallengeErrorKind

  constructor(message: string, kind: JoinChallengeErrorKind) {
    super(message)
    this.name = 'JoinChallengeError'
    this.kind = kind
  }
}

const HTTP_TIMEOUT_MS = 8000

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')
const joinUrl = (base: string, path: string): string => `${trimSlashes(base)}/${path.replace(/^\/+/, '')}`

export interface ParsedChallengeUrl {
  base: string
  username: string
  slug: string
}

/** Parse a public challenge URL `<base>/u/<username>/<slug>` (base may have a sub-path). */
export const parseChallengeUrl = (url: string): ParsedChallengeUrl | null => {
  const marker = '/u/'
  const i = url.indexOf(marker)
  if (i < 0) return null
  const base = trimSlashes(url.slice(0, i))
  const [username, slug] = url
    .slice(i + marker.length)
    .split('/')
    .filter(Boolean)
  if (!base || !username || !slug) return null
  return { base, slug, username }
}

/** Discover an instance's federation metadata from its base URL. */
export const discoverInstance = async (base: string): Promise<WellKnownAurboda> => {
  const res = await axios.get(joinUrl(base, '.well-known/aurboda'), { timeout: HTTP_TIMEOUT_MS })
  const wellKnown = wellKnownAurbodaSchema.parse(res.data)
  if (wellKnown.product !== 'aurboda' || !wellKnown.federation) {
    throw new Error('Host does not support Aurboda federation')
  }
  return wellKnown
}

/** Fetch a challenge spec from a host's public resolver; throws if not a challenge. */
export const fetchChallengeSpec = async (
  apiBase: string,
  username: string,
  slug: string,
): Promise<PublicChallenge> => {
  const res = await axios.get(
    joinUrl(apiBase, `public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`),
    {
      timeout: HTTP_TIMEOUT_MS,
    },
  )
  const parsed = publicChallengeResponseSchema.safeParse(res.data)
  if (!parsed.success || parsed.data.type !== 'challenge' || !parsed.data.challenge) {
    throw new Error('URL is not an Aurboda challenge')
  }
  return parsed.data.challenge
}

/** Register a member back to the host instance. */
export const registerMemberWithHost = async (
  apiBase: string,
  username: string,
  slug: string,
  body: { identity_base_url: string; display_name: string; data_endpoint_url: string; join_token: string },
): Promise<void> => {
  const res = await axios.post(
    joinUrl(apiBase, `public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/members`),
    body,
    { timeout: HTTP_TIMEOUT_MS },
  )
  if (res.data?.success === false) {
    throw new Error(typeof res.data.error === 'string' ? res.data.error : 'Host rejected the join')
  }
}

/** Fetch a remote member's data endpoint. */
export const fetchMemberData = async (dataEndpointUrl: string): Promise<ChallengeDataResponse> => {
  const res = await axios.get(dataEndpointUrl, { timeout: HTTP_TIMEOUT_MS })
  return challengeDataResponseSchema.parse(res.data)
}

export interface JoinRemoteDeps {
  user: string
  challengeUrl: string
  parsed: ParsedChallengeUrl
  ourWebHost: string
  ourApiBase: string
}

/**
 * Join a challenge hosted on another instance: discover host, fetch spec, create
 * a local participation + data endpoint, and register back. Returns the
 * participation (its `data_token` backs `/challenge-data/:token`).
 */
export const joinRemoteChallenge = async ({
  user,
  challengeUrl,
  parsed,
  ourWebHost,
  ourApiBase,
}: JoinRemoteDeps): Promise<ChallengeParticipationRecord> => {
  const wellKnown = await discoverInstance(parsed.base)
  const spec = await fetchChallengeSpec(wellKnown.api_base, parsed.username, parsed.slug)

  const participation = await createChallengeParticipation(user, {
    challenge_url: challengeUrl,
    end_ts: new Date(spec.end_ts),
    host_identity: spec.host_identity,
    name: spec.name,
    spec: {
      activity_type_id: spec.spec.activity_type_id ?? null,
      aggregation: spec.spec.aggregation,
      bucket_size: spec.spec.bucket_size,
      pattern: spec.spec.pattern ?? null,
      source_type: spec.spec.source_type,
      unit: spec.spec.unit,
    },
    start_ts: new Date(spec.start_ts),
    timezone: spec.timezone,
  })

  try {
    await registerMemberWithHost(wellKnown.api_base, parsed.username, parsed.slug, {
      data_endpoint_url: joinUrl(
        ourApiBase,
        `challenge-data/${encodeURIComponent(user)}/${participation.data_token}`,
      ),
      display_name: user,
      identity_base_url: buildProfileUrl(ourWebHost, user),
      join_token: spec.join_token,
    })
  } catch (error) {
    // Roll back the local participation if the host wouldn't accept us.
    await deleteChallengeParticipation(user, participation.id).catch(() => {})
    throw error
  }

  return participation
}

export interface JoinChallengeDeps {
  user: string
  challengeUrl: string
  webHost: string
  apiBaseUrl: string
}

/**
 * Join a challenge by URL. If the host is this instance, join directly (no
 * HTTP); otherwise federate. Always records a local participation so the
 * challenge shows in the joiner's "my challenges".
 */
export const joinChallenge = async ({
  user,
  challengeUrl,
  webHost,
  apiBaseUrl,
}: JoinChallengeDeps): Promise<ChallengeParticipationRecord> => {
  const parsed = parseChallengeUrl(challengeUrl)
  if (!parsed) throw new JoinChallengeError('Not a valid challenge URL', 'invalid_url')

  // Local shortcut: the host is this instance.
  if (parsed.base === trimSlashes(webHost)) {
    const challenge = await getChallengeBySlug(parsed.username, parsed.slug).catch(() => null)
    if (!challenge) throw new JoinChallengeError('Challenge not found', 'not_found')
    await upsertChallengeMember(parsed.username, challenge.id, {
      display_name: user,
      identity_base_url: buildProfileUrl(webHost, user),
      kind: 'local',
      local_user: user,
    })
    return createChallengeParticipation(user, {
      challenge_url: buildShareUrl(webHost, parsed.username, parsed.slug),
      end_ts: challenge.end_ts,
      host_identity: buildProfileUrl(webHost, parsed.username),
      name: challenge.name,
      spec: challenge.spec,
      start_ts: challenge.start_ts,
      timezone: challenge.timezone,
    })
  }

  try {
    return await joinRemoteChallenge({
      challengeUrl,
      ourApiBase: apiBaseUrl,
      ourWebHost: webHost,
      parsed,
      user,
    })
  } catch (error) {
    throw new JoinChallengeError(
      error instanceof Error ? error.message : 'Failed to join challenge',
      'federation',
    )
  }
}
