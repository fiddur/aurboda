/**
 * Daily summary schemas.
 */

import { z } from 'zod'

import { exerciseTypeSchema } from './activities.ts'
import {
  addressSchema,
  createDataResponseSchema,
  dateOnlySchema,
  detectedLocationIdSchema,
  durationMinutesSchema,
  iso8601DateTimeSchema,
  latSchema,
  lonSchema,
  placeSourceSchema,
} from './common.ts'
import { commentSchema, noteSchema } from './notes.ts'
import { hrZoneSecsSchema } from './settings.ts'

/**
 * Heart rate stats schema.
 */
export const heartRateStatsSchema = z
  .object({
    avg: z.number().meta({ description: 'Average heart rate', example: 72 }),
    count: z.number().int().meta({ description: 'Number of samples', example: 1440 }),
    max: z.number().meta({ description: 'Maximum heart rate', example: 165 }),
    min: z.number().meta({ description: 'Minimum heart rate', example: 52 }),
  })
  .meta({ id: 'HeartRateStats' })

export type HeartRateStats = z.infer<typeof heartRateStatsSchema>

/**
 * Stress zone seconds schema — time spent in each stress level band.
 * Based on Garmin stress levels (0-100 scale).
 */
export const stressZoneSecsSchema = z
  .object({
    high: z.number().meta({ description: 'Seconds at high stress (76-100)' }),
    low: z.number().meta({ description: 'Seconds at low stress (26-50)' }),
    medium: z.number().meta({ description: 'Seconds at medium stress (51-75)' }),
    rest: z.number().meta({ description: 'Seconds at rest/no stress (0-25)' }),
  })
  .meta({ description: 'Time spent in each stress level band', id: 'StressZoneSecs' })

export type StressZoneSecs = z.infer<typeof stressZoneSecsSchema>

/**
 * Sleep location schema — best-guess location where the person slept.
 */
export const sleepLocationSchema = z
  .object({
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    name: z.string().meta({ description: 'Location name', example: 'Home' }),
    source: placeSourceSchema,
  })
  .meta({ description: 'Best-guess location where the person slept', id: 'SleepLocation' })

export type SleepLocation = z.infer<typeof sleepLocationSchema>

/**
 * Sleep stage summary — minutes spent in each named sleep stage.
 */
export const sleepStageSummarySchema = z
  .object({
    awake_min: z.number().optional().meta({ description: 'Minutes spent awake during sleep session' }),
    deep_min: z.number().optional().meta({ description: 'Minutes of deep (N3/slow-wave) sleep' }),
    light_min: z.number().optional().meta({ description: 'Minutes of light (N1/N2) sleep' }),
    rem_min: z.number().optional().meta({ description: 'Minutes of REM sleep' }),
  })
  .meta({ description: 'Time spent in each sleep stage', id: 'SleepStageSummary' })

export type SleepStageSummary = z.infer<typeof sleepStageSummarySchema>

/**
 * Sleep session summary schema — extends session summary with sleep-specific fields.
 */
export const sleepSessionSummarySchema = z
  .object({
    duration: durationMinutesSchema.optional(),
    end_time: iso8601DateTimeSchema.optional(),
    sleep_date: dateOnlySchema.optional().meta({
      description:
        'The date this sleep "belongs to", using wake-up convention (the date the user woke up). E.g. sleep starting 2026-03-07T23:00Z and ending 2026-03-08T07:00Z has sleep_date 2026-03-08.',
    }),
    sleep_location: sleepLocationSchema.optional().meta({
      description: 'Best-guess location where the person slept during this session',
    }),
    sleep_stages: sleepStageSummarySchema.optional().meta({
      description: 'Minutes spent in each sleep stage (awake, light, deep, REM)',
    }),
    start_time: iso8601DateTimeSchema,
    time_in_bed: durationMinutesSchema.optional().meta({
      description: 'Total time in bed in minutes (end_time - start_time)',
    }),
    total_sleep: durationMinutesSchema.optional().meta({
      description: 'Actual sleep time in minutes (excluding awake periods), from sleep stage data',
    }),
  })
  .meta({ description: 'Sleep session with location and date attribution', id: 'SleepSessionSummary' })

export type SleepSessionSummary = z.infer<typeof sleepSessionSummarySchema>

/**
 * Activity summary schema — unified activity in the daily timeline.
 * Covers exercises, meditations, tags, screen time categories, and all other activities.
 */
export const activitySummarySchema = z
  .object({
    activity_type: z
      .string()
      .meta({ description: 'Activity type (e.g., "exercise", "meditation", "screentime", "coffee")' }),
    category_path: z.array(z.string()).optional().meta({
      description:
        'Screen time category path (e.g., ["Work & Dev", "Software Dev"]). Only present for screentime activities.',
    }),
    comments: z.array(commentSchema).optional().meta({ description: 'Comments attached to this activity' }),
    end_time: iso8601DateTimeSchema.optional(),
    exercise_type: exerciseTypeSchema.optional().meta({
      description:
        'Human-readable exercise type name (e.g., "yoga", "running"). Only present for exercise activities.',
    }),
    hr_zone_secs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone during this activity',
    }),
    start_time: iso8601DateTimeSchema,
    stress_zone_secs: stressZoneSecsSchema.optional().meta({
      description: 'Time spent in each stress level band during this activity',
    }),
    title: z.string().optional().meta({ description: 'Activity title or display name' }),
  })
  .meta({ description: 'A single activity in the daily timeline', id: 'ActivitySummary' })

export type ActivitySummary = z.infer<typeof activitySummarySchema>

/**
 * Place summary schema.
 */
