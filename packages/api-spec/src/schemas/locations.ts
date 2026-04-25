/**
 * Locations schemas.
 */

import { z } from 'zod'

import {
  addressNullableSchema,
  addressSchema,
  baseResponseSchema,
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
  tzSchema,
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
 * Overnight stay schema — a single detected night at a location.
 */
export const overnightStaySchema = z
  .object({
    arrival: iso8601DateTimeSchema.meta({
      description: 'Arrival time of the visit covering this night',
    }),
    departure: iso8601DateTimeSchema.meta({
      description: 'Departure time of the visit covering this night',
    }),
    duration_hours: z.number().meta({
      description: 'Total duration of the underlying visit, in hours',
    }),
    overnight_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2}$/)
      .meta({
        description: 'Date the overnight stay belongs to (the evening day, YYYY-MM-DD in tz)',
      }),
  })
  .meta({ id: 'OvernightStay' })

export type OvernightStay = z.infer<typeof overnightStaySchema>

/**
 * Overnight stays query schema.
 */
export const overnightStaysQuerySchema = timeRangeQuerySchema
  .extend({
    arrival_before: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM')
      .optional()
      .meta({
        description:
          'Latest arrival time on the morning side (default 10:00). Visit must include this time on day N+1.',
        example: '10:00',
      }),
    departure_after: z
      .string()
      .regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'Must be HH:MM')
      .optional()
      .meta({
        description:
          'Earliest presence time on the evening side (default 17:00). Visit must include this time on day N.',
        example: '17:00',
      }),
    location_name: z.string().min(1).meta({
      description: 'Name of a named location to detect overnight stays at',
      example: 'Home',
    }),
    tz: tzSchema,
  })
  .meta({ id: 'OvernightStaysQuery' })

export type OvernightStaysQuery = z.infer<typeof overnightStaysQuerySchema>

/**
 * Overnight stays response schema.
 */
export const overnightStaysResponseSchema = baseResponseSchema
  .extend({
    data: z.array(overnightStaySchema).optional(),
    total_nights: z.number().int().optional().meta({
      description: 'Total number of overnight stays detected',
    }),
  })
  .meta({ id: 'OvernightStaysResponse' })

export type OvernightStaysResponse = z.infer<typeof overnightStaysResponseSchema>

/**
 * Location summary schema.
 */
export const locationSummaryGroupBySchema = z.enum(['day', 'week', 'month', 'year']).meta({
  description: 'Group breakdown by period',
  id: 'LocationSummaryGroupBy',
})

export type LocationSummaryGroupBy = z.infer<typeof locationSummaryGroupBySchema>

export const locationSummaryBucketSchema = z
  .object({
    hours: z.number().meta({ description: 'Total hours spent at the location in this period' }),
    nights: z.number().int().meta({ description: 'Overnight stays in this period' }),
    period: z.string().meta({
      description: 'Period label (YYYY-MM-DD for day, YYYY-Www for week, YYYY-MM for month, YYYY for year)',
    }),
    visits: z.number().int().meta({ description: 'Number of visits in this period' }),
  })
  .meta({ id: 'LocationSummaryBucket' })

export type LocationSummaryBucket = z.infer<typeof locationSummaryBucketSchema>

export const locationSummarySchema = z
  .object({
    breakdown: z.array(locationSummaryBucketSchema).optional().meta({
      description: 'Per-period breakdown when group_by is provided',
    }),
    total_hours: z.number().meta({ description: 'Total hours across all visits' }),
    total_nights: z.number().int().meta({ description: 'Total overnight stays' }),
    total_visits: z.number().int().meta({ description: 'Total number of visits' }),
  })
  .meta({ id: 'LocationSummary' })

export type LocationSummary = z.infer<typeof locationSummarySchema>

export const locationSummaryQuerySchema = timeRangeQuerySchema
  .extend({
    group_by: locationSummaryGroupBySchema.optional(),
    location_name: z.string().min(1).meta({
      description: 'Name of a named location to summarize',
      example: 'Home',
    }),
    tz: tzSchema,
  })
  .meta({ id: 'LocationSummaryQuery' })

export type LocationSummaryQuery = z.infer<typeof locationSummaryQuerySchema>

export const locationSummaryResponseSchema = createDataResponseSchema(locationSummarySchema).meta({
  id: 'LocationSummaryResponse',
})

export type LocationSummaryResponse = z.infer<typeof locationSummaryResponseSchema>

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
