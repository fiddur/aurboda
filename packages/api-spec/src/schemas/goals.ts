/**
 * Goal schemas for tracking health metrics against targets.
 *
 * Three goal types via discriminated union on `goal_type`:
 * - `metric`: windowed sum of a predefined metric (e.g., "70k steps per week")
 * - `trend`: EMA trend value against a target (e.g., "keep trend below 0.7/month")
 * - `measure`: windowed max or sum of a list-item measure of an activity type (e.g. "Bench Press
 *   e1RM at least 100 kg over 30 days")
 */

import { z } from 'zod'

import { activityMeasureSchema } from './activity-measures.ts'
import { activityTypeSchema, baseResponseSchema, dataFieldPathSchema, metricTypeSchema } from './common.ts'
import { trendDisplayPeriodSchema, trendSourceTypeSchema } from './trends.ts'

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

export type DurationUnit = 'd' | 'h' | 'M' | 'm' | 's' | 'w'

export interface ParsedDuration {
  ms: number
  unit: DurationUnit
  value: number
}

export const parseDuration = (duration: string): ParsedDuration => {
  const match = duration.match(/^(\d+)([smhdwM])$/)
  if (!match) throw new Error(`Invalid duration: ${duration}`)

  const value = parseInt(match[1], 10)
  const unit = match[2] as DurationUnit

  const multipliers: Record<string, number> = {
    M: 30 * 24 * 60 * 60 * 1000, // Approximate month
    d: 24 * 60 * 60 * 1000,
    h: 60 * 60 * 1000,
    m: 60 * 1000,
    s: 1000,
    w: 7 * 24 * 60 * 60 * 1000,
  }

  return { ms: value * multipliers[unit], unit, value }
}

/**
 * Check if a duration unit is calendar-based (days, weeks, months).
 * Calendar-based windows align to day boundaries.
 * Rolling windows (hours, minutes, seconds) use exact time offsets.
 */
export const isCalendarBasedUnit = (unit: DurationUnit): boolean =>
  unit === 'd' || unit === 'w' || unit === 'M'

export const metricGoalSchema = z
  .object({
    goal_type: z.literal('metric').default('metric').meta({ description: 'Goal type discriminant' }),
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
  .meta({ description: 'Metric goal: windowed sum of a predefined metric', id: 'MetricGoal' })

export type MetricGoal = z.infer<typeof metricGoalSchema>

export const trendGoalSchema = z
  .object({
    aggregation: z.enum(['count', 'sum', 'mean']).optional().meta({
      description: 'How to aggregate source data. Defaults to count for activity types and mean for metrics.',
    }),
    display_period: trendDisplayPeriodSchema
      .default('monthly')
      .meta({ description: 'Display period for the trend value' }),
    goal_type: z.literal('trend').meta({ description: 'Goal type discriminant' }),
    half_life_days: z.number().positive().default(15).meta({ description: 'EMA half-life in days' }),
    id: z.string().uuid().meta({ description: 'Unique identifier for the goal' }),
    max: z.number().optional().meta({ description: 'Maximum target value' }),
    min: z.number().optional().meta({ description: 'Minimum target value' }),
    pattern: z.string().meta({ description: 'Activity type name, metric name, or category path' }),
    source_type: trendSourceTypeSchema.meta({ description: 'Type of data source for the trend' }),
  })
  .refine((data) => data.min !== undefined || data.max !== undefined, {
    message: 'At least one of min or max must be specified',
  })
  .refine((data) => data.min === undefined || data.max === undefined || data.min <= data.max, {
    message: 'Min must be less than or equal to max',
  })
  .meta({ description: 'Trend goal: EMA trend value against a target', id: 'TrendGoal' })

export type TrendGoal = z.infer<typeof trendGoalSchema>

export const measureGoalAggregationSchema = z.enum(['max', 'sum']).meta({
  id: 'MeasureGoalAggregation',
  description: 'How the measure is combined over the window: the best session (max) or the total (sum)',
})

export type MeasureGoalAggregation = z.infer<typeof measureGoalAggregationSchema>

const measureGoalShape = {
  activity_type: activityTypeSchema.meta({ description: 'Activity type whose sessions are measured' }),
  aggregation: measureGoalAggregationSchema
    .default('max')
    .meta({ description: 'max for e1rm, max_weight and max_time; sum for volume and set_count' }),
  filter_field: dataFieldPathSchema
    .optional()
    .meta({ description: 'Item path to filter the items by, e.g. sets.exercise' }),
  filter_value: z.string().optional().meta({ description: 'The item value to keep, e.g. an exercise name' }),
  goal_type: z.literal('measure').meta({ description: 'Goal type discriminant' }),
  id: z.string().uuid().meta({ description: 'Unique identifier for the goal' }),
  max: z.number().positive().optional().meta({ description: 'Maximum target value' }),
  measure: activityMeasureSchema.meta({ description: 'The list-item measure the goal is on' }),
  min: z.number().positive().optional().meta({ description: 'Minimum target value' }),
  window: durationStringSchema.default('30d').meta({ description: 'Rolling window duration' }),
}

export const measureGoalSchema = z
  .object(measureGoalShape)
  .refine((data) => data.min !== undefined || data.max !== undefined, {
    message: 'At least one of min or max must be specified',
  })
  .refine((data) => data.min === undefined || data.max === undefined || data.min <= data.max, {
    message: 'Min must be less than or equal to max',
  })
  .refine((data) => (data.filter_field === undefined) === (data.filter_value === undefined), {
    message: 'filter_field and filter_value must be given together',
    path: ['filter_value'],
  })
  .meta({
    description:
      'Measure goal: the best (max) or total (sum) of a list-item measure over the sessions of an activity type in a rolling window, optionally for one item value such as an exercise',
    id: 'MeasureGoal',
  })

export type MeasureGoal = z.infer<typeof measureGoalSchema>

export const goalSchema = z
  .discriminatedUnion('goal_type', [metricGoalSchema, trendGoalSchema, measureGoalSchema])
  .meta({
    id: 'Goal',
  })

export type Goal = z.infer<typeof goalSchema>

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
    goal_type: 'metric',
    id: 'a0000001-0000-4000-8000-000000000001',
    metric: 'hr_zone_2_sec',
    min: 9000, // 150 minutes in seconds
    window: '7d',
  },
  {
    goal_type: 'metric',
    id: 'a0000002-0000-4000-8000-000000000002',
    max: 600, // 10 minutes in seconds
    metric: 'hr_zone_5_sec',
    min: 300, // 5 minutes in seconds
    window: '7d',
  },
  {
    goal_type: 'metric',
    id: 'a0000003-0000-4000-8000-000000000003',
    metric: 'steps',
    min: 70000,
    window: '7d',
  },
]

