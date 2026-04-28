/**
 * OpenAPI document generator.
 *
 * This script generates an OpenAPI 3.1 specification from Zod schemas.
 * Run with: pnpm generate:openapi
 */

import * as fs from 'node:fs'
import * as yaml from 'yaml'
import { z } from 'zod'
import { createDocument } from 'zod-openapi'

import { activitiesResponseSchema } from './schemas/activities.ts'
import { loginBodySchema, loginResponseSchema } from './schemas/admin.ts'
// Import all schemas
import { dateOnlySchema, iso8601DateTimeSchema, metricTypeSchema } from './schemas/common.ts'
import { dailySummaryResponseSchema } from './schemas/daily-summary.ts'
import { goalsProgressResponseSchema } from './schemas/goals.ts'
import {
  addNamedLocationBodySchema,
  addNamedLocationResponseSchema,
  detectedLocationsResponseSchema,
  locationsResponseSchema,
  namedLocationsResponseSchema,
  promoteDetectedLocationBodySchema,
  updateNamedLocationBodySchema,
} from './schemas/locations.ts'
import {
  addMetricBodySchema,
  addMetricResponseSchema,
  queryMetricsResponseSchema,
} from './schemas/metrics.ts'
import {
  outboundSyncAckBodySchema,
  outboundSyncAckResponseSchema,
  outboundSyncResponseSchema,
} from './schemas/outbound-sync.ts'
import { periodSummaryResponseSchema } from './schemas/period-summary.ts'
import { productivityResponseSchema } from './schemas/productivity.ts'
import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.ts'
import {
  dailyAggregatesBodySchema,
  healthConnectDeletionsBodySchema,
  healthConnectSyncBodySchema,
  syncOuraBodySchema,
  syncRescueTimeBodySchema,
  syncResponseSchema,
  syncStatusResponseSchema,
} from './schemas/sync.ts'
import {
  webauthnAuthOptionsBodySchema,
  webauthnAuthOptionsResponseSchema,
  webauthnAuthVerifyBodySchema,
  webauthnAuthVerifyResponseSchema,
  webauthnCredentialsResponseSchema,
  webauthnRegistrationOptionsResponseSchema,
  webauthnRegistrationVerifyBodySchema,
  webauthnRegistrationVerifyResponseSchema,
  webauthnSignupOptionsBodySchema,
  webauthnSignupOptionsResponseSchema,
  webauthnSignupVerifyBodySchema,
  webauthnSignupVerifyResponseSchema,
  webauthnUpdateCredentialBodySchema,
} from './schemas/webauthn.ts'

