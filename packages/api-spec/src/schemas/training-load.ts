/**
 * Training load schemas for the Banister impulse-response model.
 *
 * Storage:
 *   Two metrics in time_series:
 *   - `training_impulse` — TRIMP from exercise sessions (HR-based or duration estimate; see TrimpBasis)
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
 */

import { z } from 'zod'

import { baseResponseSchema } from './common.ts'
import { ianaTimezoneSchema } from './timezone.ts'

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
    impulse_computed_from: z.string().optional().meta({
      description:
        'Internal: ISO 8601 start of the earliest hour the stored impulse buckets cover. A read of a longer range fills in the hours before it.',
    }),
    impulse_dirty_rev: z.number().int().optional().meta({
      description:
        'Internal: counts the times stored impulse hours were marked dirty, so a recompute in progress sees a mark made while it ran.',
    }),
    impulse_recompute_lease: z
      .object({
        holder: z.string(),
        until: z.string(),
      })
      .optional()
      .meta({
        description:
          'Internal: the backend process recomputing the impulse buckets and when its claim expires (ISO 8601), so one process recomputes a user at a time.',
      }),
    impulse_version: z.number().int().optional().meta({
      description:
        'Internal: version of the rules the stored impulse buckets were computed with. When it is behind the server, the buckets are recomputed from the first workout on the next read.',
    }),
    impulse_watermark: z.string().optional().meta({
      description:
        'Internal: ISO 8601 timestamp of the earliest hour that needs recomputation. Set when new data arrives retroactively.',
    }),
    k_factor: z.number().positive().optional().meta({
      description: 'TRIMP sex-dependent constant (1.92 for males, 1.67 for females). Defaults to 1.92.',
    }),
    observed_hr_max: z.number().int().positive().max(250).optional().meta({
      description:
        'Internal: cached maximum observed heart rate (bpm). Updated during impulse recomputation to avoid expensive 1-year scans.',
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
  .meta({ description: 'User-configurable training load parameters', id: 'TrainingLoadSettings' })

export type TrainingLoadSettings = z.infer<typeof trainingLoadSettingsSchema>

/**
 * The fields of `TrainingLoadSettings` the server keeps for itself (their descriptions start with
 * "Internal:"); a settings update from a client never changes them.
 */
export const trainingLoadInternalFields = [
  'impulse_computed_from',
  'impulse_dirty_rev',
  'impulse_recompute_lease',
  'impulse_version',
  'impulse_watermark',
  'observed_hr_max',
] as const satisfies readonly (keyof TrainingLoadSettings)[]

/** Larger buckets reduce payload size for long ranges. */
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
    tz: ianaTimezoneSchema.optional().meta({
      description:
        'IANA timezone for bucket alignment (e.g. "Europe/Stockholm"). ' +
        'Daily/weekly buckets align to local midnight/Monday. Defaults to UTC.',
      example: 'Europe/Stockholm',
    }),
  })
  .meta({ description: 'Query parameters for training load time series', id: 'TrainingLoadQuery' })

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
    tz: ianaTimezoneSchema.optional().meta({
      description:
        'IANA timezone for bucket alignment (e.g. "Europe/Stockholm"). ' +
        'Daily/weekly buckets align to local midnight/Monday. Defaults to UTC.',
      example: 'Europe/Stockholm',
    }),
  })
  .meta({ description: 'Input for computing training load time series', id: 'GetTrainingLoadInput' })

export type GetTrainingLoadInput = z.infer<typeof getTrainingLoadInputSchema>

export const trimpBasisSchema = z.enum(['hr', 'duration_estimate']).meta({
  description:
    'What a workout TRIMP is computed from: hr (average heart rate during the workout) or duration_estimate (no usable heart rate, so duration × 0.5)',
  id: 'TrimpBasis',
})

export type TrimpBasis = z.infer<typeof trimpBasisSchema>

export const workoutTrimpSchema = z
  .object({
    activity_id: z
      .string()
      .optional()
      .meta({ description: 'Activity UUID if linked to an exercise session' }),
    activity_type: z.string().meta({
      description:
        'Activity type of the session (a name from list_activity_types), e.g. running, yoga, strength_training',
    }),
    avg_hr: z.number().optional().meta({ description: 'Average heart rate during workout (bpm)' }),
    date: z.string().meta({ description: 'Date of the workout (YYYY-MM-DD)' }),
    duration_minutes: z.number().meta({ description: 'Workout duration in minutes' }),
    end_time: z.string().meta({ description: 'Workout end time (ISO 8601)' }),
    start_time: z.string().meta({ description: 'Workout start time (ISO 8601)' }),
    title: z.string().optional().meta({
      description:
        'Session title; without one, the display name of its activity type (absent for the generic exercise type)',
    }),
    trimp: z.number().meta({ description: 'Training Impulse score for this workout' }),
    trimp_basis: trimpBasisSchema,
  })
  .meta({ description: 'TRIMP score for a single workout session', id: 'WorkoutTrimp' })

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
  .meta({ description: 'ATL, CTL, TSB, and impulse values per time bucket', id: 'TrainingLoadPoint' })

export type TrainingLoadPoint = z.infer<typeof trainingLoadPointSchema>

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

export const trainingImpulseBasisSchema = z
  .object({
    estimated_share: z.number().nullable().meta({
      description:
        'estimated_trimp / trimp (0-1): how much of the workout TRIMP is estimated from duration; null without workout TRIMP',
    }),
    estimated_trimp: z.number().meta({ description: 'Summed TRIMP of the workouts estimated from duration' }),
    estimated_workouts: z.number().int().meta({
      description: 'Workouts whose TRIMP is estimated from duration (trimp_basis duration_estimate)',
    }),
    trimp: z.number().meta({ description: 'Summed TRIMP of all workouts in the range' }),
    workouts: z.number().int().meta({ description: 'Workouts in the range' }),
  })
  .meta({
    description:
      'How much of the workout TRIMP in the requested range is estimated from duration rather than computed from heart rate',
    id: 'TrainingImpulseBasis',
  })

export type TrainingImpulseBasis = z.infer<typeof trainingImpulseBasisSchema>

export const trainingLoadResultSchema = z
  .object({
    bootstrapping: z
      .boolean()
      .meta({ description: 'True if < 6 weeks of data, meaning CTL may not yet be meaningful' }),
    estimated_impulse: trainingImpulseBasisSchema,
    points: z
      .array(trainingLoadPointSchema)
      .meta({ description: 'Training load time series (granularity depends on bucket_size parameter)' }),
    recomputing: z.boolean().optional().meta({
      description:
        'True while the stored hours are being recomputed in the background (after old data arrived or a rule changed): points is empty and zones is absent. Ask again in a few seconds. Absent otherwise.',
    }),
    settings: trainingLoadSettingsSchema.meta({ description: 'Effective settings used for computation' }),
    workouts: z.array(workoutTrimpSchema).meta({ description: 'Per-workout TRIMP scores in the range' }),
    zones: recoveryZonesSchema
      .optional()
      .meta({ description: 'Recovery zone thresholds (absent during bootstrapping)' }),
  })
  .meta({ description: 'Training load computation result', id: 'TrainingLoadResult' })

export type TrainingLoadResult = z.infer<typeof trainingLoadResultSchema>

export const trainingLoadResponseSchema = baseResponseSchema
  .extend({
    data: trainingLoadResultSchema.optional(),
  })
  .meta({ id: 'TrainingLoadResponse' })

export type TrainingLoadResponse = z.infer<typeof trainingLoadResponseSchema>
