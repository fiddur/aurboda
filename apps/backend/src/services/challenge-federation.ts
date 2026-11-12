/**
 * The first real cross-instance traffic in Aurboda. A joining instance fetches
 * the challenge spec from the host, creates a local participation backing a
 * capability data endpoint, and registers itself back to the host. The host
 * later pulls each remote member's data endpoint to build standings.
 *
 * Trust model: a member's instance is trusted to report honest numbers
 * (Strava-style). Capability tokens + the unguessable slug are the only gates.
 */
import {
  activityMeasures,
  type ChallengeDataResponse,
  challengeDataResponseSchema,
  type ChallengePreview,
  type PublicChallenge,
  publicChallengeResponseSchema,
  type QuantChallengeDocument,
  quantChallengeDocumentSchema,
  type QuantChallengeEntry,
  quantChallengeEntrySchema,
  type QuantChallengeJoinBody,
  wellKnownAurbodaSchema,
  wellKnownQuantpubSchema,
} from '@aurboda/api-spec'
import { isAxiosError } from 'axios'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  type ChallengeParticipationRecord,
  type ChallengeSpecFields,
  createChallengeParticipation,
  deleteChallengeParticipation,
  getChallengeBySlug,
  getChallengeMemberByIdentity,
  getLeftChallengeToken,
  getParticipationById,
  getParticipationByUrl,
  removeChallengeMember,
  upsertChallengeMember,
} from '../db/index.ts'
import { normalizeWellKnownQuantpub, wireMetricToMetricType } from './activitypub/quant-wire.ts'
import { entryToMemberData, quantMetricForSpec } from './challenge-quantpub.ts'
import { specToApi, toSpecFields, unsupportedMeasureMessage } from './challenge-spec.ts'
import { isTransientFetchError, safeFetchDelete, safeFetchGet, safeFetchPost } from './safe-fetch.ts'
import { buildActorUrl, buildProfileUrl } from './share-urls.ts'

/** Upper bound on members a challenge accepts through unauthenticated HTTP joins. */
export const MAX_CHALLENGE_MEMBERS = 200

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

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')
const joinUrl = (base: string, path: string): string => `${trimSlashes(base)}/${path.replace(/^\/+/, '')}`

/**
 * The one spelling of a public challenge link we store and compare by: no query
 * string or fragment (a pasted `?embed=1` link is the same challenge), no
 * trailing slashes, scheme and host lowercased, default port dropped. Null for
 * anything that isn't an http(s) URL.
 *
 * Everything that keys off a challenge URL — the joined-participation row, the
 * left-tombstone, discovery's "already mine" set — runs through this, so the
 * same challenge pasted two ways is still one challenge. Rows written before
 * this existed are not migrated; readers canonicalise what they load.
 */
export const canonicalChallengeUrl = (url: string): string | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  parsed.search = ''
  parsed.hash = ''
  return trimSlashes(parsed.toString())
}

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

/**
 * How a host speaks challenges: the QuantPub Challenges shape, or Aurboda's
 * older vendor protocol for instances that predate it.
 */
export interface ChallengeHost {
  kind: 'quantpub' | 'aurboda'
  apiBase: string
}

const discoverAurboda = async (base: string): Promise<ChallengeHost> => {
  const res = await safeFetchGet(joinUrl(base, '.well-known/aurboda'))
  const wellKnown = wellKnownAurbodaSchema.parse(res.data)
  if (wellKnown.product !== 'aurboda' || !wellKnown.federation) {
    throw new Error('Host does not support Aurboda federation')
  }
  return { apiBase: wellKnown.api_base, kind: 'aurboda' }
}

/**
 * Prefer `/.well-known/quantpub` with `challenges: true`; anything else short
 * of a transient failure (a 404, another document, no flag) falls back to
 * `/.well-known/aurboda`. A transient failure is rethrown so callers that
 * cache a verdict do not remember "not a challenge host" for a hiccup.
 */
export const discoverInstance = async (base: string): Promise<ChallengeHost> => {
  try {
    const res = await safeFetchGet(joinUrl(base, '.well-known/quantpub'))
    const parsed = wellKnownQuantpubSchema.safeParse(normalizeWellKnownQuantpub(res.data))
    if (parsed.success && parsed.data.challenges === true) {
      return { apiBase: parsed.data.apiBase, kind: 'quantpub' }
    }
  } catch (error) {
    if (isTransientFetchError(error)) throw error
  }
  return discoverAurboda(base)
}

