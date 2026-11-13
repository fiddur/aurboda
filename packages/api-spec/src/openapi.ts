/** Generates the OpenAPI 3.1 specification from the Zod schemas: pnpm generate:openapi */

import * as fs from 'node:fs'
import * as yaml from 'yaml'
import { z } from 'zod'
import { createDocument } from 'zod-openapi'

import { isAllowedWhenReadOnly } from './read-only.ts'
import { activitiesResponseSchema } from './schemas/activities.ts'
import {
  addRelayBodySchema,
  deleteAccountBodySchema,
  loginBodySchema,
  loginResponseSchema,
  relayResponseSchema,
  relaysResponseSchema,
  resendPostUpdatesResponseSchema,
} from './schemas/admin.ts'
import {
  challengeParticipationsResponseSchema,
  challengePreviewQuerySchema,
  challengePreviewResponseSchema,
  challengesResponseSchema,
  discoverChallengesResponseSchema,
  challengeStandingsResponseSchema,
  wellKnownAurbodaSchema,
  wellKnownQuantpubSchema,
} from './schemas/challenges.ts'
import { iso8601DateTimeSchema, metricTypeSchema } from './schemas/common.ts'
import { dailySummaryQuerySchema, dailySummaryResponseSchema } from './schemas/daily-summary.ts'
import {
  exerciseCatalogEntryResponseSchema,
  exerciseCatalogQuerySchema,
  exerciseCatalogSearchResponseSchema,
} from './schemas/exercise-catalog.ts'
import { exportDumpLinkResponseSchema, exportDumpQuerySchema } from './schemas/export.ts'
import {
  FEED_IMAGE_MAX_EDGE,
  feedImageResponseSchema,
  feedImagesResponseSchema,
  MAX_FEED_IMAGE_BYTES,
  MAX_FEED_IMAGES_PER_ACCOUNT,
} from './schemas/feed-images.ts'
import { publicTagPostsQuerySchema, publicTagPostsResponseSchema } from './schemas/feed.ts'
import {
  goalHistoryQuerySchema,
  goalHistoryResponseSchema,
  goalsProgressResponseSchema,
} from './schemas/goals.ts'
import {
  itemValueIdentityQuerySchema,
  itemValueIdentityResponseSchema,
  setItemValueIdentityBodySchema,
  unmappedItemValuesQuerySchema,
  unmappedItemValuesResponseSchema,
} from './schemas/item-value-identities.ts'
import {
  addNamedLocationBodySchema,
  addNamedLocationResponseSchema,
  detectedLocationsResponseSchema,
  locationsResponseSchema,
  namedLocationsResponseSchema,
  placesSummaryQuerySchema,
  placesSummaryResponseSchema,
  promoteDetectedLocationBodySchema,
  updateNamedLocationBodySchema,
} from './schemas/locations.ts'
import {
  mediaPlayQuerySchema,
  mediaPlayResponseSchema,
  mediaPlaysQuerySchema,
  mediaPlaysResponseSchema,
  topMediaQuerySchema,
  topMediaResponseSchema,
} from './schemas/media.ts'
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
import {
  accountPlanResponseSchema,
  accountReadOnlyResponseSchema,
  adminUserPlanResponseSchema,
  updateUserPlanBodySchema,
} from './schemas/plans.ts'
import {
  productivityResponseSchema,
  topAppsQuerySchema,
  topAppsResponseSchema,
} from './schemas/productivity.ts'
import { accountEmailResponseSchema, updateAccountEmailBodySchema } from './schemas/profile.ts'
import {
  mergeRoutesBodySchema,
  mergeRoutesResponseSchema,
  routeDetailResponseSchema,
  routeMatchResponseSchema,
  routeResponseSchema,
  routesQuerySchema,
  routesResponseSchema,
  updateRouteBodySchema,
} from './schemas/routes.ts'
import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.ts'
import { latestSleepResponseSchema } from './schemas/sleep.ts'
import {
  dailyAggregatesBodySchema,
  healthConnectDeletionsBodySchema,
  healthConnectSyncBodySchema,
  syncOuraBodySchema,
  syncGravlBodySchema,
  gravlSyncResponseSchema,
  gravlSyncStatusResponseSchema,
  mediaSyncResponseSchema,
  syncMediaBodySchema,
  syncRescueTimeBodySchema,
  syncResponseSchema,
  syncStatusResponseSchema,
} from './schemas/sync.ts'
import { activityTrackResponseSchema, trackBackfillResponseSchema } from './schemas/tracks.ts'
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

