/**
 * Locations schemas.
 */

import { z } from 'zod'

import {
  addressNullableSchema,
  addressSchema,
  createDataArrayResponseSchema,
  createDataResponseSchema,
  detectedLocationIdSchema,
  durationMinutesSchema,
  geocodeStatusSchema,
  iso8601DateTimeSchema,
  latSchema,
  latWithValidationSchema,
  lonSchema,
  lonWithValidationSchema,
  placeSourceSchema,
  radiusSchema,
  timeRangeQuerySchema,
} from './common.ts'

// Shared location name field
const locationNameSchema = z.string().meta({ description: 'Location name', example: 'Home' })

/**
 * Named location schema.
 */
export const namedLocationSchema = z
  .object({
    auto_create_activity: z.boolean().optional().meta({
      description: 'If true, visits here create a location_visit activity',
    }),
    id: z.string().uuid().meta({ description: 'Location ID' }),
    lat: latSchema,
    lon: lonSchema,
    name: locationNameSchema,
    radius: radiusSchema,
  })
  .meta({ id: 'NamedLocation' })

export type NamedLocation = z.infer<typeof namedLocationSchema>

/**
 * Detected location schema.
 */
export const detectedLocationSchema = z
  .object({
    address: addressNullableSchema.optional(),
    first_visit: z.string().meta({ description: 'First visit time' }),
    geocode_status: geocodeStatusSchema.optional(),
    id: z.string().uuid().optional().meta({ description: 'Location ID' }),
    last_visit: z.string().meta({ description: 'Last visit time' }),
    lat: z.number().meta({ description: 'Latitude' }),
    lon: z.number().meta({ description: 'Longitude' }),
    radius: radiusSchema.optional(),
    suggested_radius: z.number().int().optional().meta({ description: 'Suggested radius in meters' }),
    total_minutes: z.number().meta({ description: 'Total time spent at location' }),
    visit_count: z.number().int().meta({ description: 'Number of visits' }),
  })
  .meta({ id: 'DetectedLocation' })

export type DetectedLocation = z.infer<typeof detectedLocationSchema>

/**
 * Place visit schema.
 */
export const placeVisitSchema = z
  .object({
    address: addressSchema.optional(),
    detected_location_id: detectedLocationIdSchema.optional(),
    duration: durationMinutesSchema,
    end_time: iso8601DateTimeSchema,
    lat: latSchema.optional(),
    lon: lonSchema.optional(),
    name: z.string().meta({ description: 'Place name' }),
    source: placeSourceSchema,
    start_time: iso8601DateTimeSchema,
  })
  .meta({ id: 'PlaceVisit' })

export type PlaceVisit = z.infer<typeof placeVisitSchema>

/**
 * Raw GPS location point schema.
 */
export const rawLocationPointSchema = z
  .object({
    lat: latSchema,
    lon: lonSchema,
    time: iso8601DateTimeSchema,
  })
  .meta({ id: 'RawLocationPoint', description: 'Raw GPS location point' })

export type RawLocationPoint = z.infer<typeof rawLocationPointSchema>

/**
 * Raw locations response schema.
 */
export const rawLocationsResponseSchema = createDataArrayResponseSchema(rawLocationPointSchema).meta({
  id: 'RawLocationsResponse',
})

export type RawLocationsResponse = z.infer<typeof rawLocationsResponseSchema>

/**
 * Locations query schema.
 */
export const locationsQuerySchema = timeRangeQuerySchema.meta({ id: 'LocationsQuery' })

export type LocationsQuery = z.infer<typeof locationsQuerySchema>

/**
 * Locations response schema (place visits).
 */
export const locationsResponseSchema = createDataArrayResponseSchema(placeVisitSchema).meta({
  id: 'LocationsResponse',
})

export type LocationsResponse = z.infer<typeof locationsResponseSchema>

/**
 * Named locations response schema.
 */
export const namedLocationsResponseSchema = createDataArrayResponseSchema(namedLocationSchema).meta({
  id: 'NamedLocationsResponse',
})

export type NamedLocationsResponse = z.infer<typeof namedLocationsResponseSchema>

/**
 * Detected locations response schema.
 */
export const detectedLocationsResponseSchema = createDataArrayResponseSchema(detectedLocationSchema).meta({
  id: 'DetectedLocationsResponse',
})

export type DetectedLocationsResponse = z.infer<typeof detectedLocationsResponseSchema>

/**
 * Detected locations query schema.
 * Note: min_duration stays as string for Express ParsedQs compatibility.
 */
export const detectedLocationsQuerySchema = timeRangeQuerySchema
  .extend({
    min_duration: z.string().regex(/^\d+$/, 'Must be a positive integer').optional().meta({
      description: 'Minimum stay duration in minutes',
      example: '60',
    }),
  })
  .meta({ id: 'DetectedLocationsQuery' })

export type DetectedLocationsQuery = z.infer<typeof detectedLocationsQuerySchema>

/**
 * Add named location body.
 */
export const addNamedLocationBodySchema = z
  .object({
    auto_create_activity: z.boolean().optional().meta({
      description: 'If true, visits create a location_visit activity (defaults to false)',
    }),
    lat: latWithValidationSchema,
    lon: lonWithValidationSchema,
    name: z.string().min(1).meta({ description: 'Location name', example: 'Office' }),
    radius: z.number().int().positive().optional().meta({
      description: 'Radius in meters (defaults to 200)',
    }),
  })
  .meta({ id: 'AddNamedLocationBody' })

export type AddNamedLocationBody = z.infer<typeof addNamedLocationBodySchema>

/**
 * Add named location response.
 */
export const addNamedLocationResponseSchema = createDataResponseSchema(namedLocationSchema).meta({
  id: 'AddNamedLocationResponse',
})

export type AddNamedLocationResponse = z.infer<typeof addNamedLocationResponseSchema>

/**
 * Update named location body.
 */
export const updateNamedLocationBodySchema = z
  .object({
    auto_create_activity: z.boolean().optional().meta({
      description: 'Toggle auto-creation of location_visit activities on visits here',
    }),
    lat: latWithValidationSchema.optional().meta({ description: 'New latitude' }),
    lon: lonWithValidationSchema.optional().meta({ description: 'New longitude' }),
    name: z.string().min(1).optional().meta({ description: 'New location name' }),
    radius: z.number().int().positive().optional().meta({ description: 'New radius in meters' }),
  })
  .meta({ id: 'UpdateNamedLocationBody' })

export type UpdateNamedLocationBody = z.infer<typeof updateNamedLocationBodySchema>

/**
 * Promote detected location body.
 */
export const promoteDetectedLocationBodySchema = z
  .object({
    lat: latWithValidationSchema.meta({ description: 'Latitude from detected location' }),
    lon: lonWithValidationSchema.meta({ description: 'Longitude from detected location' }),
    name: z.string().min(1).meta({ description: 'Name for the location' }),
    radius: z.number().int().positive().optional().meta({
      description: 'Radius in meters (uses suggested radius if not provided)',
    }),
  })
  .meta({ id: 'PromoteDetectedLocationBody' })

export type PromoteDetectedLocationBody = z.infer<typeof promoteDetectedLocationBodySchema>