const rawSpecMeasure = (data: unknown): unknown =>
  (data as { challenge?: { spec?: { measure?: unknown } } } | null)?.challenge?.spec?.measure

/**
 * A host's public resolver answer as a challenge. A measure this instance does not know fails the
 * schema like any malformed answer would, so it is named before parsing: the join is refused
 * because this instance cannot score the challenge, not because the link is wrong.
 */
export const parsePublicChallenge = (data: unknown): PublicChallenge => {
  const measure = rawSpecMeasure(data)
  if (measure !== undefined && !(activityMeasures as readonly unknown[]).includes(measure)) {
    throw new JoinChallengeError(unsupportedMeasureMessage(String(measure)), 'federation')
  }
  const parsed = publicChallengeResponseSchema.safeParse(data)
  if (!parsed.success || parsed.data.type !== 'challenge' || !parsed.data.challenge) {
    throw new Error('URL is not an Aurboda challenge')
  }
  return parsed.data.challenge
}

/** Fetch a challenge spec from a host's public resolver; throws if not a challenge. */
export const fetchChallengeSpec = async (
  apiBase: string,
  username: string,
  slug: string,
): Promise<PublicChallenge> => {
  const res = await safeFetchGet(
    joinUrl(apiBase, `public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}`),
  )
  return parsePublicChallenge(res.data)
}

/**
 * The host signals rejection with a non-2xx status (axios throws). Surface the
 * host's own message (e.g. "Challenge is full") rather than a generic status.
 */
const hostRejection = (error: unknown): unknown => {
  if (!isAxiosError(error)) return error
  const hostError = (error.response?.data as { error?: unknown } | undefined)?.error
  return new Error(typeof hostError === 'string' ? hostError : 'Host rejected the join')
}

export const registerMemberWithHost = async (
  apiBase: string,
  username: string,
  slug: string,
  body: { identity_base_url: string; display_name: string; data_endpoint_url: string; join_token: string },
): Promise<void> => {
  try {
    await safeFetchPost(
      joinUrl(apiBase, `public/${encodeURIComponent(username)}/${encodeURIComponent(slug)}/members`),
      body,
    )
  } catch (error) {
    throw hostRejection(error)
  }
}

const isEntryDocument = (data: unknown): boolean =>
  typeof data === 'object' && data !== null && (data as { kind?: unknown }).kind === 'challengeEntry'

/** Fetch a member's QuantPub entry (SSRF-guarded); throws unless it is one. */
export const fetchChallengeEntry = async (entryUrl: string): Promise<QuantChallengeEntry> => {
  const res = await safeFetchGet(entryUrl)
  return quantChallengeEntrySchema.parse(res.data)
}

/**
 * Fetch a remote member's data (SSRF-guarded), in either shape: a QuantPub
 * entry is converted to the data response standings are built from, using the
 * challenge's metric factor and window start.
 */
export const fetchMemberData = async (
  dataEndpointUrl: string,
  challenge: { spec: ChallengeSpecFields; start_ts: Date },
): Promise<ChallengeDataResponse> => {
  const res = await safeFetchGet(dataEndpointUrl)
  if (isEntryDocument(res.data)) {
    return entryToMemberData(quantChallengeEntrySchema.parse(res.data), challenge)
  }
  return challengeDataResponseSchema.parse(res.data)
}

const rawDocumentSpecMeasure = (data: unknown): unknown =>
  (data as { aurboda?: { spec?: { measure?: unknown } } } | null)?.aurboda?.spec?.measure

/**
 * The spec an Aurboda member scores a QuantPub challenge with: the host's
 * exact spec when it sent the vendor block, else one synthesised from a bare
 * RECOMMENDED metric key. Anything else cannot be scored here.
 */
export const specFromChallengeDocument = (doc: QuantChallengeDocument): ChallengeSpecFields => {
  if (doc.aurboda) return toSpecFields(doc.aurboda.spec)
  const pattern = wireMetricToMetricType(doc.metric)
  const cannotScore = new JoinChallengeError(`This instance cannot score ${doc.metric}`, 'federation')
  if (pattern === null || doc.scoring === 'max') throw cannotScore
  const published = quantMetricForSpec({ measure: null, pattern, source_type: 'metric', unit: '' })
  if (published.key !== doc.metric) throw cannotScore
  return {
    activity_type_id: null,
    aggregation: doc.scoring,
    bucket_size: 'auto',
    filter_field: null,
    filter_value: null,
    measure: null,
    pattern,
    source_type: 'metric',
    unit: doc.unit ?? published.unit,
  }
}

