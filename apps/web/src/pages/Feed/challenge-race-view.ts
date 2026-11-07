/**
 * What the shared challenge race card (`ChallengeRace`) draws — the spec line,
 * the cumulative race, the leaderboard rows and the live-page link — built from
 * either source a challenge reaches the feed in: a structured payload (a
 * challenge-share post, or an article's resolved challenge block) or, for an
 * article's live render, the public challenge and its standings as the
 * challenge page fetches them. DOM-free so it runs under the Node test runner.
 */
import type {
  ChallengeStanding,
  FeedStructuredChallenge,
  PublicChallenge,
  QuantChallengeDocument,
  QuantStandings,
} from '@aurboda/api-spec'

import type { LineSeriesData } from '../../components/charts/TrendLineChart'

import { competitionRanks } from '../../utils/podium'
import { memberColor } from '../Challenges/member-colors'
import { toCumulativeSeries } from '../Challenges/race-series'
import { describeSpec, formatTotal, totalHeader } from '../Challenges/spec-label'
import { challengeLink, formatStandingTotal, standingsRaceSeries } from './timeline-challenge'

export interface ChallengeRaceRow {
  key: string
  rank: number
  name: string
  total: string
  stale: boolean
}

export interface ChallengeRaceView {
  name: string
  /** The challenge page (where to join), when it is an http(s) URL. */
  link: string | null
  specLabel: string
  totalHeader: string
  series: LineSeriesData[]
  xDomain: [Date, Date]
  rows: ChallengeRaceRow[]
  /** When a snapshot was taken; absent for live standings. */
  asOf?: string
}

/** `end` is the exclusive window end: step back one ms so the axis ends on the last competing day. */
const raceDomain = (start: string, end: string): [Date, Date] => [
  new Date(start),
  new Date(new Date(end).getTime() - 1),
]

/** The race card for a structured challenge payload (a share post or a resolved article block). */
export const structuredRaceView = (structured: FeedStructuredChallenge): ChallengeRaceView => {
  const { challenge, standings } = structured
  const spec = challenge.aurboda?.spec
  return {
    link: challengeLink(challenge.url),
    name: challenge.name,
    rows: (standings?.members ?? []).map((member) => ({
      key: member.url,
      name: member.name,
      rank: member.rank,
      stale: member.stale,
      total: formatStandingTotal(structured, member.total),
    })),
    series: standingsRaceSeries(structured),
    specLabel: spec ? describeSpec(spec) : `${challenge.metric} · ${challenge.scoring}`,
    totalHeader: spec ? totalHeader(spec) : 'Total',
    xDomain: raceDomain(challenge.startTime, challenge.endTime),
    ...(standings ? { asOf: standings.asOf } : {}),
  }
}

/** A resolved article challenge block's challenge as the structured payload `structuredRaceView` takes. */
export const asStructuredChallenge = (
  challenge: QuantChallengeDocument,
  standings: QuantStandings | undefined,
): FeedStructuredChallenge => ({ challenge, kind: 'challenge', ...(standings ? { standings } : {}) })

/** The race card for a challenge hosted here, from its public page data and live standings. */
export const liveRaceView = (
  challenge: PublicChallenge,
  standings: ChallengeStanding[],
): ChallengeRaceView => {
  const active = standings.filter((s) => s.status === 'active')
  const ranks = competitionRanks(active.map((s) => s.total))
  const { spec } = challenge
  return {
    link: challengeLink(challenge.share_url),
    name: challenge.name,
    rows: active.map((s, i) => ({
      key: s.identity_base_url,
      name: s.display_name,
      rank: ranks[i],
      stale: s.stale,
      total: formatTotal(spec, s.total),
    })),
    series: active
      .map((s, i) =>
        toCumulativeSeries(
          s,
          memberColor(i),
          challenge.start_ts,
          challenge.effective_bucket_size ?? '1d',
          spec.aggregation,
        ),
      )
      .filter((s) => s.data.length > 1),
    specLabel: describeSpec(spec),
    totalHeader: totalHeader(spec),
    xDomain: raceDomain(challenge.start_ts, challenge.end_ts),
  }
}

/** A challenge URL on this instance (`origin`), as the user and slug its public endpoints take; null otherwise. */
export const localChallengeRef = (url: string, origin: string): { username: string; slug: string } | null => {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (parsed.origin !== origin) return null
  const match = /^\/u\/([^/]+)\/([^/]+)\/?$/.exec(parsed.pathname)
  if (!match) return null
  try {
    return { slug: decodeURIComponent(match[2]), username: decodeURIComponent(match[1]) }
  } catch {
    return null
  }
}

/** The host a challenge link points at, for a link card's "Challenge on <host>". */
export const challengeHost = (url: string): string | null => {
  try {
    return new URL(url).host
  } catch {
    return null
  }
}
