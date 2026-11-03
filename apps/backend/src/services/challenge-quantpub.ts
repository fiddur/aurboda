/**
 * The QuantPub Challenges wire boundary (`docs/fep/quantpub-challenges.md`):
 * Aurboda's challenge records, member series and standings converted to and
 * from the challenge document, the member entry and the standings document.
 * Pure, so both the host routes and the member route stay thin.
 */
import type {
  ActivityMeasure,
  ChallengeAggregation,
  ChallengeDataResponse,
  ChallengeEffectiveBucketSize,
  ChallengeStanding,
  ChartDataBucket,
  MetricType,
  QuantChallengeDocument,
  QuantChallengeEntry,
  QuantChallengeSample,
  QuantStandings,
} from '@aurboda/api-spec'

import { activityMeasures } from '@aurboda/api-spec'

import type {
  ChallengeMemberRecord,
  ChallengeParticipationRecord,
  ChallengeRecord,
  ChallengeSpecFields,
} from '../db/index.ts'

import { toWireKey } from './activitypub/quant-wire.ts'
import { effectiveBucketSize, type MemberSeries, specToApi } from './challenge-spec.ts'
import { buildActorUrl, buildProfileUrl, buildShareUrl } from './share-urls.ts'

export interface QuantMetric {
  key: string
  unit: string
  /** Multiplies Aurboda's stored value into `unit`; values read back are divided by it. */
  factor: number
}

/**
 * Built-in metrics whose FEP-302f §2.1 RECOMMENDED key is their own wire key,
 * with the canonical unit and the factor from the unit Aurboda stores them in
 * (`metricUnits`): distance is stored in metres, so it needs no conversion.
 */
const RECOMMENDED_METRICS: Partial<Record<MetricType, { unit: string; factor: number }>> = {
  distance: { factor: 1, unit: 'm' },
  sleep_score: { factor: 1, unit: '1' },
  steps: { factor: 1, unit: '1' },
}

const EXTENSION_PREFIX = 'aurboda'

/** The metric key and unit a challenge spec is published under. */
export const quantMetricForSpec = (
  spec: Pick<ChallengeSpecFields, 'measure' | 'pattern' | 'source_type' | 'unit'>,
): QuantMetric => {
  if (spec.source_type === 'metric') {
    const recommended = RECOMMENDED_METRICS[spec.pattern as MetricType]
    if (recommended) return { key: toWireKey(spec.pattern), ...recommended }
    return { factor: 1, key: `${EXTENSION_PREFIX}:${toWireKey(spec.pattern)}`, unit: spec.unit }
  }
  const name = spec.measure === null ? 'activityDuration' : toWireKey(spec.measure)
  return { factor: 1, key: `${EXTENSION_PREFIX}:${name}`, unit: spec.unit }
}

const QUANT_BUCKETS: Record<ChallengeEffectiveBucketSize, string> = {
  '15m': '15m',
  '1M': '30d',
  '1d': '1d',
  '1h': '1h',
  '1w': '7d',
  '5m': '5m',
}

/** A resolved bucket size in the FEP grammar; a month is approximated as `30d`. */
export const toQuantBucket = (size: ChallengeEffectiveBucketSize): string => QUANT_BUCKETS[size]

/** A FEP bucket as an Aurboda bucket size, or null when Aurboda has no such size. */
export const fromQuantBucket = (bucket: string): ChallengeEffectiveBucketSize | null => {
  if (bucket === '7d') return '1w'
  if (bucket === '30d') return '1M'
  return (
    (Object.keys(QUANT_BUCKETS) as ChallengeEffectiveBucketSize[]).find((size) => size === bucket) ?? null
  )
}

const challengeBucket = (spec: ChallengeSpecFields, start: Date, end: Date): string =>
  toQuantBucket(effectiveBucketSize(spec.bucket_size, start, end))

/**
 * Buckets as FEP samples: `offset` is the seconds from the window start to the
 * bucket's start, so a day sample sits at the local midnight whatever the
 * day's length. A bucket aligned before the window start (a week bucket
 * starting on the Monday before) is clamped to offset 0.
 */
export const bucketsToSamples = (
  buckets: ChartDataBucket[],
  start: Date,
  factor: number,
  scoring: ChallengeAggregation,
): QuantChallengeSample[] =>
  buckets.map((bucket) => {
    const value = bucket.value * factor
    return {
      count: 1,
      offset: Math.max(0, Math.round((Date.parse(bucket.bucket_start) - start.getTime()) / 1000)),
      sum: value,
      ...(scoring === 'max' ? { max: value } : {}),
    }
  })

const sampleValue = (sample: QuantChallengeSample, scoring: ChallengeAggregation): number =>
  scoring === 'max'
    ? (sample.max ?? sample.sum ?? sample.avg ?? 0)
    : (sample.sum ?? sample.count ?? sample.avg ?? 0)

export const samplesToBuckets = (
  samples: QuantChallengeSample[],
  start: Date,
  factor: number,
  scoring: ChallengeAggregation,
): ChartDataBucket[] =>
  samples.map((sample) => ({
    bucket_start: new Date(start.getTime() + sample.offset * 1000).toISOString(),
    value: sampleValue(sample, scoring) / factor,
  }))

const isActivityMeasure = (value: string | undefined): value is ActivityMeasure =>
  value !== undefined && (activityMeasures as readonly string[]).includes(value)

/**
 * A member's entry as the data response standings are built from: samples
 * become buckets, values return to Aurboda's stored unit, and the vendor
 * block becomes the measure echo `memberEchoMatches` checks.
 */