/** A host's QuantPub challenge document; a measure this instance does not know is named, as in `parsePublicChallenge`. */
export const parseChallengeDocument = (data: unknown): QuantChallengeDocument => {
  const measure = rawDocumentSpecMeasure(data)
  if (measure !== undefined && !(activityMeasures as readonly unknown[]).includes(measure)) {
    throw new JoinChallengeError(unsupportedMeasureMessage(String(measure)), 'federation')
  }
  const parsed = quantChallengeDocumentSchema.safeParse(data)
  if (!parsed.success) throw new Error('URL is not a QuantPub challenge')
  return parsed.data
}

const quantChallengePath = (username: string, slug: string, rest = ''): string =>
  `public/${encodeURIComponent(username)}/challenges/${encodeURIComponent(slug)}${rest}`

export const fetchChallengeDocument = async (
  apiBase: string,
  username: string,
  slug: string,
): Promise<QuantChallengeDocument> => {
  const res = await safeFetchGet(joinUrl(apiBase, quantChallengePath(username, slug)))
  return parseChallengeDocument(res.data)
}

export const joinQuantChallenge = async (
  apiBase: string,
  username: string,
  slug: string,
  body: QuantChallengeJoinBody,
): Promise<void> => {
  try {
    await safeFetchPost(joinUrl(apiBase, quantChallengePath(username, slug, '/members')), body)
  } catch (error) {
    throw hostRejection(error)
  }
}

