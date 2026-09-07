/**
 * Challenge schemas — federated, cross-instance competitions.
 *
 * A *challenge* is hosted by one user and measures a single metric or activity
 * type (cumulative total) over a date span. Members join — possibly from a
 * different Aurboda instance — and each contributes a bucketed series via a
 * capability data endpoint. Members are identified by their full public base
 * URL (the federation identity), and "same instance" is just the host reading a
 * member's data in-process instead of over HTTP.
 *
 * Challenges share the `/u/:username/:slug` public namespace with shared
 * dashboards; the public resolver returns a `type` discriminator.
 */

import { z } from 'zod'

import { chartDataBucketSchema } from './chart-data.ts'
import { baseResponseSchema } from './common.ts'
import { shareVisibilitySchema } from './visibility.ts'

// =============================================================================
// Measurement spec
// =============================================================================

/** What a challenge measures. v1: one built-in metric or activity type, summed. */
export const challengeSourceTypeSchema = z.enum(['metric', 'activity_type']).meta({
  description: 'Whether the challenge measures a metric or an activity type',
  id: 'ChallengeSourceType',
})

export type ChallengeSourceType = z.infer<typeof challengeSourceTypeSchema>

/** Aggregation across the period. v1: sum (e.g. total steps, total hours) or count. */
export const challengeAggregationSchema = z.enum(['sum', 'count']).meta({
  description: 'How values are aggregated: sum (totals/hours) or count (sessions)',
  id: 'ChallengeAggregation',
})

export type ChallengeAggregation = z.infer<typeof challengeAggregationSchema>

/**
 * Chart bucket granularity the creator picks. `auto` adapts to the challenge window
 * (fine buckets for short challenges, coarse for long ones); a fixed coarser size can
 * be chosen for very long challenges where coarse points are preferred.
 */
export const challengeBucketSizeSchema = z.enum(['auto', '1d', '1w', '1M']).meta({
  description: 'Chart bucket granularity: "auto" adapts to the window, or a fixed coarser size',
  id: 'ChallengeBucketSize',
})

export type ChallengeBucketSizeChoice = z.infer<typeof challengeBucketSizeSchema>

/**
 * Concrete bucket size the race chart is actually rendered with, resolved from
 * `bucket_size` + the challenge window.
 */
/**
 * Shared by `ChallengeStanding.last_updated` and `ChallengeDataResponse.last_updated`
 * (one member's own report of the same value), so the two cannot drift (#1090).
 */
const lastUpdatedDescription =
  "When this member's contributing data last changed: the newest point's value-change time (daily aggregates like steps are rewritten in place all day), falling back to the point's own timestamp for data stored before that was tracked; null if they have no data yet"

export const challengeEffectiveBucketSizeSchema = z.enum(['5m', '15m', '1h', '1d', '1w', '1M']).meta({
  description: 'Resolved chart bucket size (from bucket_size + window) the race chart is rendered with',
  id: 'ChallengeEffectiveBucketSize',
})

export type ChallengeEffectiveBucketSize = z.infer<typeof challengeEffectiveBucketSizeSchema>

export const challengeSpecSchema = z
  .object({
    activity_type_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Reserved for future use; v1 measurement is driven entirely by `pattern`' }),
    aggregation: challengeAggregationSchema,
    bucket_size: challengeBucketSizeSchema.default('auto'),
    pattern: z
      .string()
      .min(1)
      .meta({ description: 'Metric name, or activity-type name/regex — what is measured' }),
    source_type: challengeSourceTypeSchema,
    unit: z.string().min(1).meta({ description: 'Display unit (e.g. "steps", "hours")' }),
  })
  .meta({ id: 'ChallengeSpec' })

export type ChallengeSpec = z.infer<typeof challengeSpecSchema>

// =============================================================================
// Owner-facing challenge + CRUD
// =============================================================================

export const challengeNameSchema = z.string().min(1).max(120).meta({ description: 'Challenge name' })

/**
 * Whether the host's instance publishes the final standings to the host's feed
 * when the challenge window closes (see `ChallengeResult`). Defaults on; the
 * host can switch it off per challenge.
 */
export const announceWinnerSchema = z.boolean().meta({
  description:
    'Publish the final standings (winner tagged) to the host feed when the challenge ends. Defaults to true.',
})

