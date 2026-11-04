/**
 * The structured payload of a challenge-share post (#994): the challenge as a
 * QuantPub Challenges document plus a standings snapshot, so a following
 * Aurboda instance can render the race natively instead of the flat Note.
 *
 * The challenge is resolved from the post's stored link: an own challenge by
 * parsing its share URL back to a slug, a joined one through the
 * participation row. A joined challenge's standings live on its host, so they
 * are fetched (QuantPub hosts only) and omitted on any failure: the card then
 * still shows the invitation.
 */
import type { FeedStructuredChallenge, QuantChallengeDocument, QuantStandings } from '@aurboda/api-spec'

import { quantStandingsSchema } from '@aurboda/api-spec'

import type { ChallengeParticipationRecord, FeedPostRecord } from '../db/index.ts'

import { getChallengeBySlug, getParticipationByUrl, listChallengeMembers } from '../db/index.ts'
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

const isOwnChallengeUrl = (
  parsed: ParsedChallengeUrl | null,
  user: string,
  webHost: string,
): parsed is ParsedChallengeUrl =>
  parsed != null && parsed.base === trimSlashes(webHost) && safeDecode(parsed.username) === user

export const resolveStructuredChallenge = async (
  user: string,
  post: StructuredChallengePost,
  deps: StructuredChallengeDeps,
): Promise<FeedStructuredChallenge | null> => {
  if (post.kind !== 'challenge' || post.challenge == null) return null
  const share = post.challenge
  const parsed = parseChallengeUrl(share.url)
  const now = deps.now()
  const { webHost } = deps

  let challenge: QuantChallengeDocument
  let standings: QuantStandings | undefined
  if (webHost != null && isOwnChallengeUrl(parsed, user, webHost)) {
    const record = await deps.getChallengeBySlug(user, safeDecode(parsed.slug))
    if (record == null) return null
    const ctx: HostContext = { apiBaseUrl: deps.apiBaseUrl, now, username: user, webHost }
    const [memberStandings, members] = await Promise.all([
      deps.getChallengeStandings(user, record),
      deps.listChallengeMembers(user, record.id),
    ])
    challenge = buildChallengeListItem(record, ctx)
    standings = buildStandingsDocument(record, memberStandings, members, ctx)
  } else {
    const participation = await deps.getParticipationByUrl(user, share.url)
    if (participation == null) return null
    challenge = participationDocument(participation, parsed, now)
    standings = await remoteStandingsOrNothing(parsed, deps)
  }

  return {
    challenge,
    kind: 'challenge',
    ...(post.message != null ? { message: post.message } : {}),
    ...(share.result != null ? { result: share.result } : {}),
    ...(standings != null ? { standings } : {}),
  }
}

let configured: StructuredChallengeDeps | null = null

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