/** The URL a member serves its entry for one participation at. */
export const buildEntryUrl = (apiBase: string, user: string, dataToken: string): string =>
  joinUrl(apiBase, `public/${encodeURIComponent(user)}/challenge-entries/${dataToken}`)

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
 * participation (its `data_token` backs the member's entry or data endpoint).
 */
export const joinRemoteChallenge = async (deps: JoinRemoteDeps): Promise<ChallengeParticipationRecord> => {
  const host = await discoverInstance(deps.parsed.base)
  return host.kind === 'quantpub' ? joinQuantpubHost(deps, host.apiBase) : joinAurbodaHost(deps, host.apiBase)
}

/**
 * Create the local participation, register it with `register`, and roll the
 * participation back if the host would not take us. That is a failed join, not
 * a leave: no tombstone, or discovery would stop offering a challenge the user
 * never got into.
 */
const createAndRegister = async (
  user: string,
  input: Parameters<typeof createChallengeParticipation>[1],
  register: (participation: ChallengeParticipationRecord) => Promise<void>,
): Promise<ChallengeParticipationRecord> => {
  const participation = await createChallengeParticipation(user, input)
  try {
    await register(participation)
  } catch (error) {
    await deleteChallengeParticipation(user, participation.id, { tombstone: false }).catch(() => {})
    throw error
  }
  return participation
}

const joinQuantpubHost = async (
  { challengeUrl, ourApiBase, ourWebHost, parsed, user }: JoinRemoteDeps,
  apiBase: string,
): Promise<ChallengeParticipationRecord> => {
  const doc = await fetchChallengeDocument(apiBase, parsed.username, parsed.slug)
  const spec = specFromChallengeDocument(doc)
  if (!doc.joinToken) throw new Error('The host did not offer a join token')
  const joinToken = doc.joinToken
  // Read before createAndRegister: creating the participation clears the tombstone.
  const leftToken = await getLeftChallengeToken(user, challengeUrl)
  return createAndRegister(
    user,
    {
      challenge_url: challengeUrl,
      end_ts: new Date(doc.endTime),
      host_identity: doc.host.url,
      name: doc.name,
      protocol: 'quantpub',
      spec,
      start_ts: new Date(doc.startTime),
      timezone: doc.timezone,
    },
    (participation) =>
      joinQuantChallenge(apiBase, parsed.username, parsed.slug, {
        actor: buildActorUrl(ourWebHost, user),
        ...(leftToken === null ? {} : { currentEntryUrl: buildEntryUrl(ourApiBase, user, leftToken) }),
        entryUrl: buildEntryUrl(ourApiBase, user, participation.data_token),
        joinToken,
        name: user,
        url: buildProfileUrl(ourWebHost, user),
      }),
  )
}

const joinAurbodaHost = async (
  { challengeUrl, ourApiBase, ourWebHost, parsed, user }: JoinRemoteDeps,
  apiBase: string,
): Promise<ChallengeParticipationRecord> => {
  const spec = await fetchChallengeSpec(apiBase, parsed.username, parsed.slug)
  return createAndRegister(
    user,
    {
      challenge_url: challengeUrl,
      end_ts: new Date(spec.end_ts),
      host_identity: spec.host_identity,
      name: spec.name,
      protocol: 'aurboda',
      spec: toSpecFields(spec.spec),
      start_ts: new Date(spec.start_ts),
      timezone: spec.timezone,
    },
    (participation) =>
      registerMemberWithHost(apiBase, parsed.username, parsed.slug, {
        data_endpoint_url: joinUrl(
          ourApiBase,
          `challenge-data/${encodeURIComponent(user)}/${participation.data_token}`,
        ),
        display_name: user,
        identity_base_url: buildProfileUrl(ourWebHost, user),
        join_token: spec.join_token,
      }),
  )
}

/**
 * Drop the leaver from the standings of a challenge this instance hosts. A
 * challenge or member that is already gone leaves nothing to do.
 */
export const leaveLocalChallenge = async (
  user: string,
  parsed: ParsedChallengeUrl,
  ctx: { webHost: string },
): Promise<void> => {
  if (!isValidUsername(parsed.username)) return
  const challenge = await getChallengeBySlug(parsed.username, parsed.slug)
  if (!challenge) return
  const member = await getChallengeMemberByIdentity(
    parsed.username,
    challenge.id,
    buildProfileUrl(ctx.webHost, user),
  )
  if (!member) return
  await removeChallengeMember(parsed.username, challenge.id, member.id)
}

/**
 * Tell a QuantPub host that a participation is leaving, by presenting its
 * entry URL. Best effort: an Aurboda-protocol host, a host that is down or one
 * that no longer knows the member is logged and otherwise ignored, so a leave
 * never waits on another instance's consent. A participation recorded as joined
 * over the Aurboda protocol has no leave to send; one from before the protocol
 * was recorded is discovered.
 */
export const leaveRemoteChallenge = async (
  user: string,
  participation: ChallengeParticipationRecord,
  ctx: { webHost: string; apiBaseUrl: string },
): Promise<void> => {
  if (participation.protocol === 'aurboda') return
  const canonical = canonicalChallengeUrl(participation.challenge_url)
  const parsed = canonical === null ? null : parseChallengeUrl(canonical)
  if (!parsed || parsed.base === trimSlashes(ctx.webHost)) return
  try {
    const host = await discoverInstance(parsed.base)
    if (host.kind !== 'quantpub') return
    await safeFetchDelete(
      joinUrl(host.apiBase, quantChallengePath(parsed.username, parsed.slug, '/members')),
      {
        entryUrl: buildEntryUrl(ctx.apiBaseUrl, user, participation.data_token),
      },
    )
  } catch (error) {
    console.warn(
      `⚠️ Challenge leave: could not tell ${participation.challenge_url}:`,
      error instanceof Error ? error.message : error,
    )
  }
}

/**
 * Leave a joined challenge: drop the member from a challenge this instance
 * hosts, or tell a QuantPub host (best effort), then delete the participation.
 */
export const leaveChallenge = async (
  user: string,
  participationId: string,
  ctx: { webHost: string; apiBaseUrl: string },
): Promise<boolean> => {
  const participation = await getParticipationById(user, participationId)
  if (!participation) return false
  const canonical = canonicalChallengeUrl(participation.challenge_url)
  const parsed = canonical === null ? null : parseChallengeUrl(canonical)
  if (parsed && parsed.base === trimSlashes(ctx.webHost)) {
    await leaveLocalChallenge(user, parsed, ctx)
  } else {
    await leaveRemoteChallenge(user, participation, ctx)
  }
  return deleteChallengeParticipation(user, participation.id)
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
  // Canonicalise before parsing: a pasted link may carry `?embed=1`, which
  // would otherwise end up glued to the slug.
  const normalizedUrl = canonicalChallengeUrl(challengeUrl)
  const parsed = normalizedUrl === null ? null : parseChallengeUrl(normalizedUrl)
  // Validate the username at this username→DB boundary, matching every other one.
  if (normalizedUrl === null || !parsed || !isValidUsername(parsed.username)) {
    throw new JoinChallengeError('Not a valid challenge URL', 'invalid_url')
  }

  // Idempotent: joining the same challenge again returns the existing record
  // instead of creating a duplicate participation (with a second data token).
  const existing = await getParticipationByUrl(user, normalizedUrl).catch(() => null)
  if (existing) return existing

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
      challenge_url: normalizedUrl,
      end_ts: challenge.end_ts,
      host_identity: buildProfileUrl(webHost, parsed.username),
      name: challenge.name,
      protocol: 'aurboda',
      spec: challenge.spec,
      start_ts: challenge.start_ts,
      timezone: challenge.timezone,
    })
  }

  try {
    return await joinRemoteChallenge({
      challengeUrl: normalizedUrl,
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

const hostHandle = (parsed: ParsedChallengeUrl): string => {
  try {
    return `@${parsed.username}@${new URL(parsed.base).host}`
  } catch {
    return `@${parsed.username}`
  }
}

const hostInstant = (value: string): string => {
  const ms = Date.parse(value)
  if (Number.isNaN(ms)) throw new Error('The host sent an unreadable challenge window')
  return new Date(ms).toISOString()
}

const fetchRemotePreview = async (
  parsed: ParsedChallengeUrl,
): Promise<Omit<ChallengePreview, 'host_handle' | 'share_url'>> => {
  const host = await discoverInstance(parsed.base)
  if (host.kind === 'quantpub') {
    const doc = await fetchChallengeDocument(host.apiBase, parsed.username, parsed.slug)
    return {
      end_ts: doc.endTime,
      host_identity: doc.host.url,
      name: doc.name,
      spec: specToApi(specFromChallengeDocument(doc)),
      start_ts: doc.startTime,
      timezone: doc.timezone,
    }
  }
  const challenge = await fetchChallengeSpec(host.apiBase, parsed.username, parsed.slug)
  return {
    end_ts: challenge.end_ts,
    host_identity: challenge.host_identity,
    name: challenge.name,
    spec: challenge.spec,
    start_ts: challenge.start_ts,
    timezone: challenge.timezone,
  }
}

const previewRemote = async (
  parsed: ParsedChallengeUrl,
): Promise<Omit<ChallengePreview, 'host_handle' | 'share_url'>> => {
  const preview = await fetchRemotePreview(parsed)
  return { ...preview, end_ts: hostInstant(preview.end_ts), start_ts: hostInstant(preview.start_ts) }
}

/**
 * What `joinChallenge` would join, read the same way (in-process for this
 * instance, else from the host) but without joining: the confirm step before a
 * join the user did not click on the host's page. Fails like a join would.
 */
export const previewChallenge = async ({
  challengeUrl,
  webHost,
}: {
  challengeUrl: string
  webHost: string
}): Promise<ChallengePreview> => {
  const normalizedUrl = canonicalChallengeUrl(challengeUrl)
  const parsed = normalizedUrl === null ? null : parseChallengeUrl(normalizedUrl)
  if (normalizedUrl === null || !parsed || !isValidUsername(parsed.username)) {
    throw new JoinChallengeError('Not a valid challenge URL', 'invalid_url')
  }
  const identity = { host_handle: hostHandle(parsed), share_url: normalizedUrl }

  if (parsed.base === trimSlashes(webHost)) {
    const challenge = await getChallengeBySlug(parsed.username, parsed.slug).catch(() => null)
    if (!challenge) throw new JoinChallengeError('Challenge not found', 'not_found')
    return {
      ...identity,
      end_ts: challenge.end_ts.toISOString(),
      host_identity: buildProfileUrl(webHost, parsed.username),
      name: challenge.name,
      spec: specToApi(challenge.spec),
      start_ts: challenge.start_ts.toISOString(),
      timezone: challenge.timezone,
    }
  }

  try {
    return { ...identity, ...(await previewRemote(parsed)) }
  } catch (error) {
    throw new JoinChallengeError(
      error instanceof Error ? error.message : 'Failed to read the challenge',
      'federation',
    )
  }
}