// Error response
const errorResponseSchema = z
  .object({
    error: z.string(),
    success: z.boolean().meta({ description: 'Always false for error responses' }),
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
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
            types: z.string().optional().meta({ description: 'Comma-separated activity types' }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: activitiesResponseSchema },
            },
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
            date: dateOnlySchema.meta({
              description: 'Date in YYYY-MM-DD format',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: dailySummaryResponseSchema },
            },
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

    // --- Goals ---
    '/goals/progress': {
      get: {
        description:
          'Get progress toward all user goals. Returns current value, min/max targets, and how much will be lost when the oldest day exits the rolling window.',
        responses: {
          200: {
            content: {
              'application/json': { schema: goalsProgressResponseSchema },
            },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get goal progress',
        tags: ['Goals'],
      },
    },

    // --- Locations ---
    '/locations': {
      get: {
        description: 'Get place visits for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: locationsResponseSchema },
            },
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
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: detectedLocationsResponseSchema },
            },
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
          content: {
            'application/json': { schema: promoteDetectedLocationBodySchema },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: addNamedLocationResponseSchema },
            },
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
            content: {
              'application/json': { schema: detectedLocationsResponseSchema },
            },
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
            content: {
              'application/json': { schema: namedLocationsResponseSchema },
            },
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
          content: {
            'application/json': { schema: addNamedLocationBodySchema },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: addNamedLocationResponseSchema },
            },
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
          path: z.object({
            id: z.string().uuid().meta({ description: 'Location ID' }),
          }),
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
          content: {
            'application/json': { schema: updateNamedLocationBodySchema },
          },
        },
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Location ID' }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: addNamedLocationResponseSchema },
            },
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

    // --- Login ---
    '/login': {
      post: {
        description: 'Authenticate with username and password to receive access and refresh tokens.',
        requestBody: {
          content: { 'application/json': { schema: loginBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: loginResponseSchema } },
            description: 'Successful login',
          },
          401: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid credentials',
          },
        },
        summary: 'Login',
        tags: ['Auth'],
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
            content: {
              'application/json': { schema: addMetricResponseSchema },
            },
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
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: queryMetricsResponseSchema },
            },
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
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: periodSummaryResponseSchema },
            },
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
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
          }),
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: productivityResponseSchema },
            },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get productivity data',
        tags: ['Productivity'],
      },
    },
    '/sync/{recordType}': {
      post: {
        description:
          'Upload Health Connect records of a specific type (e.g., HeartRateRecord, SleepSessionRecord).',
        requestBody: {
          content: {
            'application/json': { schema: healthConnectSyncBodySchema },
          },
        },
        requestParams: {
          path: z.object({
            recordType: z.string().meta({ description: 'Health Connect record type name' }),
          }),
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
        summary: 'Sync Health Connect records',
        tags: ['Sync'],
      },
    },

    // --- Sync: Health Connect ---
    '/sync/daily-aggregates': {
      post: {
        description: 'Upload daily aggregate data from Health Connect (steps, distance, calories, floors).',
        requestBody: {
          content: {
            'application/json': { schema: dailyAggregatesBodySchema },
          },
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
        summary: 'Sync daily aggregates',
        tags: ['Sync'],
      },
    },
    '/sync/deletions': {
      post: {
        description: 'Report deleted Health Connect records that should be removed from the backend.',
        requestBody: {
          content: {
            'application/json': { schema: healthConnectDeletionsBodySchema },
          },
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
        summary: 'Sync Health Connect deletions',
        tags: ['Sync'],
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

    // --- Sync: Outbound (backend -> Health Connect) ---
    '/sync/outbound': {
      get: {
        description:
          'Get pending outbound sync entries. The Android app polls this to discover changes that need to be written to Health Connect.',
        responses: {
          200: {
            content: {
              'application/json': { schema: outboundSyncResponseSchema },
            },
            description: 'Pending outbound sync entries',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get pending outbound sync entries',
        tags: ['Sync'],
      },
    },

    '/sync/outbound/ack': {
      post: {
        description:
          'Acknowledge that outbound sync entries have been written to Health Connect. Optionally includes the Health Connect record ID for future reference.',
        requestBody: {
          content: {
            'application/json': { schema: outboundSyncAckBodySchema },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: outboundSyncAckResponseSchema },
            },
            description: 'Acknowledgement result',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Acknowledge outbound sync entries',
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
            content: {
              'application/json': { schema: syncStatusResponseSchema },
            },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get sync status',
        tags: ['Sync'],
      },
    },

    // --- WebAuthn / Passkey ---
    '/webauthn/auth/options': {
      post: {
        description:
          'Begin a WebAuthn authentication ceremony. Username is optional (discoverable credentials).',
        requestBody: {
          content: { 'application/json': { schema: webauthnAuthOptionsBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnAuthOptionsResponseSchema } },
            description: 'Successful response',
          },
        },
        summary: 'Get authentication options',
        tags: ['Auth'],
      },
    },
    '/webauthn/auth/verify': {
      post: {
        description: 'Complete a WebAuthn authentication ceremony and receive an auth token.',
        requestBody: {
          content: { 'application/json': { schema: webauthnAuthVerifyBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnAuthVerifyResponseSchema } },
            description: 'Successful response',
          },
          401: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Verification failed',
          },
        },
        summary: 'Verify authentication assertion',
        tags: ['Auth'],
      },
    },
    '/webauthn/credentials': {
      get: {
        description: "List the authenticated user's registered passkeys.",
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnCredentialsResponseSchema } },
            description: 'Registered passkeys',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List passkeys',
        tags: ['Auth'],
      },
    },
    '/webauthn/credentials/{id}': {
      delete: {
        description: 'Delete a registered passkey by its credential ID.',
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Credential ID (base64url)' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete passkey',
        tags: ['Auth'],
      },
      patch: {
        description: 'Rename a registered passkey.',
        requestBody: {
          content: { 'application/json': { schema: webauthnUpdateCredentialBodySchema } },
        },
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Credential ID (base64url)' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Updated',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Rename passkey',
        tags: ['Auth'],
      },
    },
    '/webauthn/signup/options': {
      post: {
        description:
          'Begin a passkey-only signup. Validates the desired username and signup mode (and invitation if required), then returns WebAuthn registration options. The user is not yet created.',
        requestBody: {
          content: { 'application/json': { schema: webauthnSignupOptionsBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnSignupOptionsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request (invalid username, taken username, etc.)',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Signup closed or invitation invalid',
          },
        },
        summary: 'Begin passkey-only signup',
        tags: ['Auth'],
      },
    },
    '/webauthn/signup/verify': {
      post: {
        description:
          'Complete a passkey-only signup. On success the Postgres user is created with an internally-generated random password, the credential is bound, and an auth token is returned.',
        requestBody: {
          content: { 'application/json': { schema: webauthnSignupVerifyBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnSignupVerifyResponseSchema } },
            description: 'Successful signup',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Verification failed',
          },
        },
        summary: 'Complete passkey-only signup',
        tags: ['Auth'],
      },
    },
    '/webauthn/register/options': {
      post: {
        description: 'Begin a WebAuthn registration ceremony for the authenticated user.',
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnRegistrationOptionsResponseSchema } },
            description: 'Registration options',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get registration options',
        tags: ['Auth'],
      },
    },
    '/webauthn/register/verify': {
      post: {
        description: 'Verify and persist a new passkey for the authenticated user.',
        requestBody: {
          content: { 'application/json': { schema: webauthnRegistrationVerifyBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: webauthnRegistrationVerifyResponseSchema } },
            description: 'Verification result',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Verify registration',
        tags: ['Auth'],
      },
    },

    // --- User Settings ---
    '/user/settings': {
      get: {
        description:
          'Get user settings including birth date and effective HR zones. HR zones are used to calculate time spent in different heart rate zones during exercise.',
        responses: {
          200: {
            content: {
              'application/json': { schema: userSettingsResponseSchema },
            },
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
          content: {
            'application/json': { schema: updateSettingsInputSchema },
          },
        },
        responses: {
          200: {
            content: {
              'application/json': { schema: userSettingsResponseSchema },
            },
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
    { description: 'Authentication', name: 'Auth' },
    { description: 'Health metric goals and progress tracking', name: 'Goals' },
    { description: 'Time series health metrics', name: 'Metrics' },
    { description: 'Daily and period summaries', name: 'Summary' },
    { description: 'Sleep, exercise, meditation sessions', name: 'Activities' },
    { description: 'Named and detected locations', name: 'Locations' },
    { description: 'RescueTime productivity data', name: 'Productivity' },
    { description: 'User settings and preferences', name: 'Settings' },
    {
      description: 'Data synchronization with external services',
      name: 'Sync',
    },
  ],
})

// Write to file
fs.mkdirSync('./generated', { recursive: true })
fs.writeFileSync('./generated/openapi.yaml', yaml.stringify(openApiDocument))
fs.writeFileSync('./generated/openapi.json', JSON.stringify(openApiDocument, null, 2))

console.info('Generated OpenAPI specification:')
console.info('  - generated/openapi.yaml')
console.info('  - generated/openapi.json')
