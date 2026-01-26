/**
 * OpenAPI document generator.
 *
 * This script generates an OpenAPI 3.1 specification from Zod schemas.
 * Run with: pnpm generate:openapi
 */

import * as fs from 'fs'
import * as yaml from 'yaml'
import { z } from 'zod'
import { createDocument } from 'zod-openapi'

// Import zod-openapi to get TypeScript support for meta() OpenAPI properties
import 'zod-openapi'

// Import all schemas
import { iso8601DateTimeSchema, metricTypeSchema, dateOnlySchema } from './schemas/common.js'

import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.js'

import {
  queryMetricsResponseSchema,
  addMetricBodySchema,
  addMetricResponseSchema,
} from './schemas/metrics.js'

import { dailySummaryResponseSchema } from './schemas/daily-summary.js'

import { periodSummaryResponseSchema } from './schemas/period-summary.js'

import {
  tagsResponseSchema,
  addTagBodySchema,
  addTagResponseSchema,
  deleteTagResponseSchema,
} from './schemas/tags.js'

import { activitiesResponseSchema } from './schemas/activities.js'

import {
  locationsResponseSchema,
  namedLocationsResponseSchema,
  detectedLocationsResponseSchema,
  addNamedLocationBodySchema,
  addNamedLocationResponseSchema,
  updateNamedLocationBodySchema,
  promoteDetectedLocationBodySchema,
} from './schemas/locations.js'

import {
  syncStatusResponseSchema,
  syncOuraBodySchema,
  syncRescueTimeBodySchema,
  syncResponseSchema,
} from './schemas/sync.js'

import { productivityResponseSchema } from './schemas/productivity.js'

// Error response
const errorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string(),
  })
  .meta({ id: 'ErrorResponse' })

// Delete response
const deleteResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .meta({ id: 'DeleteResponse' })

// ============================================================================
// Generate OpenAPI document
// ============================================================================

