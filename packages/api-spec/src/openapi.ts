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
import { dateOnlySchema, iso8601DateTimeSchema, metricTypeSchema } from './schemas/common.js'

import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.js'

import {
  addMetricBodySchema,
  addMetricResponseSchema,
  queryMetricsResponseSchema,
} from './schemas/metrics.js'

import { dailySummaryResponseSchema } from './schemas/daily-summary.js'

import { periodSummaryResponseSchema } from './schemas/period-summary.js'

import {
  addTagBodySchema,
  addTagResponseSchema,
  deleteTagResponseSchema,
  tagsResponseSchema,
} from './schemas/tags.js'

import { activitiesResponseSchema } from './schemas/activities.js'

import {
  addNamedLocationBodySchema,
  addNamedLocationResponseSchema,
  detectedLocationsResponseSchema,
  locationsResponseSchema,
  namedLocationsResponseSchema,
  promoteDetectedLocationBodySchema,
  updateNamedLocationBodySchema,
} from './schemas/locations.js'

import {
  syncOuraBodySchema,
  syncRescueTimeBodySchema,
  syncResponseSchema,
  syncStatusResponseSchema,
} from './schemas/sync.js'

import { productivityResponseSchema } from './schemas/productivity.js'

// Error response
const errorResponseSchema = z
  .object({
    error: z.string(),
    success: z.literal(false),
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
  components: {
    securitySchemes: {
      bearerAuth: {
        bearerFormat: 'JWT',
        description: 'Bearer token authentication',
        scheme: 'bearer',
        type: 'http',
      },
    },
  },
  info: {
    contact: {
      email: 'fredrik@liljegren.org',
      name: 'Fredrik Liljegren',
    },
    description:
      'REST API for the Aurboda health tracking application. Track health metrics, activities, locations, and productivity data from multiple sources including Android Health Connect, Oura Ring, and RescueTime.',
    license: {
      name: 'AGPL-3.0-or-later',
      url: 'https://www.gnu.org/licenses/agpl-3.0.html',
    },
    title: 'Aurboda Health API',
    version: '1.0.0',
  },
  openapi: '3.1.0',
  paths: {
    // --- Activities ---
    '/activities': {
      get: {
        description: 'Get activities (sleep, exercise, meditation, nap) for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
            types: z.string().optional().meta({ description: 'Comma-separated activity types' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: activitiesResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get activities',
        tags: ['Activities'],
      },
    },

    // --- Daily Summary ---
    '/daily-summary': {
      get: {
        description:
          'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places.',
        requestParams: {
          query: z.object({
            date: dateOnlySchema.meta({ description: 'Date in YYYY-MM-DD format' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: dailySummaryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get daily summary',
        tags: ['Summary'],
      },
    },

    // --- Locations ---
    '/locations': {
      get: {
        description: 'Get place visits for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: locationsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get place visits',
        tags: ['Locations'],
      },
    },
    '/locations/detected': {
      get: {
        description:
          'Get frequently visited locations that are not yet named. Detects places where user spent 60+ minutes.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            min_duration: z.coerce
              .number()
              .optional()
              .meta({ description: 'Minimum stay duration in minutes' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: detectedLocationsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get detected locations',
        tags: ['Locations'],
      },
    },
    '/locations/detected/promote': {
      post: {
        description: 'Create a named location from detected coordinates.',
        requestBody: {
          content: { 'application/json': { schema: promoteDetectedLocationBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Promote detected location',
        tags: ['Locations'],
      },
    },
    '/locations/detected/stored': {
      get: {
        description: 'Get all stored detected locations with visit statistics.',
        responses: {
          200: {
            content: { 'application/json': { schema: detectedLocationsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get stored detected locations',
        tags: ['Locations'],
      },
    },
    '/locations/named': {
      get: {
        description: 'Get all user-defined named locations.',
        responses: {
          200: {
            content: { 'application/json': { schema: namedLocationsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get named locations',
        tags: ['Locations'],
      },
      post: {
        description: 'Create a named location.',
        requestBody: {
          content: { 'application/json': { schema: addNamedLocationBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add named location',
        tags: ['Locations'],
      },
    },
    '/locations/named/{id}': {
      delete: {
        description: 'Delete a named location by its ID.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Location ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Location not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete named location',
        tags: ['Locations'],
      },
      patch: {
        description: 'Update an existing named location.',
        requestBody: {
          content: { 'application/json': { schema: updateNamedLocationBodySchema } },
        },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Location ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: addNamedLocationResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Location not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update named location',
        tags: ['Locations'],
      },
    },
    '/metrics': {
      post: {
        description: 'Add a manual health metric measurement.',
        requestBody: {
          content: { 'application/json': { schema: addMetricBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: addMetricResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add manual metric',
        tags: ['Metrics'],
      },
    },
    // --- Metrics ---
    '/metrics/{metric}': {
      get: {
        description:
          'Query health metrics for a time range. Returns time series data with timestamps and values.',
        requestParams: {
          path: z.object({ metric: metricTypeSchema }),
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: queryMetricsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
          401: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unauthorized',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Query time series metrics',
        tags: ['Metrics'],
      },
    },

    // --- Period Summary ---
    '/period-summary': {
      get: {
        description:
          'Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            metrics: z.string().meta({ description: 'Comma-separated list of metrics' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: periodSummaryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get period summary',
        tags: ['Summary'],
      },
    },

    // --- Productivity ---
    '/productivity': {
      get: {
        description: 'Get RescueTime productivity data for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: productivityResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get productivity data',
        tags: ['Productivity'],
      },
    },
    '/sync/oura': {
      post: {
        description:
          'Sync data from Oura Ring API. Fetches cardiovascular age, readiness, resilience, sleep scores, meditation sessions, and tags.',
        requestBody: {
          content: { 'application/json': { schema: syncOuraBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: syncResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Sync Oura data',
        tags: ['Sync'],
      },
    },
    '/sync/rescuetime': {
      post: {
        description:
          'Sync productivity data from RescueTime API. Fetches application and website usage with productivity scores.',
        requestBody: {
          content: { 'application/json': { schema: syncRescueTimeBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: syncResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Sync RescueTime data',
        tags: ['Sync'],
      },
    },

    // --- Sync ---
    '/sync/status': {
      get: {
        description:
          'Get the current sync status for Oura and RescueTime data sources. Shows last sync time, status, and any errors.',
        requestParams: {
          query: z.object({
            provider: z.enum(['oura', 'rescuetime', 'all']).optional().meta({
              description: 'Provider to check',
            }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: syncStatusResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get sync status',
        tags: ['Sync'],
      },
    },

    // --- Tags ---
    '/tags': {
      get: {
        description: 'Get tags/labels for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({ description: 'Start date/time' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: tagsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get tags',
        tags: ['Tags'],
      },
      post: {
        description: 'Add a manual tag/label to mark an activity or event.',
        requestBody: {
          content: { 'application/json': { schema: addTagBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: addTagResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add tag',
        tags: ['Tags'],
      },
    },
    '/tags/{externalId}': {
      delete: {
        description: 'Delete a tag by its external ID.',
        requestParams: {
          path: z.object({
            externalId: z.string().meta({ description: 'External ID of the tag to delete' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteTagResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Tag not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete tag',
        tags: ['Tags'],
      },
    },

    // --- User Settings ---
    '/user/settings': {
      get: {
        description:
          'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
        responses: {
          200: {
            content: { 'application/json': { schema: userSettingsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get user settings',
        tags: ['Settings'],
      },
      patch: {
        description:
          'Update user settings. Can set birth date (for age-based HR zones) and/or custom HR zone thresholds.',
        requestBody: {
          content: { 'application/json': { schema: updateSettingsInputSchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: userSettingsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update user settings',
        tags: ['Settings'],
      },
    },
  },
  servers: [
    { description: 'Production', url: 'https://aurboda.net/api' },
    { description: 'Development', url: 'http://localhost:3000' },
  ],
  tags: [
    { description: 'Time series health metrics', name: 'Metrics' },
    { description: 'Daily and period summaries', name: 'Summary' },
    { description: 'Activity tags/labels', name: 'Tags' },
    { description: 'Sleep, exercise, meditation sessions', name: 'Activities' },
    { description: 'Named and detected locations', name: 'Locations' },
    { description: 'RescueTime productivity data', name: 'Productivity' },
    { description: 'User settings and preferences', name: 'Settings' },
    { description: 'Data synchronization with external services', name: 'Sync' },
  ],
})

// Write to file
fs.mkdirSync('./generated', { recursive: true })
fs.writeFileSync('./generated/openapi.yaml', yaml.stringify(openApiDocument))
fs.writeFileSync('./generated/openapi.json', JSON.stringify(openApiDocument, null, 2))

console.log('Generated OpenAPI specification:')
console.log('  - generated/openapi.yaml')
console.log('  - generated/openapi.json')
