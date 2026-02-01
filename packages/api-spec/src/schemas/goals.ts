/**
 * Goal schemas for tracking health metrics against targets.
 */

import { z } from 'zod'
import { baseResponseSchema, metricTypeSchema } from './common.js'

/**
 * Duration string for goal window (e.g., '7d', '2w', '1M').
 * Units: s=seconds, m=minutes, h=hours, d=days, w=weeks, M=months
 */
export const durationStringSchema = z
  .string()
  .regex(/^\d+[smhdwM]$/, 'Duration must be a number followed by a unit (s, m, h, d, w, M)')
  .meta({
    description: 'Duration string (e.g., "7d", "2w", "1M")',
    example: '7d',
    id: 'DurationString',
  })

/**
 * Parse duration string to milliseconds.
 */
export const parseDuration = (duration: string): number => {
  const match = duration.match(/^(\d+)([smhdwM])$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)

  const value = parseInt(match[1], 10)
  const unit = match[2]

  const multipliers: Record<string, number> = {
    M: 30 * 24 * 60 * 60 * 1000, // Approximate month
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }

  return value * multipliers[unit]
}

/**
 * Goal schema for a single metric target.
 */
export const goalSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Unique identifier for the goal' }),
    max: z.number().positive().optional().meta({ description: 'Maximum target value' }),
    metric: metricTypeSchema.meta({ description: 'Metric to track' }),
    min: z.number().positive().optional().meta({ description: 'Minimum target value' }),
    window: durationStringSchema.default('7d').meta({ description: 'Rolling window duration' }),
  })
  .refine((data) => data.min !== undefined || data.max !== undefined, {
    message: 'At least one of min or max must be specified',
  })
  .refine((data) => data.min === undefined || data.max === undefined || data.min <= data.max, {
    message: 'Min must be less than or equal to max',
  })
  .meta({ id: 'Goal' })

export type Goal = z.infer<typeof goalSchema>

/**
 * Goals array schema.
 */
export const goalsSchema = z.array(goalSchema).meta({
  description: 'List of goals',
  id: 'Goals',
})

export type Goals = z.infer<typeof goalsSchema>

/**
 * Default goals based on Huberman/Galpin recommendations.
 */
export const defaultGoals: Goal[] = [
  {
    id: 'a0000001-0000-4000-8000-000000000001',
    metric: 'hr_zone_2_sec',
    min: 9000, // 150 minutes in seconds
    window: '7d',
  },
  {
    id: 'a0000002-0000-4000-8000-000000000002',
    max: 600, // 10 minutes in seconds
    metric: 'hr_zone_5_sec',
    min: 300, // 5 minutes in seconds
    window: '7d',
  },
  {
    id: 'a0000003-0000-4000-8000-000000000003',
    metric: 'steps',
    min: 70000,
    window: '7d',
  },
]

/**
 * Goal progress schema - includes current value and losing-tomorrow calculation.
 */
export const goalProgressSchema = z
  .object({
    current: z.number().meta({ description: 'Current value within the window' }),
    id: z.string().uuid().meta({ description: 'Goal ID' }),
    losingTomorrow: z
      .number()
      .meta({ description: 'Value that will drop off when oldest period exits window' }),
    max: z.number().positive().optional(),
    metric: metricTypeSchema,
    min: z.number().positive().optional(),
    unit: z.string().meta({ description: 'Storage unit for the metric' }),
    window: durationStringSchema,
  })
  .meta({ id: 'GoalProgress' })

export type GoalProgress = z.infer<typeof goalProgressSchema>

/**
 * Goals progress response schema.
 */
export const goalsProgressResponseSchema = baseResponseSchema
  .extend({
    goals: z.array(goalProgressSchema).meta({ description: 'Progress for all goals' }),
  })
  .meta({ id: 'GoalsProgressResponse' })

export type GoalsProgressResponse = z.infer<typeof goalsProgressResponseSchema>
