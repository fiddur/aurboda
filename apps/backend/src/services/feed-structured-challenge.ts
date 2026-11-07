/**
 * The structured payload of a challenge-share post (#994): the challenge as a
 * QuantPub Challenges document plus a standings snapshot, so a following
 * Aurboda instance can render the race natively instead of the flat Note.
 *
 * The challenge is resolved from the post's stored link (`resolveChallengeByUrl`,
 * which an article's challenge block shares): a challenge hosted here by
 * parsing its URL back to a user and slug, a joined one through the
 * participation row. A joined challenge's standings live on its host, so they
 * are fetched (QuantPub hosts only) and omitted on any failure: the card then
 * still shows the invitation.
 */
import type { FeedStructuredChallenge, QuantChallengeDocument, QuantStandings } from '@aurboda/api-spec'

import { quantStandingsSchema } from '@aurboda/api-spec'

import type { ChallengeParticipationRecord, FeedPostRecord } from '../db/index.ts'

import { isValidUsername } from '../api/auth-routes.ts'
import {
  getChallengeBySlug,
  getParticipationByUrl,
  isMissingDatabase,
  listChallengeMembers,
} from '../db/index.ts'
import {
  type ChallengeHost,
  discoverInstance,
  fetchChallengeDocument,
  type ParsedChallengeUrl,
  parseChallengeUrl,
} from './challenge-federation.ts'
import {
  buildChallengeListItem,
  buildStandingsDocument,
  type HostContext,
  quantMetricForSpec,
  toQuantBucket,
} from './challenge-quantpub.ts'
import { effectiveBucketSize, specToApi } from './challenge-spec.ts'
import { getChallengeStandings } from './challenge-standings.ts'
import { raceChartDataFor, type RaceChartSvgData } from './charts/race-chart-svg.ts'
import { safeFetchGet } from './safe-fetch.ts'
import { withTimeout } from './with-timeout.ts'

const REMOTE_STANDINGS_TIMEOUT_MS = 8_000

export interface StructuredChallengeDeps {
  webHost: string | undefined
  apiBaseUrl: string
  now: () => Date
  getChallengeBySlug: typeof getChallengeBySlug
  listChallengeMembers: typeof listChallengeMembers
  getChallengeStandings: typeof getChallengeStandings
  getParticipationByUrl: typeof getParticipationByUrl
  discoverInstance: (base: string) => Promise<ChallengeHost>
  fetchChallengeDocument: (apiBase: string, username: string, slug: string) => Promise<QuantChallengeDocument>
  fetchStandings: (url: string) => Promise<unknown>
}

export type StructuredChallengePost = Pick<FeedPostRecord, 'challenge' | 'kind' | 'message'>

const trimSlashes = (s: string): string => s.replace(/\/+$/, '')

const safeDecode = (s: string): string => {
  try {
    return decodeURIComponent(s)
  } catch {
    return s
  }
}

const participationDocument = (
  participation: ChallengeParticipationRecord,
  parsed: ParsedChallengeUrl | null,
  now: Date,
): QuantChallengeDocument => {
  const { key, unit } = quantMetricForSpec(participation.spec)
  const hostName = parsed ? safeDecode(parsed.username) : participation.host_identity
  return {
    aurboda: { spec: specToApi(participation.spec) },
    bucket: toQuantBucket(
      effectiveBucketSize(participation.spec.bucket_size, participation.start_ts, participation.end_ts),
    ),
    endTime: participation.end_ts.toISOString(),
    host: {
      actor: null,
      name: hostName,
      url: parsed ? `${parsed.base}/u/${parsed.username}` : participation.challenge_url,
    },
    joinMode: participation.end_ts.getTime() <= now.getTime() ? 'none' : 'free',
    kind: 'challenge',
    metric: key,
    name: participation.name,
    scoring: participation.spec.aggregation,
    startTime: participation.start_ts.toISOString(),
    timezone: participation.timezone,
    unit,
    url: participation.challenge_url,
  }
}