export const metricGoalProgressSchema = z
  .object({
    current: z.number().meta({ description: 'Current value within the window' }),
    goal_type: z.literal('metric').default('metric').meta({ description: 'Goal type discriminant' }),
    id: z.string().uuid().meta({ description: 'Goal ID' }),
    losing_tomorrow: z
      .number()
      .meta({ description: 'Value that will drop off when oldest period exits window' }),
    max: z.number().positive().optional(),
    metric: metricTypeSchema,
    min: z.number().positive().optional(),
    unit: z.string().meta({ description: 'Storage unit for the metric' }),
    window: durationStringSchema,
  })
  .meta({ description: 'Progress for a metric goal', id: 'MetricGoalProgress' })

export type MetricGoalProgress = z.infer<typeof metricGoalProgressSchema>

export const trendGoalProgressSchema = z
  .object({
    current: z.number().meta({ description: 'Current EMA trend value' }),
    display_period: trendDisplayPeriodSchema.meta({ description: 'Display period for the value' }),
    display_unit: z.string().meta({ description: 'Human-readable unit (e.g., "per month")' }),
    goal_type: z.literal('trend').meta({ description: 'Goal type discriminant' }),
    id: z.string().uuid().meta({ description: 'Goal ID' }),
    max: z.number().optional(),
    min: z.number().optional(),
    pattern: z.string().meta({ description: 'Source pattern name' }),
    source_type: trendSourceTypeSchema,
  })
  .meta({ description: 'Progress for a trend goal', id: 'TrendGoalProgress' })

export type TrendGoalProgress = z.infer<typeof trendGoalProgressSchema>

export const measureGoalProgressSchema = z
  .object({
    activity_type: activityTypeSchema,
    activity_type_name: z.string().meta({ description: "The activity type's display name" }),
    aggregation: measureGoalAggregationSchema,
    current: z
      .number()
      .meta({ description: 'Current value within the window (0 when no session has the measure)' }),
    filter_value: z
      .string()
      .optional()
      .meta({ description: 'The item value the goal is on, e.g. an exercise' }),
    goal_type: z.literal('measure').meta({ description: 'Goal type discriminant' }),
    id: z.string().uuid().meta({ description: 'Goal ID' }),
    losing_tomorrow: z.number().meta({
      description:
        "What drops off when the oldest day leaves the window: the day's total for sum, or how far the best falls when it is only on that day for max",
    }),
    max: z.number().positive().optional(),
    measure: activityMeasureSchema,
    min: z.number().positive().optional(),
    unit: z.string().meta({ description: 'Unit of the measure (kg, s, or empty for a count)' }),
    window: durationStringSchema,
  })
  .meta({ description: 'Progress for a measure goal', id: 'MeasureGoalProgress' })

export type MeasureGoalProgress = z.infer<typeof measureGoalProgressSchema>

export const goalProgressSchema = z
  .discriminatedUnion('goal_type', [
    metricGoalProgressSchema,
    trendGoalProgressSchema,
    measureGoalProgressSchema,
  ])
  .meta({ id: 'GoalProgress' })

export type GoalProgress = z.infer<typeof goalProgressSchema>

