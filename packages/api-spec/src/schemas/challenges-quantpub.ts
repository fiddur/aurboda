/**
 * QuantPub Challenges wire documents (`docs/fep/quantpub-challenges.md`): the
 * challenge document, its listing, the HTTP join/leave bodies, a member's
 * entry and the host's standings.
 *
 * Like the QuantPub activity payload in `feed-structured.ts`, these are wire
 * shapes a spec defines, so their field names are lowerCamelCase: the
 * sanctioned exception to the snake_case convention. Aurboda converts to and
 * from them at the boundary (`apps/backend/src/services/challenge-quantpub.ts`).
 */
import { z } from 'zod'

import { challengeAggregationSchema, challengeNameSchema, challengeSpecSchema } from './challenges.ts'

const quantBucketSchema = z
  .string()
  .regex(/^\d+[smhd]$/, 'Must be {number}{unit} where unit is s, m, h or d')
  .meta({ description: 'Sample width: an integer followed by s, m, h or d (FEP-302f §6 syntax), e.g. `1d`' })

export const quantChallengeScoringSchema = challengeAggregationSchema.meta({
  description:
    "How a member's samples become a score: their sums added, the samples counted, or the best one",
  id: 'QuantChallengeScoring',
})

const quantPersonSchema = z.object({
  actor: z.string().nullable().optional().meta({ description: 'ActivityPub actor id, where one exists' }),
  name: z.string().meta({ description: 'Display name' }),
  url: z.string().meta({ description: 'Public page; a member’s identity' }),
})

export const quantChallengeHostSchema = quantPersonSchema.meta({
  description: 'The person hosting the challenge',
  id: 'QuantChallengeHost',
})

export const quantChallengeMemberSchema = quantPersonSchema.meta({
  description: 'A current member as listed on the challenge document',
  id: 'QuantChallengeMember',
})

export const quantChallengeDocumentSchema = z
  .object({
    aurboda: z.object({ spec: challengeSpecSchema }).optional().meta({
      description: 'Vendor block: the exact Aurboda spec, so an Aurboda joiner scores it the same way',
    }),
    bucket: quantBucketSchema.optional(),
    endTime: z.string().meta({ description: 'End of the window, exclusive (ISO 8601)' }),
    host: quantChallengeHostSchema,
    id: z.string().optional().meta({ description: 'The AS2 object id, where one exists' }),
    joinMode: z.enum(['free', 'restricted', 'none']).optional(),
    joinToken: z
      .string()
      .optional()
      .meta({ description: 'Presented in an HTTP join to prove the joiner read the document' }),
    kind: z.literal('challenge'),
    members: z.array(quantChallengeMemberSchema).optional(),
    metric: z.string().min(1).meta({ description: 'A FEP-302f §2.1 key or an extension key `prefix:name`' }),
    name: challengeNameSchema,
    scoring: quantChallengeScoringSchema,
    standingsUrl: z.string().optional(),
    startTime: z.string().meta({ description: 'Start of the window (ISO 8601)' }),
    timezone: z.string().meta({ description: 'IANA zone days are counted in, for every member' }),
    unit: z.string().optional().meta({ description: 'UCUM unit; required for an extension key' }),
    url: z.string().meta({ description: 'The challenge’s public page' }),
  })
  .meta({ description: 'A QuantPub challenge document', id: 'QuantChallengeDocument' })

export type QuantChallengeDocument = z.infer<typeof quantChallengeDocumentSchema>

export const quantChallengeListSchema = z
  .object({
    items: z.array(quantChallengeDocumentSchema),
    kind: z.literal('challengeList'),
  })
  .meta({
    description: "A host's public challenges, each without `joinToken` and `members`",
    id: 'QuantChallengeList',
  })

export type QuantChallengeList = z.infer<typeof quantChallengeListSchema>