const fetchRemoteStandings = async (
  parsed: ParsedChallengeUrl,
  deps: StructuredChallengeDeps,
): Promise<QuantStandings | undefined> => {
  const host = await deps.discoverInstance(parsed.base)
  if (host.kind !== 'quantpub') return undefined
  const doc = await deps.fetchChallengeDocument(
    host.apiBase,
    safeDecode(parsed.username),
    safeDecode(parsed.slug),
  )
  if (!doc.standingsUrl) return undefined
  const result = quantStandingsSchema.safeParse(await deps.fetchStandings(doc.standingsUrl))
  return result.success ? result.data : undefined
}

const remoteStandingsOrNothing = async (
  parsed: ParsedChallengeUrl | null,
  deps: StructuredChallengeDeps,
): Promise<QuantStandings | undefined> => {
  if (parsed == null) return undefined
  try {
    return await withTimeout(fetchRemoteStandings(parsed, deps), REMOTE_STANDINGS_TIMEOUT_MS)
  } catch (error) {
    console.warn(
      `Could not read standings for joined challenge at ${parsed.base}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return undefined
  }
}

/** A challenge resolved from its public URL: its document and, when readable, a standings snapshot. */
export interface ResolvedChallenge {
  challenge: QuantChallengeDocument
  standings?: QuantStandings
}

const localChallenge = async (
  owner: string,
  slug: string,
  deps: StructuredChallengeDeps,
  webHost: string,
  now: Date,
): Promise<ResolvedChallenge | null> => {
  const record = await deps.getChallengeBySlug(owner, slug)
  if (record == null) return null
  const ctx: HostContext = { apiBaseUrl: deps.apiBaseUrl, now, username: owner, webHost }
  const [memberStandings, members] = await Promise.all([
    deps.getChallengeStandings(owner, record),
    deps.listChallengeMembers(owner, record.id),
  ])
  return {
    challenge: buildChallengeListItem(record, ctx),
    standings: buildStandingsDocument(record, memberStandings, members, ctx),
  }
}

/** Another local user's challenge; an unknown user (no database) has none. */
const otherLocalChallenge = async (
  owner: string,
  slug: string,
  deps: StructuredChallengeDeps,
  webHost: string,
  now: Date,
): Promise<ResolvedChallenge | null> => {
  if (!isValidUsername(owner)) return null
  try {
    return await localChallenge(owner, slug, deps, webHost, now)
  } catch (error) {
    if (isMissingDatabase(error)) return null
    throw error
  }
}

/** The host's public document, without the join capability and member list a listing never carries. */
const publicDocument = (doc: QuantChallengeDocument): QuantChallengeDocument => {
  const listed = { ...doc }
  delete listed.joinToken
  delete listed.members
  return listed
}

const fetchRemoteChallenge = async (
  parsed: ParsedChallengeUrl,
  deps: StructuredChallengeDeps,
): Promise<ResolvedChallenge | null> => {
  const host = await deps.discoverInstance(parsed.base)
  if (host.kind !== 'quantpub') return null
  const doc = await deps.fetchChallengeDocument(
    host.apiBase,
    safeDecode(parsed.username),
    safeDecode(parsed.slug),
  )
  const challenge = publicDocument(doc)
  if (!doc.standingsUrl) return { challenge }
  const result = quantStandingsSchema.safeParse(await deps.fetchStandings(doc.standingsUrl))
  return result.success ? { challenge, standings: result.data } : { challenge }
}

const remoteChallengeOrNothing = async (
  parsed: ParsedChallengeUrl | null,
  deps: StructuredChallengeDeps,
): Promise<ResolvedChallenge | null> => {
  if (parsed == null) return null
  try {
    return await withTimeout(fetchRemoteChallenge(parsed, deps), REMOTE_STANDINGS_TIMEOUT_MS)
  } catch (error) {
    console.warn(
      `Could not read challenge at ${parsed.base}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return null
  }
}

/**
 * Resolve a public challenge URL as `user` sees it: a challenge hosted here
 * (the user's own or another local user's) from the database with live
 * standings; a remote one the user joined through the participation row (and
 * the host's standings, best-effort); any other remote one by fetching the
 * host's QuantPub document and standings, null on any failure.
 *
 * `joinedOnly` keeps a challenge-share post to what it has always resolved: its
 * author's own challenge or a participation, never another user's or a fetch of
 * one the author is not in.
 */
export const resolveChallengeByUrl = async (
  user: string,
  url: string,
  deps: StructuredChallengeDeps,
  { joinedOnly = false }: { joinedOnly?: boolean } = {},
): Promise<ResolvedChallenge | null> => {
  const parsed = parseChallengeUrl(url)
  const now = deps.now()
  const { webHost } = deps
  if (webHost != null && parsed != null && parsed.base === trimSlashes(webHost)) {
    const owner = safeDecode(parsed.username)
    const slug = safeDecode(parsed.slug)
    if (owner === user) return localChallenge(user, slug, deps, webHost, now)
    if (!joinedOnly) return otherLocalChallenge(owner, slug, deps, webHost, now)
  }
  const participation = await deps.getParticipationByUrl(user, url)
  if (participation == null) return joinedOnly ? null : remoteChallengeOrNothing(parsed, deps)
  const standings = await remoteStandingsOrNothing(parsed, deps)
  return {
    challenge: participationDocument(participation, parsed, now),
    ...(standings != null ? { standings } : {}),
  }
}

export const resolveStructuredChallenge = async (
  user: string,
  post: StructuredChallengePost,
  deps: StructuredChallengeDeps,
): Promise<FeedStructuredChallenge | null> => {
  if (post.kind !== 'challenge' || post.challenge == null) return null
  const share = post.challenge
  const resolved = await resolveChallengeByUrl(user, share.url, deps, { joinedOnly: true })
  if (resolved == null) return null

  return {
    challenge: resolved.challenge,
    kind: 'challenge',
    ...(post.message != null ? { message: post.message } : {}),
    ...(share.result != null ? { result: share.result } : {}),
    ...(resolved.standings != null ? { standings: resolved.standings } : {}),
  }
}

let configured: StructuredChallengeDeps | null = null

/**
 * The standings race chart a challenge post's `Standings` attachment draws, or
 * null when there is nothing to draw: resolver unconfigured, the challenge
 * unresolvable, or no standings snapshot.
 */
export const resolveStandingsChart = async (
  user: string,
  post: StructuredChallengePost,
  deps: StructuredChallengeDeps | null = configured,
): Promise<RaceChartSvgData | null> => {
  if (deps == null) return null
  const structured = await resolveStructuredChallenge(user, post, deps)
  return structured == null ? null : raceChartDataFor(structured)
}

/**
 * The standings race chart of the challenge at `url` (an article's challenge
 * block), or null when there is nothing to draw: resolver unconfigured, the
 * challenge unresolvable, or no standings.
 */
export const resolveChallengeRaceByUrl = async (
  user: string,
  url: string,
  deps: StructuredChallengeDeps | null = configured,
): Promise<RaceChartSvgData | null> => {
  if (deps == null) return null
  const resolved = await resolveChallengeByUrl(user, url, deps)
  return resolved == null ? null : raceChartDataFor({ ...resolved, kind: 'challenge' })
}

/**
 * Wire the real dependencies once at startup. Until this runs (unit tests,
 * scripts) every challenge post resolves to no structured payload.
 */
export const configureStructuredChallenge = ({
  apiBaseUrl,
  webHost,
}: {
  apiBaseUrl: string
  webHost: string | undefined
}): void => {
  configured = {
    apiBaseUrl,
    discoverInstance,
    fetchChallengeDocument,
    fetchStandings: async (url) => (await safeFetchGet(url)).data,
    getChallengeBySlug,
    getChallengeStandings,
    getParticipationByUrl,
    listChallengeMembers,
    now: () => new Date(),
    webHost,
  }
}

export const configuredStructuredChallengeDeps = (): StructuredChallengeDeps | null => configured