export const goalsProgressResponseSchema = baseResponseSchema
  .extend({
    goals: z.array(goalProgressSchema).meta({ description: 'Progress for all goals' }),
  })
  .meta({ id: 'GoalsProgressResponse' })

export type GoalsProgressResponse = z.infer<typeof goalsProgressResponseSchema>

/** Flat structure — no discriminated union, so simple Kotlin data classes work. */
export const widgetGoalProgressSchema = z
  .object({
    current: z.number().meta({ description: 'Current progress value' }),
    id: z.string().uuid().meta({ description: 'Goal ID' }),
    losing_tomorrow: z.number().meta({ description: 'Value dropping off tomorrow (0 for trend goals)' }),
    max: z.number().optional(),
    min: z.number().optional(),
    title: z.string().meta({ description: 'Display title for the goal' }),
    unit: z.string().meta({ description: 'Display unit (e.g., "min", "count", "per month")' }),
  })
  .meta({ description: 'Flat goal progress for widgets', id: 'WidgetGoalProgress' })

export type WidgetGoalProgress = z.infer<typeof widgetGoalProgressSchema>

export const widgetGoalsProgressResponseSchema = baseResponseSchema
  .extend({
    goals: z.array(widgetGoalProgressSchema).meta({ description: 'Flat progress for all goals' }),
  })
  .meta({ id: 'WidgetGoalsProgressResponse' })

export const goalHistoryBucketSchema = z
  .enum(['day', 'month'])
  .meta({ description: 'History granularity: one entry per day, or per month', id: 'GoalHistoryBucket' })

export type GoalHistoryBucket = z.infer<typeof goalHistoryBucketSchema>

export const goalHistoryQuerySchema = z
  .object({
    bucket: goalHistoryBucketSchema.default('day'),
    lookback_days: z.coerce
      .number()
      .int()
      .min(1)
      .max(730)
      .default(30)
      .meta({ description: 'Completed days before today to include (today is always included as partial)' }),
  })
  .meta({ description: 'Query for a goal history', id: 'GoalHistoryQuery' })

export type GoalHistoryQuery = z.infer<typeof goalHistoryQuerySchema>

export const goalDayStatusSchema = z.enum(['below', 'met', 'over']).meta({
  description: 'over when above max, met when at or above min (or no min), else below',
  id: 'GoalDayStatus',
})

export type GoalDayStatus = z.infer<typeof goalDayStatusSchema>

export const goalHistoryDaySchema = z
  .object({
    contribution: z.number().optional().meta({ description: "The day's own sum (metric goals only)" }),
    date: z
      .string()
      .meta({ description: "Day in YYYY-MM-DD, in the user's device timezone (UTC when unset)" }),
    partial: z.boolean().meta({ description: 'True for today: the day is not over' }),
    status: goalDayStatusSchema,
    value: z.number().meta({ description: 'Goal value at the end of the day (rolling window sum or EMA)' }),
  })
  .meta({ description: "A goal's value and status on one day", id: 'GoalHistoryDay' })

export type GoalHistoryDay = z.infer<typeof goalHistoryDaySchema>

const dayCountsShape = {
  days_below: z.number().int().meta({ description: 'Completed days below target' }),
  days_met: z.number().int().meta({ description: 'Completed days on target' }),
  days_over: z.number().int().meta({ description: 'Completed days over target' }),
  days_total: z.number().int().meta({ description: 'Completed days counted' }),
}

export const goalHistoryMonthSchema = z
  .object({
    ...dayCountsShape,
    month: z
      .string()
      .meta({ description: "Month in YYYY-MM, in the user's device timezone (UTC when unset)" }),
    partial: z.boolean().meta({ description: 'True for the month containing today' }),
  })
  .meta({ description: 'Counts of completed days per status in one month', id: 'GoalHistoryMonth' })

export type GoalHistoryMonth = z.infer<typeof goalHistoryMonthSchema>

export const goalHistorySummarySchema = z
  .object(dayCountsShape)
  .meta({ description: 'Counts of completed days per status over the whole range', id: 'GoalHistorySummary' })

export type GoalHistorySummary = z.infer<typeof goalHistorySummarySchema>

export const goalHistoryResponseSchema = baseResponseSchema
  .extend({
    bucket: goalHistoryBucketSchema,
    days: z.array(goalHistoryDaySchema).optional().meta({ description: 'Per-day history (bucket=day)' }),
    goal: goalSchema,
    max: z.number().optional().meta({ description: 'Maximum target every day is judged against' }),
    min: z.number().optional().meta({ description: 'Minimum target every day is judged against' }),
    months: z
      .array(goalHistoryMonthSchema)
      .optional()
      .meta({ description: 'Per-month day counts (bucket=month)' }),
    summary: goalHistorySummarySchema,
    unit: z.string().meta({ description: 'Metric storage unit, or the trend display unit' }),
  })
  .meta({
    description:
      "A goal's value per past day, or per month as counts of on-target days; today is partial and not counted",
    id: 'GoalHistoryResponse',
  })

export type GoalHistoryResponse = z.infer<typeof goalHistoryResponseSchema>
