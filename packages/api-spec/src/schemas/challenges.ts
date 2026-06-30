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

export const challengeSpecSchema = z
  .object({
    activity_type_id: z
      .string()
      .uuid()
      .optional()
      .meta({ description: 'Activity type definition ID (for activity_type source)' }),
    aggregation: challengeAggregationSchema,
    bucket_size: z.enum(['1d', '1w', '1M']).default('1d').meta({ description: 'Chart bucket size' }),
    pattern: z
      .string()
      .min(1)
      .optional()
      .meta({ description: 'Metric name, or activity-type pattern/regex' }),
    source_type: challengeSourceTypeSchema,
    unit: z.string().min(1).meta({ description: 'Display unit (e.g. "steps", "hours")' }),
  })
  .meta({ id: 'ChallengeSpec' })

export type ChallengeSpec = z.infer<typeof challengeSpecSchema>

// =============================================================================
// Owner-facing challenge + CRUD
// =============================================================================

export const challengeNameSchema = z.string().min(1).max(120).meta({ description: 'Challenge name' })

export const challengeSchema = z
  .object({
    created_at: z.string().meta({ description: 'Creation timestamp (ISO 8601)' }),
    end_ts: z.string().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    id: z.string().uuid().meta({ description: 'Challenge ID' }),
    is_public: z.boolean().meta({ description: 'If true, listed on the public profile' }),
    name: challengeNameSchema,
    share_url: z.string().meta({ description: 'Absolute URL of the challenge' }),
    slug: z.string().meta({ description: 'URL-safe public slug' }),
    spec: challengeSpecSchema,
    start_ts: z.string().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    timezone: z.string().meta({ description: 'IANA timezone the date range was chosen in' }),
    updated_at: z.string().meta({ description: 'Last update timestamp (ISO 8601)' }),
  })
  .meta({ id: 'Challenge' })

export type Challenge = z.infer<typeof challengeSchema>

export const createChallengeBodySchema = z
  .object({
    end_ts: z.iso.datetime().meta({ description: 'End instant, exclusive (ISO 8601)' }),
    is_public: z.boolean().default(false),
    name: challengeNameSchema,
    spec: challengeSpecSchema,
    start_ts: z.iso.datetime().meta({ description: 'Start instant, inclusive (ISO 8601)' }),
    timezone: z.string().min(1).meta({ description: 'IANA timezone the date range was chosen in' }),
  })
  .meta({ id: 'CreateChallengeBody' })

export type CreateChallengeBody = z.infer<typeof createChallengeBodySchema>

export const updateChallengeBodySchema = z
  .object({
    end_ts: z.iso.datetime().optional(),
    is_public: z.boolean().optional(),
    name: challengeNameSchema.optional(),
    spec: challengeSpecSchema.optional(),
    start_ts: z.iso.datetime().optional(),
    timezone: z.string().min(1).optional(),
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
    last_updated: z.string().nullable().meta({ description: 'When this member data was last fetched' }),
    stale: z.boolean().meta({ description: 'True if the latest fetch failed (showing last-known data)' }),
    status: z.enum(['active', 'withdrawn']),
    total: z.number().meta({ description: 'Cumulative total over the window' }),
  })
  .meta({ id: 'ChallengeStanding' })

export type ChallengeStanding = z.infer<typeof challengeStandingSchema>

export const challengeStandingsResponseSchema = baseResponseSchema
  .extend({
    members: z.array(challengeStandingSchema).optional(),
  })
  .meta({ id: 'ChallengeStandingsResponse' })

export type ChallengeStandingsResponse = z.infer<typeof challengeStandingsResponseSchema>

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
    end_ts: z.string(),
    host_identity: z.string().meta({ description: 'Host public profile base URL' }),
    is_public: z.boolean(),
    join_token: z.string().meta({ description: 'Token a joining instance presents when registering' }),
    members: z.array(challengeMemberSchema),
    name: challengeNameSchema,
    profile_url: z.string(),
    share_url: z.string(),
    spec: challengeSpecSchema,
    start_ts: z.string(),
    timezone: z.string(),
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
    last_updated: z.string().nullable().optional(),
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
    members: z.array(challengeMemberSchema.extend({ id: z.string().uuid(), status: z.enum(['active', 'withdrawn']) })),
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