export const placeSummarySchema = z
  .object({
    address: addressSchema.optional(),
    detected_location_id: detectedLocationIdSchema.optional(),
    duration: durationMinutesSchema,
    end_time: iso8601DateTimeSchema,
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    name: z.string().meta({ description: 'Place name', example: 'Home' }),
    source: placeSourceSchema,
    start_time: iso8601DateTimeSchema,
  })
  .meta({ id: 'PlaceSummary' })

export type PlaceSummary = z.infer<typeof placeSummarySchema>

/**
 * Productivity summary schema.
 */
export const screentimeCategorySummarySchema = z
  .object({
    duration_sec: z.number().meta({ description: 'Total time in this category in seconds' }),
    path: z
      .array(z.string())
      .meta({ description: 'Category path, e.g. ["Work", "Programming"]. Empty array means uncategorized.' }),
  })
  .meta({ id: 'ScreentimeCategorySummary' })

export type ScreentimeCategorySummary = z.infer<typeof screentimeCategorySummarySchema>

export const productivitySummarySchema = z
  .object({
    categories: z
      .array(screentimeCategorySummarySchema)
      .optional()
      .meta({ description: 'Screen time broken down by category, sorted by duration descending' }),
    distracting_sec: z.number().meta({ description: 'Distracting time in seconds' }),
    productive_sec: z.number().meta({ description: 'Productive time in seconds' }),
    total_duration_sec: z.number().meta({ description: 'Total tracked time in seconds' }),
    very_productive_sec: z.number().meta({ description: 'Very productive time in seconds' }),
  })
  .meta({ id: 'ProductivitySummary' })

export type ProductivitySummary = z.infer<typeof productivitySummarySchema>

/**
 * Oura scores schema.
 */
export const ouraScoresSchema = z
  .object({
    cardiovascular_age: z.number().nullable().meta({ description: 'Oura cardiovascular age' }),
    readiness_score: z.number().nullable().meta({ description: 'Oura readiness score (0-100)' }),
    resilience_score: z.number().nullable().meta({ description: 'Oura resilience score (0-100)' }),
    sleep_score: z.number().nullable().meta({
      description: 'Oura sleep score (0-100). Evaluates the primary sleep session for this date.',
    }),
  })
  .meta({ id: 'OuraScores' })

export type OuraScores = z.infer<typeof ouraScoresSchema>

/**
 * Meal summary schema — lightweight meal info for daily summary.
 */
export const mealSummarySchema = z
  .object({
    calories: z.number().optional().meta({ description: 'Total energy in kcal' }),
    carbs: z.number().optional().meta({ description: 'Total carbohydrates in grams' }),
    fat: z.number().optional().meta({ description: 'Total fat in grams' }),
    fiber: z.number().optional().meta({ description: 'Total dietary fiber in grams' }),
    food_items: z.array(z.string()).optional().meta({ description: 'Food item names included in this meal' }),
    meal_type: z
      .string()
      .optional()
      .meta({ description: 'Meal type (e.g., "breakfast", "lunch", "dinner")' }),
    name: z.string().optional().meta({ description: 'Meal name/description' }),
    protein: z.number().optional().meta({ description: 'Total protein in grams' }),
    time: iso8601DateTimeSchema.meta({ description: 'When the meal was consumed' }),
  })
  .meta({ description: 'Lightweight meal summary for daily overview', id: 'MealSummary' })

export type MealSummary = z.infer<typeof mealSummarySchema>

/**
 * Daily summary result schema.
 */
export const dailySummaryResultSchema = z
  .object({
    activities: z.array(activitySummarySchema).meta({
      description:
        'Unified chronological timeline of all activities: exercises, meditations, screen time categories, custom activities, etc. Sorted by start_time. Screen time entries have category_path set. Exercise entries have exercise_type and hr_zone_secs. Activities with stress data have stress_zone_secs.',
    }),
    date: dateOnlySchema,
    heart_rate: heartRateStatsSchema.nullable(),
    meals: z.array(mealSummarySchema).meta({
      description: 'Meals logged on this day, with macros and food item names',
    }),
    notes: z.array(noteSchema).meta({
      description:
        'Notes not attached to any activity in the activities list (orphaned or non-activity notes)',
    }),
    oura_scores: ouraScoresSchema.nullable().meta({
      description: 'Oura scores for this date.',
    }),
    places: z.array(placeSummarySchema),
    productivity: productivitySummarySchema.nullable(),
    sleep_sessions: z.array(sleepSessionSummarySchema).meta({
      description:
        'All sleep sessions overlapping this date, with sleep stages, location, and date attribution.',
    }),
    steps: z.object({
      total: z.number().meta({ description: 'Total steps for the day' }),
    }),
    stress_zones: stressZoneSecsSchema.nullable().meta({
      description: 'Day-level stress zone summary — total seconds in each stress band for the whole day',
    }),
  })
  .meta({ id: 'DailySummaryResult' })

export type DailySummaryResult = z.infer<typeof dailySummaryResultSchema>

/**
 * Daily summary response schema (API wrapper).
 */
export const dailySummaryResponseSchema = createDataResponseSchema(dailySummaryResultSchema).meta({
  id: 'DailySummaryResponse',
})

export type DailySummaryResponse = z.infer<typeof dailySummaryResponseSchema>

/**
 * Daily summary query schema.
 */
export const dailySummaryQuerySchema = z
  .object({
    date: dateOnlySchema.meta({ description: 'Date in YYYY-MM-DD format' }),
  })
  .meta({ id: 'DailySummaryQuery' })

export type DailySummaryQuery = z.infer<typeof dailySummaryQuerySchema>
