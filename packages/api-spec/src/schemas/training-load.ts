/**
 * Training load schemas for the Banister impulse-response model.
 *
 * PLAN:
 * ─────────────────────────────────────────────────────────────────────────────
 * Storage:
 *   Two metrics in time_series:
 *   - `training_impulse` — TRIMP from exercise sessions (HR-based or duration fallback)
 *   - `activity_impulse` — Scaled active calories from general movement
 *   Each row = one completed hour (timestamp = start of hour, value = total impulse).
 *
 * Write path (after sync):
 *   1. Determine which completed hours are affected by new data
 *   2. For each affected completed hour:
 *      - Training impulse: exercises overlapping that hour → per-hour TRIMP
 *      - Activity impulse: sum calories_active in that hour × scaling factor
 *   3. Upsert into time_series
 *   4. Skip the current (incomplete) hour — computed at query time
 *   5. Track a watermark (earliest-dirty-hour) per user in settings
 *
 * Read path (query):
 *   1. Fetch hourly impulse buckets from (start − 3×τ_chronic_hours) to end
 *   2. For the current incomplete hour: compute on-the-fly from raw data
 *   3. Run hourly Banister EMA → ATL, CTL, TSB per hour
 *   4. Return hourly points + zone thresholds + workout list
 *
 * Frontend:
 *   Stacked bar chart per hour (Polar-style):
 *   - Red/purple bars: training impulse
 *   - Blue bars: activity impulse
 *   - Decaying grey area: accumulated past load (CTL curve)
 *   - Horizontal zone bands: Undertrained / Balanced / Strained / Very Strained
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { z } from 'zod'
import { baseResponseSchema } from './common.js'

// ============================================================================
// Training Load Settings
// ============================================================================

/**
 * Training load configuration stored in user settings.
 */
export const trainingLoadSettingsSchema = z
  .object({
    activity_impulse_scale: z.number().positive().optional().meta({
      description:
        'Scale factor to convert active calories to impulse. Defaults to 0.1 (100 kcal → 10 impulse).',
    }),
    hr_max: z
      .number()
      .int()
      .positive()
      .max(250)
      .optional()
      .meta({ description: 'Maximum heart rate override (bpm). Falls back to observed max, then 220-age.' }),
    hr_rest: z.number().int().positive().max(120).optional().meta({
      description: 'Resting heart rate override (bpm). Falls back to most recent resting HR metric.',
    }),
    impulse_watermark: z.string().optional().meta({
      description:
        'ISO 8601 timestamp of the earliest hour that needs recomputation. Set when new data arrives retroactively.',
    }),
    k_factor: z.number().positive().optional().meta({
      description: 'TRIMP sex-dependent constant (1.92 for males, 1.67 for females). Defaults to 1.92.',
    }),
    tau_acute: z
      .number()
      .positive()
      .optional()
      .meta({ description: 'Acute (fatigue) time constant in days. Defaults to 7.' }),
    tau_chronic: z
      .number()
      .positive()
      .optional()
      .meta({ description: 'Chronic (fitness) time constant in days. Defaults to 42.' }),
  })
  .meta({ id: 'TrainingLoadSettings', description: 'User-configurable training load parameters' })

export type TrainingLoadSettings = z.infer<typeof trainingLoadSettingsSchema>

// ============================================================================
// Query / Response
// ============================================================================

/**
 * Query parameters for the training load endpoint.
 */
/**
 * Valid bucket sizes for training load aggregation.
 * Default is '1h' (hourly). Larger buckets reduce payload size for long ranges.
 */
export const trainingLoadBucketSizes = ['1h', '1d', '1w'] as const
export type TrainingLoadBucketSize = (typeof trainingLoadBucketSizes)[number]

export const trainingLoadQuerySchema = z
  .object({
    bucket_size: z.enum(trainingLoadBucketSizes).optional().meta({
      description:
        "Aggregation bucket size: '1h' (default, hourly), '1d' (daily), '1w' (weekly). Larger buckets reduce response size for long date ranges.",
    }),
    end: z.string().meta({ description: 'End date in ISO 8601 format' }),
    start: z.string().meta({ description: 'Start date in ISO 8601 format' }),
  })
  .meta({ id: 'TrainingLoadQuery', description: 'Query parameters for training load time series' })

export type TrainingLoadQuery = z.infer<typeof trainingLoadQuerySchema>

/**
 * Query schema for MCP / service layer (parsed dates and optional overrides).
 */
