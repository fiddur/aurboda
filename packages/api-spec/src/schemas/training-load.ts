/**
 * Training load schemas for the Banister impulse-response model.
 *
 * Computes TRIMP (Training Impulse) from workout HR data and models
 * Acute Training Load (ATL / fatigue) and Chronic Training Load (CTL / fitness)
 * as exponentially decaying loads. The difference (TSB = CTL - ATL) is the
 * Training Stress Balance ("form").
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
    hr_max: z
      .number()
      .int()
      .positive()
      .max(250)
      .optional()
      .meta({ description: 'Maximum heart rate override (bpm). Falls back to observed max, then 220-age.' }),
    hr_rest: z
      .number()
      .int()
      .positive()
      .max(120)
      .optional()
      .meta({
        description: 'Resting heart rate override (bpm). Falls back to most recent resting HR metric.',
      }),
    k_factor: z
      .number()
      .positive()
      .default(1.92)
      .meta({ description: 'TRIMP sex-dependent constant (1.92 for males, 1.67 for females)' }),
    tau_acute: z
      .number()
      .positive()
      .default(7)
      .meta({ description: 'Acute (fatigue) time constant in days. Classic default: 7.' }),
    tau_chronic: z
      .number()
      .positive()
      .default(42)
      .meta({ description: 'Chronic (fitness) time constant in days. Classic default: 42.' }),
  })
  .meta({ id: 'TrainingLoadSettings', description: 'User-configurable training load parameters' })

export type TrainingLoadSettings = z.infer<typeof trainingLoadSettingsSchema>

// ============================================================================
// Query / Response
// ============================================================================

/**
 * Query parameters for the training load endpoint.
 */
export const trainingLoadQuerySchema = z
  .object({
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
 * A single day's training load point.
 */
export const trainingLoadPointSchema = z
  .object({
    atl: z.number().meta({ description: 'Acute Training Load (fatigue)' }),
    ctl: z.number().meta({ description: 'Chronic Training Load (fitness)' }),
    date: z.string().meta({ description: 'Date (YYYY-MM-DD)' }),
    daily_trimp: z.number().meta({ description: 'Total TRIMP for this day' }),
    tsb: z.number().meta({ description: 'Training Stress Balance (form) = CTL - ATL' }),
  })
  .meta({ id: 'TrainingLoadPoint', description: 'Daily ATL, CTL, and TSB values' })

export type TrainingLoadPoint = z.infer<typeof trainingLoadPointSchema>

/**
 * Full training load response.
 */
export const trainingLoadResultSchema = z
  .object({
    bootstrapping: z
      .boolean()
      .meta({ description: 'True if < 6 weeks of data, meaning CTL may not yet be meaningful' }),
    data_days: z.number().int().meta({ description: 'Number of days with workout data in the range' }),
    points: z.array(trainingLoadPointSchema).meta({ description: 'Daily training load time series' }),
    settings: trainingLoadSettingsSchema.meta({ description: 'Effective settings used for computation' }),
    workouts: z.array(workoutTrimpSchema).meta({ description: 'Per-workout TRIMP scores' }),
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