export const challengeSchema = z
  .object({
    announce_winner: announceWinnerSchema.default(true),
    announcement_pending: z.boolean().default(false).meta({
      description:
        'Whether the completion announcement can still happen: not yet made or skipped, and the challenge either has not ended or ended within the announce window (3 days). The web shows the "Announce winner" toggle only while this is true.',
    }),
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    end_ts: z.string().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Challenge ID' }),
    name: challengeNameSchema,
    result_published_at: z.string().nullable().optional().meta({
      description:
        'When the final standings were announced to the feed (or the announcement was deliberately skipped); null while still pending',
    }),
    share_url: z.string().meta({ description: 'Absolute URL of the challenge' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
    spec: challengeSpecSchema,
    start_ts: z.string().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    timezone: z.string().meta({ description: 'IANA timezone the date range was chosen in' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
    visibility: shareVisibilitySchema.meta({
      description: 'public → listed on the public profile; unlisted → reachable only by its link',
    }),
  })
  .meta({ id: 'Challenge' })

export type Challenge = z.infer<typeof challengeSchema>

export const createChallengeBodySchema = z
  .object({
    announce_winner: announceWinnerSchema.default(true),
    end_ts: z.iso.datetime().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    name: challengeNameSchema,
    spec: challengeSpecSchema,
    start_ts: z.iso.datetime().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    timezone: z.string().min(1).meta({ description: 'IANA timezone the date range was chosen in' }),
    visibility: shareVisibilitySchema
      .default('unlisted')
      .meta({ description: 'public → listed on the public profile; unlisted (default) → link-only' }),
  })
  .meta({ id: 'CreateChallengeBody' })

export type CreateChallengeBody = z.infer<typeof createChallengeBodySchema>

export const updateChallengeBodySchema = z
  .object({
    announce_winner: announceWinnerSchema.optional(),
    end_ts: z.iso.datetime().optional(),
    name: challengeNameSchema.optional(),
    spec: challengeSpecSchema.optional(),
    start_ts: z.iso.datetime().optional(),
    timezone: z.string().min(1).optional(),
    visibility: shareVisibilitySchema
      .optional()
      .meta({ description: 'public → listed on the public profile; unlisted → link-only' }),
  })
  .meta({ id: 'UpdateChallengeBody' })

export type UpdateChallengeBody = z.infer<typeof updateChallengeBodySchema>

export const challengeResponseSchema = baseResponseSchema
  .extend({ challenge: challengeSchema.optional() })
  .meta({ id: 'ChallengeResponse' })

export type ChallengeResponse = z.infer<typeof challengeResponseSchema>

export const challengesResponseSchema = baseResponseSchema
  .extend({ challenges: z.array(challengeSchema) })
  .meta({ id: 'ChallengesResponse' })

export type ChallengesResponse = z.infer<typeof challengesResponseSchema>

// =============================================================================
// Members + standings
// =============================================================================

/** A member as listed publicly (no secret data-endpoint URL). */
export const challengeMemberSchema = z
  .object({
    display_name: z.string().meta({ description: 'Member display name' }),
    identity_base_url: z.string().meta({ description: 'Member public profile base URL' }),
  })
  .meta({ id: 'ChallengeMember' })

export type ChallengeMember = z.infer<typeof challengeMemberSchema>

/** A member's standing: their cumulative series + total. */
export const challengeStandingSchema = z
  .object({
    buckets: z.array(chartDataBucketSchema).meta({ description: 'Per-bucket values over the window' }),
    display_name: z.string(),
    identity_base_url: z.string(),
    last_updated: z.string().nullable().meta({ description: lastUpdatedDescription }),
    stale: z.boolean().meta({ description: 'True if the latest fetch failed (showing last-known data)' }),
    status: z.enum(['active', 'withdrawn']),
    total: z.number().meta({ description: 'Cumulative total over the window' }),
  })
  .meta({ id: 'ChallengeStanding' })

export type ChallengeStanding = z.infer<typeof challengeStandingSchema>

export const challengeStandingsResponseSchema = baseResponseSchema
  .extend({
    effective_bucket_size: challengeEffectiveBucketSizeSchema.optional().meta({
      description:
        "The bucket size the members' series were aggregated with, so a client can plot bucket ends without inferring the size from the data",
    }),
    members: z.array(challengeStandingSchema).optional(),
  })
  .meta({ id: 'ChallengeStandingsResponse' })

export type ChallengeStandingsResponse = z.infer<typeof challengeStandingsResponseSchema>

// =============================================================================
// Final result (published to the host's feed when the window closes)
// =============================================================================

/** One podium line of a finished challenge. */
export const challengeResultEntrySchema = z
  .object({
    display_name: z
      .string()
      .meta({ description: 'Member display name at the time the result was published' }),
    identity_base_url: z
      .string()
      .meta({ description: 'Member public profile base URL (federation identity)' }),
    rank: z.number().int().min(1).meta({
      description: 'Competition rank (members with equal totals share a rank, e.g. 1, 1, 3)',
    }),
    total: z.number().meta({ description: 'Final cumulative total over the window' }),
  })
  .meta({ id: 'ChallengeResultEntry' })

export type ChallengeResultEntry = z.infer<typeof challengeResultEntrySchema>

/**
 * The final standings of a finished challenge, as snapshotted into the host's
 * completion post: the podium (every member ranked 1–3; a tie for first means
 * several winners) plus how many members competed. Rank-1 entries are the
 * winners, who get a `Mention` in the federated Note.
 */
export const challengeResultSchema = z
  .object({
    member_count: z
      .number()
      .int()
      .min(0)
      .meta({ description: 'Active members the result was computed over' }),
    podium: z
      .array(challengeResultEntrySchema)
      .max(10)
      .meta({ description: 'Members ranked 1–3 in rank order (rank 1 = the winner(s))' }),
    unit: z.string().meta({ description: 'Display unit of the totals (the challenge spec unit)' }),
  })
  .meta({ id: 'ChallengeResult' })

export type ChallengeResult = z.infer<typeof challengeResultSchema>

/** Body a joining instance POSTs back to the host to register a member. */
export const registerChallengeMemberBodySchema = z
  .object({
    data_endpoint_url: z.string().url().meta({ description: "URL of the member's capability data endpoint" }),
    display_name: z.string().min(1).max(120),
    identity_base_url: z.string().url().meta({ description: 'Member public profile base URL' }),
    join_token: z.string().min(1).meta({ description: 'Token from the challenge spec, proving spec fetch' }),
  })
  .meta({ id: 'RegisterChallengeMemberBody' })

export type RegisterChallengeMemberBody = z.infer<typeof registerChallengeMemberBodySchema>

// =============================================================================
// Public challenge (spec fetched by joining instances + viewers)
// =============================================================================

export const publicChallengeSchema = z
  .object({
    effective_bucket_size: challengeEffectiveBucketSizeSchema.optional().meta({
      description:
        'Concrete bucket size the race chart is rendered with (resolved from spec.bucket_size + window). ' +
        'Optional for cross-version federation: only the viewing frontend reads it (falling back to a ' +
        'default), so a joiner parsing an older host that omits it can still join.',
    }),
    end_ts: z.string(),
    host_identity: z.string().meta({ description: 'Host public profile base URL' }),
    join_token: z.string().meta({ description: 'Token a joining instance presents when registering' }),
    members: z.array(challengeMemberSchema),
    name: challengeNameSchema,
    profile_url: z.string(),
    share_url: z.string(),
    spec: challengeSpecSchema,
    start_ts: z.string(),
    timezone: z.string(),
    visibility: shareVisibilitySchema,
  })
  .meta({ id: 'PublicChallenge' })

export type PublicChallenge = z.infer<typeof publicChallengeSchema>

export const publicChallengeResponseSchema = baseResponseSchema
  .extend({
    challenge: publicChallengeSchema.optional(),
    type: z.literal('challenge').optional().meta({ description: 'Resource type discriminator' }),
  })
  .meta({ id: 'PublicChallengeResponse' })

export type PublicChallengeResponse = z.infer<typeof publicChallengeResponseSchema>

// =============================================================================
// Member data endpoint (served by the member's own instance)
// =============================================================================

export const challengeDataResponseSchema = baseResponseSchema
  .extend({
    buckets: z.array(chartDataBucketSchema).optional(),
    display_name: z.string().optional(),
    last_updated: z.string().nullable().optional().meta({ description: lastUpdatedDescription }),
    total: z.number().optional(),
    unit: z.string().optional(),
  })
  .meta({ id: 'ChallengeDataResponse' })

export type ChallengeDataResponse = z.infer<typeof challengeDataResponseSchema>

// =============================================================================
// Participations (the joining user's own record)
// =============================================================================

export const challengeParticipationSchema = z
  .object({
    challenge_url: z.string().meta({ description: 'Absolute URL of the joined challenge' }),
    created_at: z.string(),
    end_ts: z.string(),
    host_identity: z.string(),
    id: z.string().uuid(),
    name: challengeNameSchema,
    spec: challengeSpecSchema,
    start_ts: z.string(),
    status: z.enum(['active', 'withdrawn']),
    timezone: z.string(),
  })
  .meta({ id: 'ChallengeParticipation' })

export type ChallengeParticipation = z.infer<typeof challengeParticipationSchema>

export const challengeParticipationsResponseSchema = baseResponseSchema
  .extend({ participations: z.array(challengeParticipationSchema) })
  .meta({ id: 'ChallengeParticipationsResponse' })

export type ChallengeParticipationsResponse = z.infer<typeof challengeParticipationsResponseSchema>

export const challengeParticipationResponseSchema = baseResponseSchema
  .extend({ participation: challengeParticipationSchema.optional() })
  .meta({ id: 'ChallengeParticipationResponse' })

export type ChallengeParticipationResponse = z.infer<typeof challengeParticipationResponseSchema>

/** Members list (owner-facing management). */
export const challengeMembersResponseSchema = baseResponseSchema
  .extend({
    members: z.array(
      challengeMemberSchema.extend({ id: z.string().uuid(), status: z.enum(['active', 'withdrawn']) }),
    ),
  })
  .meta({ id: 'ChallengeMembersResponse' })

export type ChallengeMembersResponse = z.infer<typeof challengeMembersResponseSchema>

/** Body for joining a challenge by its URL (on the joining user's own instance). */
export const joinChallengeBodySchema = z
  .object({
    challenge_url: z.string().url().meta({ description: 'Absolute URL of the challenge to join' }),
  })
  .meta({ id: 'JoinChallengeBody' })

export type JoinChallengeBody = z.infer<typeof joinChallengeBodySchema>

// =============================================================================
// Discovery: open challenges from people you follow
// =============================================================================

export const discoveredChallengeSchema = z
  .object({
    end_ts: z.string().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    host_actor_uri: z
      .string()
      .meta({ description: "The host's ActivityPub actor URI — the followee this came from" }),
    host_display_name: z
      .string()
      .nullable()
      .meta({ description: "The host's display name as cached from their actor, if known" }),
    host_handle: z
      .string()
      .nullable()
      .meta({ description: 'The host handle, e.g. `@alice@aurboda.net`, if known' }),
    host_identity: z.string().meta({
      description:
        "The host's identity URL (`<instance>/u/<username>`), as in `ChallengeParticipation.host_identity`",
    }),
    name: challengeNameSchema,
    share_url: z.string().meta({ description: "The challenge's public URL — the join-by-URL target" }),
    spec: challengeSpecSchema,
    start_ts: z.string().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    status: z.enum(['ongoing', 'upcoming']).meta({
      description: 'Whether the window is already running or starts later; ended challenges are never listed',
    }),
    timezone: z.string().meta({ description: 'IANA timezone the date range was chosen in' }),
  })
  .meta({
    description: 'A public challenge hosted by someone the user follows that the user has not joined',
    id: 'DiscoveredChallenge',
  })

export type DiscoveredChallenge = z.infer<typeof discoveredChallengeSchema>

export const discoverChallengesResponseSchema = baseResponseSchema
  .extend({
    challenges: z.array(discoveredChallengeSchema).meta({
      description: 'Ongoing challenges first (soonest to end), then upcoming ones (soonest to start)',
    }),
    peers_unreachable: z.number().int().nonnegative().meta({
      description:
        'Followed Aurboda instances that could not be listed this time; their challenges may be missing from the list',
    }),
  })
  .meta({ id: 'DiscoverChallengesResponse' })

export type DiscoverChallengesResponse = z.infer<typeof discoverChallengesResponseSchema>

// =============================================================================
// Federation discovery
// =============================================================================

export const wellKnownAurbodaSchema = z
  .object({
    api_base: z.string().meta({ description: 'Absolute base URL of this instance API' }),
    federation: z.boolean().meta({ description: 'Whether this instance supports federation' }),
    product: z.literal('aurboda'),
    version: z.string().meta({ description: 'Instance build/version identifier' }),
  })
  .meta({ id: 'WellKnownAurboda' })

export type WellKnownAurboda = z.infer<typeof wellKnownAurbodaSchema>

/** QuantPub discovery document (FEP §4, `/.well-known/quantpub`). */
export const wellKnownQuantpubSchema = z
  .object({
    api_base: z
      .string()
      .meta({ description: 'Absolute base URL under which the structured-post and series endpoints live' }),
    product: z.string().meta({ description: 'Free-form implementation identity' }),
    quantpub: z.string().meta({ description: 'QuantPub spec version implemented' }),
    version: z.string().meta({ description: 'Implementation build/version identifier' }),
  })
  .meta({ id: 'WellKnownQuantpub' })

export type WellKnownQuantpub = z.infer<typeof wellKnownQuantpubSchema>