export const getTrainingLoadInputSchema = z
  .object({
    bucket_size: z.enum(trainingLoadBucketSizes).optional().meta({
      description:
        "Aggregation bucket size: '1h' (default, hourly), '1d' (daily), '1w' (weekly). Larger buckets reduce response size for long date ranges.",
    }),
    end: z.iso.datetime().meta({ description: 'End date-time in ISO 8601 format' }),
    start: z.iso.datetime().meta({ description: 'Start date-time in ISO 8601 format' }),
  })
  .meta({ id: 'GetTrainingLoadInput', description: 'Input for computing training load time series' })

export type GetTrainingLoadInput = z.infer<typeof getTrainingLoadInputSchema>

/**
 * A single workout's TRIMP score.
 */
export const workoutTrimpSchema = z
  .object({
    activity_id: z
      .string()
      .optional()
      .meta({ description: 'Activity UUID if linked to an exercise session' }),
    avg_hr: z.number().optional().meta({ description: 'Average heart rate during workout (bpm)' }),
    date: z.string().meta({ description: 'Date of the workout (YYYY-MM-DD)' }),
    duration_minutes: z.number().meta({ description: 'Workout duration in minutes' }),
    end_time: z.string().meta({ description: 'Workout end time (ISO 8601)' }),
    start_time: z.string().meta({ description: 'Workout start time (ISO 8601)' }),
    title: z.string().optional().meta({ description: 'Workout title / exercise type' }),
    trimp: z.number().meta({ description: 'Training Impulse score for this workout' }),
  })
  .meta({ id: 'WorkoutTrimp', description: 'TRIMP score for a single workout session' })

export type WorkoutTrimp = z.infer<typeof workoutTrimpSchema>

/**
 * A single training load point (hourly, daily, or weekly depending on bucket_size).
 */
export const trainingLoadPointSchema = z
  .object({
    activity_impulse: z.number().meta({
      description: 'Activity impulse (scaled active calories) for this bucket — summed when aggregated',
    }),
    atl: z.number().meta({ description: 'Acute Training Load (fatigue) — peak ATL within the bucket' }),
    ctl: z.number().meta({ description: 'Chronic Training Load (fitness) — value at end of bucket' }),
    time: z.string().meta({ description: 'Bucket start time (ISO 8601)' }),
    training_impulse: z
      .number()
      .meta({ description: 'Training impulse (exercise TRIMP) for this bucket — summed when aggregated' }),
    tsb: z
      .number()
      .meta({ description: 'Training Stress Balance (form) = CTL - ATL, value at end of bucket' }),
  })
  .meta({ id: 'TrainingLoadPoint', description: 'ATL, CTL, TSB, and impulse values per time bucket' })

export type TrainingLoadPoint = z.infer<typeof trainingLoadPointSchema>

// ============================================================================
// Recovery Zones
// ============================================================================

/**
 * Recovery zone thresholds. Boundaries for the horizontal zone bands.
 * Zone is determined by the combined load (ATL + residual CTL contribution).
 */
export const recoveryZonesSchema = z
  .object({
    balanced_max: z.number().meta({ description: 'Upper bound of Balanced zone (ATL value)' }),
    balanced_min: z.number().meta({ description: 'Lower bound of Balanced zone (ATL value)' }),
    strained_max: z.number().meta({ description: 'Upper bound of Strained zone (ATL value)' }),
  })
  .meta({
    description:
      'Zone thresholds based on ATL: below balanced_min = Undertrained, balanced = optimal, above strained_max = Very Strained',
    id: 'RecoveryZones',
  })

export type RecoveryZones = z.infer<typeof recoveryZonesSchema>

// ============================================================================
// Full Result
// ============================================================================

/**
 * Full training load response.
 */
export const trainingLoadResultSchema = z
  .object({
    bootstrapping: z
      .boolean()
      .meta({ description: 'True if < 6 weeks of data, meaning CTL may not yet be meaningful' }),
    points: z
      .array(trainingLoadPointSchema)
      .meta({ description: 'Training load time series (granularity depends on bucket_size parameter)' }),
    settings: trainingLoadSettingsSchema.meta({ description: 'Effective settings used for computation' }),
    workouts: z.array(workoutTrimpSchema).meta({ description: 'Per-workout TRIMP scores in the range' }),
    zones: recoveryZonesSchema
      .optional()
      .meta({ description: 'Recovery zone thresholds (absent during bootstrapping)' }),
  })
  .meta({ id: 'TrainingLoadResult', description: 'Training load computation result' })

export type TrainingLoadResult = z.infer<typeof trainingLoadResultSchema>

/**
 * Response schema for training load endpoint.
 */
export const trainingLoadResponseSchema = baseResponseSchema
  .extend({
    data: trainingLoadResultSchema.optional(),
  })
  .meta({ id: 'TrainingLoadResponse' })

export type TrainingLoadResponse = z.infer<typeof trainingLoadResponseSchema>
