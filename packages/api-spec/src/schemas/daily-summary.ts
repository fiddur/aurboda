/**
 * Daily summary schemas.
 */

import { z } from 'zod'
import { dateOnlySchema, iso8601DateTimeSchema, placeSourceSchema } from './common.js'
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
    duration: z.number().optional().meta({ description: 'Duration in minutes' }),
    endTime: iso8601DateTimeSchema.optional(),
    hrZoneSecs: hrZoneSecsSchema.optional().meta({
      description: 'Time spent in each HR zone during session',
    }),
    startTime: iso8601DateTimeSchema,
    title: z.string().optional().meta({ description: 'Session title' }),
  })
  .meta({ id: 'SessionSummary' })

export type SessionSummary = z.infer<typeof sessionSummarySchema>

/**
 * Tag summary schema.
 */
export const tagSummarySchema = z
  .object({
    endTime: iso8601DateTimeSchema.optional(),
    startTime: iso8601DateTimeSchema,
    tag: z.string().meta({ description: 'Tag/label text', example: 'coffee' }),
  })
  .meta({ id: 'TagSummary' })

export type TagSummary = z.infer<typeof tagSummarySchema>

/**
 * Place summary schema.
 */
export const placeSummarySchema = z
  .object({
    address: z.string().optional().meta({ description: 'Geocoded address' }),
    detectedLocationId: z.string().uuid().optional().meta({
      description: 'ID of detected location if source is detected',
    }),
    duration: z.number().meta({ description: 'Duration in minutes' }),
    endTime: iso8601DateTimeSchema,
    lat: z.number().optional().meta({ description: 'Latitude' }),
    lon: z.number().optional().meta({ description: 'Longitude' }),
    name: z.string().meta({ description: 'Place name', example: 'Home' }),
    source: placeSourceSchema,
    startTime: iso8601DateTimeSchema,
  })
  .meta({ id: 'PlaceSummary' })

export type PlaceSummary = z.infer<typeof placeSummarySchema>

/**
 * Productivity summary schema.
 */
export const productivitySummarySchema = z
  .object({
    distractingSec: z.number().meta({ description: 'Distracting time in seconds' }),
    productiveSec: z.number().meta({ description: 'Productive time in seconds' }),
    totalDurationSec: z.number().meta({ description: 'Total tracked time in seconds' }),
    veryProductiveSec: z.number().meta({ description: 'Very productive time in seconds' }),
  })
  .meta({ id: 'ProductivitySummary' })

export type ProductivitySummary = z.infer<typeof productivitySummarySchema>

/**
 * Oura scores schema.
 */
export const ouraScoresSchema = z
  .object({
    cardiovascularAge: z.number().nullable().meta({ description: 'Oura cardiovascular age' }),
    readinessScore: z.number().nullable().meta({ description: 'Oura readiness score (0-100)' }),
    resilienceScore: z.number().nullable().meta({ description: 'Oura resilience score (0-100)' }),
    sleepScore: z.number().nullable().meta({ description: 'Oura sleep score (0-100)' }),
  })
  .meta({ id: 'OuraScores' })

export type OuraScores = z.infer<typeof ouraScoresSchema>

/**
 * Daily summary result schema.
 */
export const dailySummaryResultSchema = z
  .object({
    date: dateOnlySchema,
    exerciseSessions: z.array(sessionSummarySchema),
    heartRate: heartRateStatsSchema.nullable(),
    ouraScores: ouraScoresSchema.nullable(),
    places: z.array(placeSummarySchema),
    productivity: productivitySummarySchema.nullable(),
    sleepSessions: z.array(sessionSummarySchema),
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
export const dailySummaryResponseSchema = z
  .object({
    data: dailySummaryResultSchema.optional(),
    error: z.string().optional(),
    success: z.boolean(),
  })
  .meta({ id: 'DailySummaryResponse' })

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