const errorResponseSchema = z
  .object({
    error: z.string(),
    success: z.boolean().meta({ description: 'Always false for error responses' }),
  })
  .meta({ id: 'ErrorResponse' })

const deleteResponseSchema = z
  .object({
    success: z.boolean(),
  })
  .meta({ id: 'DeleteResponse' })

const activityTypeNamePathSchema = z.object({
  name: z.string().meta({ description: 'Activity type name, e.g. strength_training' }),
})

const openApiDocument = createDocument({
  components: {
    // Served at the instance root (`/.well-known/aurboda`), outside the `/api`
    // server base, so it has no path entry — the model is registered so federation
    // clients (the Android challenge widget) get a generated type for it.
    schemas: {
      AccountReadOnlyResponse: accountReadOnlyResponseSchema,
      WellKnownAurboda: wellKnownAurbodaSchema,
      WellKnownQuantpub: wellKnownQuantpubSchema,
    },
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
    '/challenges': {
      get: {
        description: 'List the challenges hosted by the authenticated user.',
        responses: {
          200: {
            content: { 'application/json': { schema: challengesResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my challenges',
        tags: ['Challenges'],
      },
    },
    '/challenges/discover': {
      get: {
        description:
          'Open challenges hosted by people the authenticated user follows (on this or any Aurboda instance) that they have not joined: ongoing first, then upcoming; ended challenges are never listed.',
        responses: {
          200: {
            content: { 'application/json': { schema: discoverChallengesResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Discover challenges from people I follow',
        tags: ['Challenges'],
      },
    },
    '/challenges/preview': {
      get: {
        description:
          'What joining a challenge by its URL would join (name, host, window, what it counts), read from its host — this or another instance — without joining.',
        requestParams: { query: challengePreviewQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: challengePreviewResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a challenge URL',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge on this instance',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The host could not be read, or this instance cannot score its challenge',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview a challenge by URL',
        tags: ['Challenges'],
      },
    },
    '/challenges/participations/mine': {
      get: {
        description: 'List the challenges the authenticated user has joined (possibly on other instances).',
        responses: {
          200: {
            content: { 'application/json': { schema: challengeParticipationsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my challenge participations',
        tags: ['Challenges'],
      },
    },
    '/public/tags/{tag}/posts': {
      get: {
        description:
          "A public tag page: public posts carrying `#{tag}`, from this server and others, newest first. Fed by the instance actor following the tag's actor on the tag actor host, plus this server's own public posts with the tag; posts older than the retention are dropped. Only tags the admin configured have a page. No authentication.",
        requestParams: {
          path: z.object({ tag: z.string().meta({ description: 'The hashtag, without `#`' }) }),
          query: publicTagPostsQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: publicTagPostsResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The tag has no public page',
          },
        },
        summary: 'List a public tag page',
        tags: ['Feed'],
      },
    },
    '/public/tags/{tag}.atom': {
      get: {
        description:
          'The Atom feed of a public tag page: its newest posts, each linking to the original. No authentication.',
        requestParams: {
          path: z.object({ tag: z.string().meta({ description: 'The hashtag, without `#`' }) }),
        },
        responses: {
          200: {
            content: { 'application/atom+xml': { schema: z.string() } },
            description: 'Atom feed',
          },
          404: { description: 'The tag has no public page' },
        },
        summary: 'Atom feed of a public tag page',
        tags: ['Feed'],
      },
    },
    '/feed/images': {
      get: {
        description:
          'List the pictures the authenticated user has added to what they write, newest first, with the cap on how many one account may store.',
        responses: {
          200: {
            content: { 'application/json': { schema: feedImagesResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my pictures',
        tags: ['Feed'],
      },
      post: {
        description: `Store a picture (PNG, JPEG, WebP or GIF, at most ${MAX_FEED_IMAGE_BYTES / 1024 / 1024} MB) and get back its public URL, to embed in markdown as \`![description](url)\`. It is stored as WebP with its longest edge at most ${FEED_IMAGE_MAX_EDGE} px, turned upright, and without its metadata; an animated GIF keeps its first frame. One account may store ${MAX_FEED_IMAGES_PER_ACCOUNT} pictures.`,
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: z.object({
                image: z.string().meta({ description: 'The picture file', format: 'binary' }),
              }),
            },
          },
        },
        responses: {
          201: {
            content: { 'application/json': { schema: feedImageResponseSchema } },
            description: 'The stored picture',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No file uploaded',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The account already stores as many pictures as it may',
          },
          413: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The file is too large',
          },
          415: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a picture Aurboda can use',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a picture',
        tags: ['Feed'],
      },
    },
    '/feed/images/{id}': {
      delete: {
        description:
          'Delete a stored picture. Markdown that embeds its URL shows a broken picture afterwards.',
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Picture ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Picture not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a picture',
        tags: ['Feed'],
      },
    },
    '/public/{username}/images/{id}.webp': {
      get: {
        description:
          'A stored picture, as WebP. No authentication: anyone with the link can see it. Cached for a year, since a picture never changes.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Picture ID' }),
            username: z.string().meta({ description: 'Username of the writer' }),
          }),
        },
        responses: {
          200: {
            content: { 'image/webp': { schema: z.string().meta({ format: 'binary' }) } },
            description: 'The picture',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Picture not found',
          },
        },
        summary: 'Get a picture',
        tags: ['Feed'],
      },
    },
    '/public/{username}/{slug}/standings': {
      get: {
        description:
          "Public standings of a challenge hosted at `/u/{username}/{slug}`: each active member's bucketed series and total. No authentication.",
        requestParams: {
          path: z.object({
            slug: z.string().meta({ description: 'Challenge slug' }),
            username: z.string().meta({ description: 'Host username' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeStandingsResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Challenge not found',
          },
        },
        summary: 'Get public challenge standings',
        tags: ['Challenges'],
      },
    },
    '/activities': {
      get: {
        description: 'Get activities (sleep, exercise, meditation, nap) for a time range.',
        requestParams: {
          query: z.object({
            end: iso8601DateTimeSchema.meta({ description: 'End date/time' }),
            start: iso8601DateTimeSchema.meta({
              description: 'Start date/time',
            }),
            route_id: z
              .string()
              .uuid()
              .optional()
              .meta({ description: 'Only activities matched to this route' }),
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
    '/activities/{id}/track': {
      get: {
        description:
          "Get an activity's full-resolution GPS track: points with altitude and seconds since the activity start.",
        requestParams: {
          path: z.object({
            id: z.string().meta({ description: 'Activity ID (a merged:<id> prefix is accepted)' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: activityTrackResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No track for activity',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get activity track',
        tags: ['Activities'],
      },
    },
    '/exercise-catalog': {
      get: {
        description:
          'Search the built-in catalogue of strength exercises by name (word prefixes of names, aliases and search terms, best matches first), equipment, muscle or category. `name` is an exact name-or-alias lookup (case and punctuation ignored) that returns that exercise or none and ignores `q`.',
        requestParams: { query: exerciseCatalogQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: exerciseCatalogSearchResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query, e.g. an unknown equipment, muscle or category',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Search exercise catalogue',
        tags: ['Activities'],
      },
    },
    '/exercise-catalog/{key}': {
      get: {
        description:
          'One exercise of the built-in catalogue by its stable key: name, aliases, category, equipment, muscles with recruitment weights, and the same exercise in other datasets.',
        requestParams: {
          path: z.object({
            key: z.string().meta({ description: 'Catalogue key, e.g. dumbbell_bench_press' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: exerciseCatalogEntryResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Exercise not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get exercise catalogue entry',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/item-values/identity': {
      delete: {
        description:
          "Remove the user's decision for a logged name of a catalogue-backed item path, so it resolves automatically again.",
        requestParams: { path: activityTypeNamePathSchema, query: itemValueIdentityQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Decision removed',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The field is not a catalogue-backed item field of the activity type',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type, or no decision stored for the name',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Clear item value identity',
        tags: ['Activities'],
      },
      get: {
        description:
          "What catalogue entry a logged name of a catalogue-backed item path (e.g. sets.exercise) stands for: the user's own mapping or dismissal, else an exact match of a catalogue name or alias, else unmapped. Also lists the user's other logged values that resolve to the same entry. The name need not be logged yet.",
        requestParams: { path: activityTypeNamePathSchema, query: itemValueIdentityQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: itemValueIdentityResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The field is not a catalogue-backed item field of the activity type',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get item value identity',
        tags: ['Activities'],
      },
      put: {
        description:
          'Map a logged name of a catalogue-backed item path to a catalogue entry, or dismiss it as not in the catalogue (key null). No activity is rewritten: the identity sits on the name.',
        requestBody: { content: { 'application/json': { schema: setItemValueIdentityBodySchema } } },
        requestParams: { path: activityTypeNamePathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: itemValueIdentityResponseSchema } },
            description: 'The name as it now resolves',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a catalogue-backed item field, or an unknown catalogue key',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set item value identity',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/item-values/unmapped': {
      get: {
        description:
          'The logged names of a catalogue-backed item path that match no catalogue entry and that the user has neither mapped nor dismissed, most used first, each with up to three suggested entries.',
        requestParams: { path: activityTypeNamePathSchema, query: unmappedItemValuesQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: unmappedItemValuesResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The field is not a catalogue-backed item field of the activity type',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List unmapped item values',
        tags: ['Activities'],
      },
    },
    '/routes': {
      get: {
        description:
          'List recognised routes (courses run more than once), with run count and latest run. Optionally only one activity type (and its descendant types); ordered by latest run (default), run count, length or name.',
        requestParams: { query: routesQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: routesResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List routes',
        tags: ['Routes'],
      },
    },
    '/routes/match': {
      post: {
        description:
          'Match every tracked activity without a route: attach it to a covering route of its type, or pair it with another unrouted track to create one.',
        responses: {
          200: {
            content: { 'application/json': { schema: routeMatchResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Match routes',
        tags: ['Routes'],
      },
    },
    '/routes/{id}': {
      delete: {
        description:
          'Delete a route. Its runs stay attached to it and are not matched again; a later run of the same course does not revive it.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Route ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Route not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete route',
        tags: ['Routes'],
      },
      get: {
        description:
          'A route with its line and its runs over time: elapsed time, average heart rate and pace per run, newest first.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Route ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: routeDetailResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Route not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get route',
        tags: ['Routes'],
      },
      patch: {
        description: 'Rename a route.',
        requestBody: {
          content: { 'application/json': { schema: updateRouteBodySchema } },
        },
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Route ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: routeResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Route not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update route',
        tags: ['Routes'],
      },
    },
    '/routes/{id}/merge': {
      post: {
        description: 'Move every run of another route onto this one and delete the other route.',
        requestBody: {
          content: { 'application/json': { schema: mergeRoutesBodySchema } },
        },
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Route ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: mergeRoutesResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Route not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Merge routes',
        tags: ['Routes'],
      },
    },
    '/tracks/backfill': {
      post: {
        description:
          'Build missing activity tracks from stored raw records: Garmin activity details at full resolution, Strava polylines as shape-only tracks.',
        responses: {
          200: {
            content: { 'application/json': { schema: trackBackfillResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Backfill activity tracks',
        tags: ['Activities'],
      },
    },

    '/daily-summary': {
      get: {
        description:
          'Get a comprehensive summary of health data for a specific day including heart rate, steps, sleep, exercise, tags, productivity, and visited places.',
        requestParams: { query: dailySummaryQuerySchema },
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

    '/goals/{id}/history': {
      get: {
        description:
          "Get a goal's value and on-target status per past day in the user's device timezone (UTC when unset), or per month as counts of on-target days. Every day is judged against the goal's current min/max; today is partial and not counted.",
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Goal ID' }) }),
          query: goalHistoryQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: goalHistoryResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Goal not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get goal history',
        tags: ['Goals'],
      },
    },

    '/latest-sleep': {
      get: {
        description:
          'Get the most recent night of sleep that ended within the last 36 hours: timing, sleep score, stage timeline and minutes, resting heart rate and HRV against their 30-day baselines, and Body Battery at bedtime and wake-up. Data is null when no sleep was recorded.',
        responses: {
          200: {
            content: {
              'application/json': { schema: latestSleepResponseSchema },
            },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Get last night's sleep",
        tags: ['Summary'],
      },
    },

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
    '/locations/places-summary': {
      get: {
        description:
          'Visits to named and detected places in a time window: nights at home and away (overnight stays), distinct places, visits and the five most visited places.',
        requestParams: { query: placesSummaryQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: placesSummaryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Places summary',
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
    '/productivity/top-apps': {
      get: {
        description:
          'Screen time in a time window grouped by app, leaving out categories excluded from screen time: total hours, distinct apps and the most used apps.',
        requestParams: { query: topAppsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: topAppsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Top apps by screen time',
        tags: ['Productivity'],
      },
    },
    '/sync/{recordType}': {
      post: {
        description:
          'Upload Health Connect records of a specific type (e.g., HeartRateRecord, SleepSessionRecord, MindfulnessSessionRecord).',
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

    '/sync/media': {
      post: {
        description:
          "Push media plays (videos, music, podcasts) from an MPRIS logger. Plays are stored as raw records deduplicated by id, so re-posting a batch is safe. Triggers deduction rule evaluation over the plays' time span.",
        requestBody: {
          content: { 'application/json': { schema: syncMediaBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: mediaSyncResponseSchema } },
            description: 'Plays stored',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Push media plays',
        tags: ['Sync'],
      },
    },
    '/media/plays': {
      get: {
        description:
          'Media plays in a time window: MPRIS plays plus Last.fm scrobbles that are not duplicates of an MPRIS play. kind and played_ratio are derived at read time.',
        requestParams: { query: mediaPlaysQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: mediaPlaysResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Query media plays',
        tags: ['Media'],
      },
    },
    '/media/plays/top': {
      get: {
        description:
          'Plays in a time window grouped by artist, album ("artist — album") or track ("artist — title"): the total plays, the distinct count and the most played.',
        requestParams: { query: topMediaQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: topMediaResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Top artists, albums or tracks',
        tags: ['Media'],
      },
    },
    '/media/play': {
      get: {
        description:
          'One media play by id: an MPRIS play id, or a Last.fm scrobble external id when no MPRIS play has it. The id is a query parameter because Last.fm ids can contain "/".',
        requestParams: { query: mediaPlayQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: mediaPlayResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a media play',
        tags: ['Media'],
      },
    },

    '/sync/gravl': {
      post: {
        description:
          'Sync strength workouts from Gravl (gravl.ai): exercises with per-set weight, reps, RPE and set type. A workout that already reached Aurboda through Health Connect is enriched in place; otherwise a strength_training activity is created. Requires a Gravl OAuth connection or a personal token in user settings.',
        requestBody: {
          content: { 'application/json': { schema: syncGravlBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: gravlSyncResponseSchema } },
            description: 'Sync result',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Gravl integration unavailable',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Sync Gravl workouts',
        tags: ['Sync'],
      },
    },
    '/sync/gravl/status': {
      get: {
        description: 'Current Gravl sync state: last sync time, status, error and rate-limit hold.',
        responses: {
          200: {
            content: { 'application/json': { schema: gravlSyncStatusResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get Gravl sync status',
        tags: ['Sync'],
      },
    },

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

    '/export/dump-link': {
      post: {
        description:
          "Issue a short-lived link to download the authenticated user's whole database as a gzipped plain SQL dump (pg_dump). Fails before issuing a link when this server cannot produce the dump.",
        responses: {
          200: {
            content: { 'application/json': { schema: exportDumpLinkResponseSchema } },
            description: 'Download link',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'An export is already running',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'pg_dump is missing or older than the database server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Create a database export link',
        tags: ['Settings'],
      },
    },
    '/export/dump': {
      get: {
        description:
          'Stream the database dump named by a token from POST /export/dump-link, as `aurboda-<user>-<date>.sql.gz`. Authenticated by the token alone. See docs/data-export.md for restoring it.',
        requestParams: { query: exportDumpQuerySchema },
        responses: {
          200: {
            content: { 'application/gzip': { schema: z.string().meta({ format: 'binary' }) } },
            description: 'Gzipped plain SQL dump',
          },
          401: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid, expired or spent token',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'An export is already running',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'pg_dump is missing or older than the database server',
          },
        },
        summary: 'Download a database export',
        tags: ['Settings'],
      },
    },
    '/account': {
      delete: {
        description:
          "Permanently delete the authenticated user's account: the whole database, integration grants, central records and the public profile. Followers on other servers are sent a Delete of the actor, and the username is reserved so it can never be signed up again. Export the data first (POST /export/dump-link) if it should be kept.",
        requestBody: { content: { 'application/json': { schema: deleteAccountBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Account deleted',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'confirm_username does not match the account',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The account no longer exists',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The account is the last admin',
          },
          500: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The account database could not be dropped; retrying is safe',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete my account',
        tags: ['Settings'],
      },
    },
    '/account/email': {
      get: {
        description:
          "The authenticated user's email address. It is private: only the user and the server's admins see it, and it is never public or federated.",
        responses: {
          200: {
            content: { 'application/json': { schema: accountEmailResponseSchema } },
            description: 'The email address, or null',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get my email',
        tags: ['Settings'],
      },
      put: {
        description:
          "Set or clear the authenticated user's email address (null or an empty string clears it). Private: only the user and the server's admins see it. Nothing sends email to it yet. Allowed for a read-only account.",
        requestBody: { content: { 'application/json': { schema: updateAccountEmailBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: accountEmailResponseSchema } },
            description: 'The email address as stored',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a valid email address',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'The account has no account record yet (rare: one is created at the next server start)',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set my email',
        tags: ['Settings'],
      },
    },
    '/account/plan': {
      get: {
        description:
          "The authenticated user's billing plan and state. With billing enabled, an account whose trial or paid period ended more than the grace period ago is read-only: writes answer 402 with the payment link, while reading, exporting and deleting the account still work.",
        responses: {
          200: {
            content: { 'application/json': { schema: accountPlanResponseSchema } },
            description: 'The plan',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get my plan',
        tags: ['Settings'],
      },
    },
    '/admin/federation/resend-post-updates': {
      post: {
        description:
          "Re-send the Update of every public and unlisted post of every user on this server, so remote servers refresh their copy (such as the quote policy Mastodon cached as 'nobody' for posts federated before it was declared). Only Updates are sent, so repeating it is harmless. The posts are listed at once and delivered one after another in the background. Admin-only.",
        responses: {
          202: {
            content: { 'application/json': { schema: resendPostUpdatesResponseSchema } },
            description: 'The number of posts whose Update is being re-sent',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A re-send is already running on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Re-send post Updates',
        tags: ['Auth'],
      },
    },
    '/admin/relays': {
      get: {
        description:
          'The fediverse relays this server subscribes to, with their state. Accepted relays receive the public posts of every user on this server. Admin-only.',
        responses: {
          200: {
            content: { 'application/json': { schema: relaysResponseSchema } },
            description: 'Every relay, oldest first',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List relays',
        tags: ['Auth'],
      },
      post: {
        description:
          'Subscribe to a relay: the instance actor sends it a Follow and the relay stays pending until it answers. Style mastodon takes the relay inbox URL, litepub the relay actor URL. Admin-only.',
        requestBody: { content: { 'application/json': { schema: addRelayBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: relayResponseSchema } },
            description: 'The added relay',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not an https URL, or one that resolves to a private address',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The relay is already added',
          },
          422: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No relay actor could be resolved at the litepub URL',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a relay',
        tags: ['Auth'],
      },
    },
    '/admin/relays/{id}': {
      delete: {
        description:
          'Unsubscribe from a relay: sends it an Undo of the Follow and stops pushing posts to it. Admin-only.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Relay id' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Relay removed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Relay not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Remove a relay',
        tags: ['Auth'],
      },
    },
    '/admin/users/{username}/plan': {
      patch: {
        description:
          "Change a user's plan, paid-until date, trial end or note. Payments are recorded by hand. A future paid_until on a trial account switches it to the paid plan. Admin-only.",
        requestBody: { content: { 'application/json': { schema: updateUserPlanBodySchema } } },
        requestParams: {
          path: z.object({ username: z.string().meta({ description: 'Username' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: adminUserPlanResponseSchema } },
            description: 'The updated plan',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'User not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Change a user's plan",
        tags: ['Auth'],
      },
    },
    '/admin/users/{username}': {
      delete: {
        description:
          'Permanently delete a user, as DELETE /account does for oneself. Admin-only. The last admin cannot be deleted. Running it again for a deletion that failed part-way finishes it, even when the user no longer has a database.',
        requestBody: { content: { 'application/json': { schema: deleteAccountBodySchema } } },
        requestParams: {
          path: z.object({ username: z.string().meta({ description: 'Username' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'User deleted',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'confirm_username does not match the username',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'User not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The user is the last admin',
          },
          500: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The user database could not be dropped; retrying is safe',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a user',
        tags: ['Auth'],
      },
    },

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
    { description: 'Media plays (videos, music, podcasts)', name: 'Media' },
    { description: 'Federated challenges: hosted, joined, and public standings', name: 'Challenges' },
    { description: 'Social feed: posts, timeline and public tag pages', name: 'Feed' },
    { description: 'Named and detected locations', name: 'Locations' },
    { description: 'RescueTime productivity data', name: 'Productivity' },
    { description: 'User settings and preferences', name: 'Settings' },
    {
      description: 'Data synchronization with external services',
      name: 'Sync',
    },
  ],
})

// Admin routes are left out: an admin is never read-only, so the gate never refuses one.
const WRITE_METHODS = ['post', 'put', 'patch', 'delete'] as const
const mayBeRefusedWhenReadOnly = (path: string, method: string) =>
  !isAllowedWhenReadOnly(method, path) && !path.startsWith('/admin/')

interface GeneratedOperation {
  responses?: Record<string, unknown>
  security?: Record<string, unknown>[]
}

openApiDocument.components = {
  ...openApiDocument.components,
  responses: {
    ...openApiDocument.components?.responses,
    AccountReadOnly: {
      content: { 'application/json': { schema: { $ref: '#/components/schemas/AccountReadOnlyResponse' } } },
      description:
        'The account is read-only: its plan expired past the grace period, so no new data is stored until it is renewed',
    },
  },
}
for (const [path, item] of Object.entries(openApiDocument.paths ?? {})) {
  for (const method of WRITE_METHODS) {
    const operation = (item as Record<string, GeneratedOperation | undefined>)[method]
    if (!operation?.security?.some((s) => 'bearerAuth' in s)) continue
    if (!mayBeRefusedWhenReadOnly(path, method)) continue
    operation.responses = { ...operation.responses, 402: { $ref: '#/components/responses/AccountReadOnly' } }
  }
}

fs.mkdirSync('./generated', { recursive: true })
fs.writeFileSync('./generated/openapi.yaml', yaml.stringify(openApiDocument))
fs.writeFileSync('./generated/openapi.json', JSON.stringify(openApiDocument, null, 2))

console.info('Generated OpenAPI specification:')
console.info('  - generated/openapi.yaml')
console.info('  - generated/openapi.json')
