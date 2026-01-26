/**
 * Locations schemas.
 */

import { z } from 'zod'
import { geocodeStatusSchema, iso8601DateTimeSchema, placeSourceSchema } from './common.js'

/**
 * Named location schema.
 */
export const namedLocationSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Location ID' }),
    name: z.string().meta({ description: 'Location name', example: 'Home' }),
    lat: z.number().meta({ description: 'Latitude', example: 59.3293 }),
    lon: z.number().meta({ description: 'Longitude', example: 18.0686 }),
    radius: z.number().int().meta({ description: 'Radius in meters', example: 200 }),
  })
  .meta({ id: 'NamedLocation' })

export type NamedLocation = z.infer<typeof namedLocationSchema>

/**
 * Detected location schema.
 */
export const detectedLocationSchema = z
  .object({
    id: z.string().uuid().meta({ description: 'Location ID' }),
    lat: z.number().meta({ description: 'Latitude' }),
    lon: z.number().meta({ description: 'Longitude' }),
    radius: z.number().int().meta({ description: 'Radius in meters' }),
    totalMinutes: z.number().meta({ description: 'Total time spent at location' }),
    visitCount: z.number().int().meta({ description: 'Number of visits' }),
    firstVisit: iso8601DateTimeSchema.meta({ description: 'First visit time' }),
    lastVisit: iso8601DateTimeSchema.meta({ description: 'Last visit time' }),
    address: z.string().nullable().meta({ description: 'Geocoded address' }),
    geocodeStatus: geocodeStatusSchema,
  })
  .meta({ id: 'DetectedLocation' })

export type DetectedLocation = z.infer<typeof detectedLocationSchema>

/**
 * Place visit schema.
 */
export const placeVisitSchema = z
  .object({
    name: z.string().meta({ description: 'Place name' }),
    lat: z.number().optional().meta({ description: 'Latitude' }),
    lon: z.number().optional().meta({ description: 'Longitude' }),
    startTime: iso8601DateTimeSchema,
    endTime: iso8601DateTimeSchema,
    duration: z.number().meta({ description: 'Duration in minutes' }),
    source: placeSourceSchema,
    address: z.string().optional().meta({ description: 'Geocoded address' }),
    detectedLocationId: z.string().uuid().optional().meta({
      description: 'ID of detected location if source is detected',
    }),
  })
  .meta({ id: 'PlaceVisit' })

export type PlaceVisit = z.infer<typeof placeVisitSchema>

/**
 * Locations query schema.
 */
export const locationsQuerySchema = z
  .object({
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
  })
  .meta({ id: 'LocationsQuery' })

export type LocationsQuery = z.infer<typeof locationsQuerySchema>

/**
 * Locations response schema (place visits).
 */
export const locationsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(placeVisitSchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'LocationsResponse' })

export type LocationsResponse = z.infer<typeof locationsResponseSchema>

/**
 * Named locations response schema.
 */
export const namedLocationsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(namedLocationSchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'NamedLocationsResponse' })

export type NamedLocationsResponse = z.infer<typeof namedLocationsResponseSchema>

/**
 * Detected locations response schema.
 */
export const detectedLocationsResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(detectedLocationSchema).optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'DetectedLocationsResponse' })

export type DetectedLocationsResponse = z.infer<typeof detectedLocationsResponseSchema>

/**
 * Detected locations query schema.
 */
export const detectedLocationsQuerySchema = z
  .object({
    start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
    end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
    min_duration: z.coerce.number().optional().meta({
      description: 'Minimum stay duration in minutes',
      example: 60,
    }),
  })
  .meta({ id: 'DetectedLocationsQuery' })

export type DetectedLocationsQuery = z.infer<typeof detectedLocationsQuerySchema>

/**
 * Add named location body.
 */
export const addNamedLocationBodySchema = z
  .object({
    name: z.string().min(1).meta({ description: 'Location name', example: 'Office' }),
    lat: z.number().min(-90).max(90).meta({ description: 'Latitude' }),
    lon: z.number().min(-180).max(180).meta({ description: 'Longitude' }),
    radius: z.number().int().positive().optional().meta({
      description: 'Radius in meters (defaults to 200)',
    }),
  })
  .meta({ id: 'AddNamedLocationBody' })

export type AddNamedLocationBody = z.infer<typeof addNamedLocationBodySchema>

/**
 * Add named location response.
 */
export const addNamedLocationResponseSchema = z
  .object({
    success: z.boolean(),
    data: namedLocationSchema.optional(),
    error: z.string().optional(),
  })
  .meta({ id: 'AddNamedLocationResponse' })

export type AddNamedLocationResponse = z.infer<typeof addNamedLocationResponseSchema>

/**
 * Update named location body.
 */
export const updateNamedLocationBodySchema = z
  .object({
    name: z.string().min(1).optional().meta({ description: 'New location name' }),
    lat: z.number().min(-90).max(90).optional().meta({ description: 'New latitude' }),
    lon: z.number().min(-180).max(180).optional().meta({ description: 'New longitude' }),
    radius: z.number().int().positive().optional().meta({ description: 'New radius in meters' }),
  })
  .meta({ id: 'UpdateNamedLocationBody' })

export type UpdateNamedLocationBody = z.infer<typeof updateNamedLocationBodySchema>

/**
 * Promote detected location body.
 */
export const promoteDetectedLocationBodySchema = z
  .object({
    lat: z.number().min(-90).max(90).meta({ description: 'Latitude from detected location' }),
    lon: z.number().min(-180).max(180).meta({ description: 'Longitude from detected location' }),
    name: z.string().min(1).meta({ description: 'Name for the location' }),
    radius: z.number().int().positive().optional().meta({
      description: 'Radius in meters (uses suggested radius if not provided)',
    }),
  })
  .meta({ id: 'PromoteDetectedLocationBody' })

export type PromoteDetectedLocationBody = z.infer<typeof promoteDetectedLocationBodySchema>
