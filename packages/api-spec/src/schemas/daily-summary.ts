/**
 * Daily summary schemas.
 */

import { z } from 'zod'
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
  tagTextSchema,
} from './common.js'
import { commentSchema, noteSchema } from './notes.js'
import { hrZoneSecsSchema } from './settings.js'

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
 * Session summary schema (for sleep, exercise, meditation).
 */
export const sessionSummarySchema = z
  .object({
    data: z.record(z.string(), z.unknown()).optional(),
    duration: durationMinutesSchema.optional(),
    end_time: iso8601DateTimeSchema.optional(),
    hr_zone_secs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone during session',
    }),
    start_time: iso8601DateTimeSchema,
    title: z.string().optional().meta({ description: 'Session title' }),
  })
  .meta({ id: 'SessionSummary' })

export type SessionSummary = z.infer<typeof sessionSummarySchema>

/**
 * Tag summary schema.
 */
export const tagSummarySchema = z
  .object({
    comments: z.array(commentSchema).optional().meta({ description: 'Comments attached to this tag' }),
    end_time: iso8601DateTimeSchema.optional(),
    start_time: iso8601DateTimeSchema,
    tag: tagTextSchema,
  })
  .meta({ id: 'TagSummary' })

export type TagSummary = z.infer<typeof tagSummarySchema>

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
export const productivitySummarySchema = z
  .object({
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
    sleep_score: z.number().nullable().meta({ description: 'Oura sleep score (0-100)' }),
  })
  .meta({ id: 'OuraScores' })

export type OuraScores = z.infer<typeof ouraScoresSchema>

/**
 * Daily summary result schema.
 */
export const dailySummaryResultSchema = z
  .object({
    date: dateOnlySchema,
    exercise_sessions: z.array(sessionSummarySchema),
    heart_rate: heartRateStatsSchema.nullable(),
    notes: z.array(noteSchema).meta({
      description: 'All notes whose time range overlaps this day, across all entity types',
    }),
    oura_scores: ouraScoresSchema.nullable(),
    places: z.array(placeSummarySchema),
    productivity: productivitySummarySchema.nullable(),
    sleep_sessions: z.array(sessionSummarySchema),
    steps: z.object({
      total: z.number().meta({ description: 'Total steps for the day' }),
    }),
    tags: z.array(tagSummarySchema),
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