export const entryToMemberData = (
  entry: QuantChallengeEntry,
  challenge: { spec: ChallengeSpecFields; start_ts: Date },
): ChallengeDataResponse => {
  const { factor } = quantMetricForSpec(challenge.spec)
  const vendor = entry.aurboda
  return {
    aggregation: vendor?.aggregation ?? entry.scoring,
    buckets: samplesToBuckets(entry.series?.samples ?? [], challenge.start_ts, factor, entry.scoring),
    last_updated: entry.lastUpdated ?? null,
    success: true,
    ...(entry.total !== undefined ? { total: entry.total / factor } : {}),
    ...(isActivityMeasure(vendor?.measure) ? { measure: vendor.measure } : {}),
    ...(vendor?.filterField !== undefined ? { filter_field: vendor.filterField } : {}),
    ...(vendor?.filterValue !== undefined ? { filter_value: vendor.filterValue } : {}),
  }
}

/** The entry a member serves for one participation (§5). */
export const buildEntryDocument = (
  participation: ChallengeParticipationRecord,
  series: MemberSeries,
): QuantChallengeEntry => {
  const { spec } = participation
  const { factor, key, unit } = quantMetricForSpec(spec)
  return {
    challenge: participation.challenge_url,
    kind: 'challengeEntry',
    lastUpdated: series.last_updated,
    metric: key,
    scoring: spec.aggregation,
    series: {
      bucket: challengeBucket(spec, participation.start_ts, participation.end_ts),
      metric: key,
      samples: bucketsToSamples(series.buckets, participation.start_ts, factor, spec.aggregation),
      unit,
    },
    total: series.total * factor,
    unit,
    ...(spec.measure !== null
      ? {
          aurboda: {
            aggregation: spec.aggregation,
            measure: spec.measure,
            ...(spec.filter_field !== null ? { filterField: spec.filter_field } : {}),
            ...(spec.filter_value !== null ? { filterValue: spec.filter_value } : {}),
          },
        }
      : {}),
  }
}

export interface HostContext {
  webHost: string
  apiBaseUrl: string
  username: string
  now: Date
}

const memberActor = (member: ChallengeMemberRecord, webHost: string): string | null =>
  member.actor ??
  (member.kind === 'local' && member.local_user ? buildActorUrl(webHost, member.local_user) : null)

const challengeApiUrl = (ctx: HostContext, slug: string, rest = ''): string =>
  `${ctx.apiBaseUrl.replace(/\/+$/, '')}/public/${encodeURIComponent(ctx.username)}/challenges/${encodeURIComponent(slug)}${rest}`

/** A hosted challenge as listed publicly: the document without `joinToken` and `members`. */
export const buildChallengeListItem = (
  challenge: ChallengeRecord,
  ctx: HostContext,
): QuantChallengeDocument => {
  const { key, unit } = quantMetricForSpec(challenge.spec)
  return {
    aurboda: { spec: specToApi(challenge.spec) },
    bucket: challengeBucket(challenge.spec, challenge.start_ts, challenge.end_ts),
    endTime: challenge.end_ts.toISOString(),
    host: {
      actor: buildActorUrl(ctx.webHost, ctx.username),
      name: ctx.username,
      url: buildProfileUrl(ctx.webHost, ctx.username),
    },
    joinMode: challenge.end_ts.getTime() <= ctx.now.getTime() ? 'none' : 'free',
    kind: 'challenge',
    metric: key,
    name: challenge.name,
    scoring: challenge.spec.aggregation,
    standingsUrl: challengeApiUrl(ctx, challenge.slug, '/standings'),
    startTime: challenge.start_ts.toISOString(),
    timezone: challenge.timezone,
    unit,
    url: buildShareUrl(ctx.webHost, ctx.username, challenge.slug),
  }
}

/** The full challenge document (§3): the listing plus `joinToken` and the active members. */
export const buildChallengeDocument = (
  challenge: ChallengeRecord,
  members: ChallengeMemberRecord[],
  ctx: HostContext,
): QuantChallengeDocument => ({
  ...buildChallengeListItem(challenge, ctx),
  joinToken: challenge.join_token,
  members: members
    .filter((m) => m.status === 'active')
    .map((m) => ({ actor: memberActor(m, ctx.webHost), name: m.display_name, url: m.identity_base_url })),
})

/** Competition ranks for totals in descending order: equal totals share a rank, the next skips (1, 1, 3). */
export const competitionRanks = (totals: number[]): number[] =>
  totals.map((total) => 1 + totals.filter((other) => other > total).length)

/** The standings document (§6): active members only, ranked by total. */
export const buildStandingsDocument = (
  challenge: ChallengeRecord,
  standings: ChallengeStanding[],
  members: ChallengeMemberRecord[],
  ctx: HostContext,
): QuantStandings => {
  const { factor } = quantMetricForSpec(challenge.spec)
  const byIdentity = new Map(members.map((m) => [m.identity_base_url, m]))
  const active = standings.filter((s) => s.status === 'active').sort((a, b) => b.total - a.total)
  const ranks = competitionRanks(active.map((s) => s.total))
  return {
    asOf: ctx.now.toISOString(),
    bucket: challengeBucket(challenge.spec, challenge.start_ts, challenge.end_ts),
    challenge: buildShareUrl(ctx.webHost, ctx.username, challenge.slug),
    kind: 'standings',
    members: active.map((s, i) => {
      const member = byIdentity.get(s.identity_base_url)
      return {
        actor: member ? memberActor(member, ctx.webHost) : null,
        lastUpdated: s.last_updated,
        name: s.display_name,
        rank: ranks[i],
        samples: bucketsToSamples(s.buckets, challenge.start_ts, factor, challenge.spec.aggregation),
        stale: s.stale,
        total: s.total * factor,
        url: s.identity_base_url,
      }
    }),
  }
}