const openApiDocument = createDocument({
  openapi: '3.1.0',
  info: {
    title: 'Aurboda Health API',
    version: '1.0.0',
    description:
      'REST API for the Aurboda health tracking application. Track health metrics, activities, locations, and productivity data from multiple sources including Android Health Connect, Oura Ring, and RescueTime.',
    contact: {
      name: 'Fredrik Liljegren',
      email: 'fredrik@liljegren.org',
    },
    license: {
      name: 'AGPL-3.0-or-later',
      url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    },
  },
  servers: [
    { url: 'https://aurboda.net/api', description: 'Production' },
    { url: 'http://localhost:3000', description: 'Development' },
  ],
  tags: [
    { name: 'Metrics', description: 'Time series health metrics' },
    { name: 'Summary', description: 'Daily and period summaries' },
    { name: 'Tags', description: 'Activity tags/labels' },
    { name: 'Activities', description: 'Sleep, exercise, meditation sessions' },
    { name: 'Locations', description: 'Named and detected locations' },
    { name: 'Productivity', description: 'RescueTime productivity data' },
    { name: 'Settings', description: 'User settings and preferences' },
    { name: 'Sync', description: 'Data synchronization with external services' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        description: 'Bearer token authentication',
      },
    },
  },
  paths: {
    // --- Metrics ---
    '/metrics/{metric}': {
      get: {
        summary: 'Query time series metrics',
        description:
          'Query health metrics for a time range. Returns time series data with timestamps and values.',
        tags: ['Metrics'],
        requestParams: {
          path: z.object({ metric: metricTypeSchema }),
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: queryMetricsResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
          401: {
            description: 'Unauthorized',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/metrics': {
      post: {
        summary: 'Add manual metric',
        description: 'Add a manual health metric measurement.',
        tags: ['Metrics'],
        requestBody: {
          content: { 'application/json': { schema: addMetricBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: addMetricResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Daily Summary ---
    '/daily-summary': {
      get: {
        summary: 'Get daily summary',
        description:
          'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places.',
        tags: ['Summary'],
        requestParams: {
          query: z.object({
            date: dateOnlySchema.meta({ description: 'Date in YYYY-MM-DD format' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: dailySummaryResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Period Summary ---
    '/period-summary': {
      get: {
        summary: 'Get period summary',
        description:
          'Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.',
        tags: ['Summary'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            metrics: z.string().meta({ description: 'Comma-separated list of metrics' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: periodSummaryResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Tags ---
    '/tags': {
      get: {
        summary: 'Get tags',
        description: 'Get tags/labels for a time range.',
        tags: ['Tags'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: tagsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      post: {
        summary: 'Add tag',
        description: 'Add a manual tag/label to mark an activity or event.',
        tags: ['Tags'],
        requestBody: {
          content: { 'application/json': { schema: addTagBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: addTagResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/tags/{externalId}': {
      delete: {
        summary: 'Delete tag',
        description: 'Delete a tag by its external ID.',
        tags: ['Tags'],
        requestParams: {
          path: z.object({
            externalId: z.string().meta({ description: 'External ID of the tag to delete' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: deleteTagResponseSchema } },
          },
          404: {
            description: 'Tag not found',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Activities ---
    '/activities': {
      get: {
        summary: 'Get activities',
        description: 'Get activities (sleep, exercise, meditation, nap) for a time range.',
        tags: ['Activities'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            types: z.string().optional().meta({ description: 'Comma-separated activity types' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: activitiesResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Locations ---
    '/locations': {
      get: {
        summary: 'Get place visits',
        description: 'Get place visits for a time range.',
        tags: ['Locations'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: locationsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/locations/named': {
      get: {
        summary: 'Get named locations',
        description: 'Get all user-defined named locations.',
        tags: ['Locations'],
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: namedLocationsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      post: {
        summary: 'Add named location',
        description: 'Create a named location.',
        tags: ['Locations'],
        requestBody: {
          content: { 'application/json': { schema: addNamedLocationBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/locations/named/{id}': {
      patch: {
        summary: 'Update named location',
        description: 'Update an existing named location.',
        tags: ['Locations'],
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Location ID' }) }),
        },
        requestBody: {
          content: { 'application/json': { schema: updateNamedLocationBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
          },
          404: {
            description: 'Location not found',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      delete: {
        summary: 'Delete named location',
        description: 'Delete a named location by its ID.',
        tags: ['Locations'],
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Location ID' }) }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: deleteResponseSchema } },
          },
          404: {
            description: 'Location not found',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/locations/detected': {
      get: {
        summary: 'Get detected locations',
        description:
          'Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes.',
        tags: ['Locations'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            min_duration: z.coerce
              .number()
              .optional()
              .meta({ description: 'Minimum stay duration in minutes' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: detectedLocationsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/locations/detected/stored': {
      get: {
        summary: 'Get stored detected locations',
        description: 'Get all stored detected locations with visit statistics.',
        tags: ['Locations'],
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: detectedLocationsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/locations/detected/promote': {
      post: {
        summary: 'Promote detected location',
        description: 'Create a named location from detected coordinates.',
        tags: ['Locations'],
        requestBody: {
          content: { 'application/json': { schema: promoteDetectedLocationBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Productivity ---
    '/productivity': {
      get: {
        summary: 'Get productivity data',
        description: 'Get RescueTime productivity data for a time range.',
        tags: ['Productivity'],
        requestParams: {
          query: z.object({
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: productivityResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- User Settings ---
    '/user/settings': {
      get: {
        summary: 'Get user settings',
        description:
          'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
        tags: ['Settings'],
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: userSettingsResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
      patch: {
        summary: 'Update user settings',
        description:
          'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
        tags: ['Settings'],
        requestBody: {
          content: { 'application/json': { schema: updateSettingsInputSchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: userSettingsResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },

    // --- Sync ---
    '/sync/status': {
      get: {
        summary: 'Get sync status',
        description:
          'Get the current sync status for Oura and RescueTime data sources. Shows last sync time, status, and any errors.',
        tags: ['Sync'],
        requestParams: {
          query: z.object({
            provider: z.enum(['oura', 'rescuetime', 'all']).optional().meta({
              description: 'Provider to check',
            }),
          }),
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: syncStatusResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/sync/oura': {
      post: {
        summary: 'Sync Oura data',
        description:
          'Sync data from Oura Ring API. Fetches cardiovascular age, readiness, resilience, sleep scores, meditation sessions, and tags.',
        tags: ['Sync'],
        requestBody: {
          content: { 'application/json': { schema: syncOuraBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: syncResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
    '/sync/rescuetime': {
      post: {
        summary: 'Sync RescueTime data',
        description:
          'Sync productivity data from RescueTime API. Fetches application and website usage with productivity scores.',
        tags: ['Sync'],
        requestBody: {
          content: { 'application/json': { schema: syncRescueTimeBodySchema } },
        },
        responses: {
          200: {
            description: 'Successful response',
            content: { 'application/json': { schema: syncResponseSchema } },
          },
          400: {
            description: 'Bad request',
            content: { 'application/json': { schema: errorResponseSchema } },
          },
        },
        security: [{ bearerAuth: [] }],
      },
    },
  },
})

// Write to file
fs.mkdirSync('./generated', { recursive: true })
fs.writeFileSync('./generated/openapi.yaml', yaml.stringify(openApiDocument))
fs.writeFileSync('./generated/openapi.json', JSON.stringify(openApiDocument, null, 2))

console.log('Generated OpenAPI specification:')
console.log('  - generated/openapi.yaml')
console.log('  - generated/openapi.json')
