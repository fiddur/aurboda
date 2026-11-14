import { z } from 'zod'

import { iso8601DateTimeSchema, queryBooleanSchema } from './common.ts'

export const flaggedWindowSchema = z
  .object({
    activity_id: z.string().meta({ description: 'The flagged activity' }),
    activity_type: z.string(),
    end_time: iso8601DateTimeSchema,
    start_time: iso8601DateTimeSchema,
  })
  .meta({
    description: 'The span [start_time, end_time) of an activity whose data.exclude_from_baseline is true',
    id: 'FlaggedWindow',
  })

export type FlaggedWindow = z.infer<typeof flaggedWindowSchema>

export const flaggedExclusionSchema = z
  .object({
    excluded_days: z.number().int().optional().meta({
      description: 'Days left out of a per-day analysis because they overlap a flagged window',
    }),
    excluded_points: z.number().int().optional().meta({
      description:
        'Data points left out because their time falls in a flagged window: metric samples (or the 5-minute bins of a binned analysis), and the activities, visits and app spans starting in one',
    }),
    windows: z
      .array(flaggedWindowSchema)
      .meta({ description: 'Flagged windows overlapping the analysed range' }),
  })
  .meta({
    description:
      'What was left out because it fell in a window flagged exclude_from_baseline (a gathering, a festival); present when such a window overlaps the analysed range and flagged windows were not included',
    id: 'FlaggedExclusion',
  })

export type FlaggedExclusion = z.infer<typeof flaggedExclusionSchema>

/** One sentence for the descriptions of the analyses that leave flagged windows out. */
export const flaggedWindowsNote =
  'Data inside an activity flagged exclude_from_baseline (any type, e.g. a multi-day gathering) is left out by default and counted in flagged_exclusion; include_flagged: true keeps it.'

const includeFlaggedDescription =
  'Keep the data inside activities flagged exclude_from_baseline, which are left out by default (to study those windows themselves)'

export const includeFlaggedSchema = queryBooleanSchema
  .optional()
  .meta({ description: includeFlaggedDescription })

export const includeFlaggedBodySchema = z
  .boolean()
  .optional()
  .meta({ description: includeFlaggedDescription })

/** The opt-in counterpart for raw views such as bucketed metrics, which keep flagged windows by default. */
export const excludeFlaggedSchema = queryBooleanSchema.optional().meta({
  description:
    'Leave out the samples inside activities flagged exclude_from_baseline (a gathering, a festival); kept by default',
})