export const quantChallengeJoinBodySchema = z
  .object({
    actor: z.string().url().nullable().optional().meta({ description: 'The member’s actor id, if any' }),
    currentEntryUrl: z.string().url().optional().meta({
      description: 'The currently registered entry URL; required to change an existing registration',
    }),
    entryUrl: z.string().url().meta({ description: 'Capability URL of the member’s entry' }),
    joinToken: z.string().min(1),
    name: z.string().min(1).max(120),
    url: z
      .string()
      .url()
      .regex(/^https?:\/\//i, 'Must be an http(s) URL')
      .meta({ description: 'The member’s public page: its identity' }),
  })
  .meta({ description: 'HTTP join body (QuantPub Challenges §4.2)', id: 'QuantChallengeJoinBody' })

export type QuantChallengeJoinBody = z.infer<typeof quantChallengeJoinBodySchema>

export const quantChallengeJoinResponseSchema = z
  .object({ status: z.enum(['member', 'pending']) })
  .meta({ id: 'QuantChallengeJoinResponse' })

export type QuantChallengeJoinResponse = z.infer<typeof quantChallengeJoinResponseSchema>

export const quantChallengeLeaveBodySchema = z
  .object({
    entryUrl: z.string().url().meta({ description: 'The registered entry URL, proving who leaves' }),
  })
  .meta({ id: 'QuantChallengeLeaveBody' })

export type QuantChallengeLeaveBody = z.infer<typeof quantChallengeLeaveBodySchema>

export const quantChallengeLeaveResponseSchema = z
  .object({ status: z.literal('left') })
  .meta({ id: 'QuantChallengeLeaveResponse' })

export type QuantChallengeLeaveResponse = z.infer<typeof quantChallengeLeaveResponseSchema>

export const quantChallengeSampleSchema = z
  .object({
    avg: z.number().optional(),
    count: z.number().optional(),
    max: z.number().optional(),
    min: z.number().optional(),
    offset: z.number().int().meta({
      description:
        'Seconds since the challenge startTime to the start of this bucket; negative for a first bucket that begins before startTime',
    }),
    sum: z.number().optional(),
  })
  .meta({ id: 'QuantChallengeSample' })

export type QuantChallengeSample = z.infer<typeof quantChallengeSampleSchema>

export const quantChallengeSeriesSchema = z
  .object({
    bucket: quantBucketSchema,
    metric: z.string(),
    samples: z.array(quantChallengeSampleSchema).optional(),
    unit: z.string().optional(),
  })
  .meta({ id: 'QuantChallengeSeries' })

export type QuantChallengeSeries = z.infer<typeof quantChallengeSeriesSchema>

export const quantChallengeEntrySchema = z
  .object({
    aurboda: z
      .object({
        aggregation: challengeAggregationSchema.optional(),
        filterField: z.string().optional(),
        filterValue: z.string().optional(),
        measure: z.string().optional(),
      })
      .optional()
      .meta({ description: 'Vendor block: how an Aurboda member scored a measure challenge' }),
    challenge: z.string().meta({ description: 'The challenge this entry is for' }),
    kind: z.literal('challengeEntry'),
    lastUpdated: z
      .string()
      .nullable()
      .optional()
      .meta({ description: "When the member's underlying data last changed; null when there is none" }),
    metric: z.string().min(1),
    scoring: quantChallengeScoringSchema,
    series: quantChallengeSeriesSchema.optional(),
    total: z.number().optional().meta({ description: 'The score so far under `scoring`' }),
    unit: z.string().optional(),
  })
  .meta({
    description: "A member's progress in one challenge (QuantPub Challenges §5)",
    id: 'QuantChallengeEntry',
  })

export type QuantChallengeEntry = z.infer<typeof quantChallengeEntrySchema>

export const quantStandingsMemberSchema = quantPersonSchema
  .extend({
    lastUpdated: z.string().nullable(),
    rank: z.number().int().min(1).meta({ description: 'Competition rank: equal totals share a rank' }),
    samples: z.array(quantChallengeSampleSchema),
    stale: z.boolean().meta({ description: 'True when the latest fetch failed and the total is last-known' }),
    total: z.number(),
  })
  .meta({ id: 'QuantStandingsMember' })

export type QuantStandingsMember = z.infer<typeof quantStandingsMemberSchema>

export const quantStandingsSchema = z
  .object({
    asOf: z.string(),
    bucket: quantBucketSchema,
    challenge: z.string(),
    kind: z.literal('standings'),
    members: z.array(quantStandingsMemberSchema),
  })
  .meta({ description: "A challenge's standings (QuantPub Challenges §6)", id: 'QuantStandings' })

export type QuantStandings = z.infer<typeof quantStandingsSchema>

export const quantErrorSchema = z
  .object({ error: z.string().meta({ description: 'Why the request was refused' }) })
  .meta({ id: 'QuantError' })

export type QuantError = z.infer<typeof quantErrorSchema>
