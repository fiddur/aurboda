/** Generates the OpenAPI 3.1 specification from the Zod schemas: pnpm generate:openapi */

import * as fs from 'node:fs'
import * as yaml from 'yaml'
import { z } from 'zod'
import { createDocument } from 'zod-openapi'

import { isAllowedWhenReadOnly } from './read-only.ts'
import {
  recoveryCompleteBodySchema,
  recoveryCompleteResponseSchema,
  recoveryRequestBodySchema,
  recoveryRequestResponseSchema,
  verifyEmailBodySchema,
} from './schemas/account-recovery.ts'
import { activitiesResponseSchema } from './schemas/activities.ts'
import {
  activityTypeCatalogQuerySchema,
  activityTypeCatalogResponseSchema,
} from './schemas/activity-type-catalog.ts'
import {
  addRelayBodySchema,
  adminTestEmailBodySchema,
  adminTestEmailResponseSchema,
  deleteAccountBodySchema,
  federationDeliveryFailuresResponseSchema,
  loginBodySchema,
  loginResponseSchema,
  relayResponseSchema,
  relaysResponseSchema,
  resendPostUpdatesResponseSchema,
  serverStatusResponseSchema,
} from './schemas/admin.ts'
import { skipAutoshareBodySchema, skipAutoshareResponseSchema } from './schemas/autoshare-rules.ts'
import {
  challengeCommentBodySchema,
  challengeThreadEntryResponseSchema,
  challengeThreadHideBodySchema,
  challengeThreadHideQuerySchema,
  challengeThreadQuerySchema,
  challengeThreadResponseSchema,
  publicChallengeThreadQuerySchema,
} from './schemas/challenge-thread.ts'
import {
  challengeParticipationsResponseSchema,
  challengePreviewQuerySchema,
  challengePreviewResponseSchema,
  challengeResponseSchema,
  challengesResponseSchema,
  discoverChallengesResponseSchema,
  challengeStandingsResponseSchema,
  joinedChallengeResponseSchema,
  updateChallengeBodySchema,
  wellKnownAurbodaSchema,
  wellKnownQuantpubSchema,
} from './schemas/challenges.ts'
import {
  addCheckInFormBodySchema,
  checkInFormResponseSchema,
  checkInFormsQuerySchema,
  checkInFormsResponseSchema,
  checkInResponseSchema,
  checkInsQuerySchema,
  checkInsResponseSchema,
  checkInTemplatesResponseSchema,
  dueQuerySchema,
  dueResponseSchema,
  submitCheckInBodySchema,
  updateCheckInBodySchema,
  updateCheckInFormBodySchema,
} from './schemas/check-ins.ts'
import {
  baseResponseSchemaMeta,
  iso8601DateTimeSchema,
  metricTypeSchema,
  timeWeightedAveragesNote,
} from './schemas/common.ts'
import { dailySummaryQuerySchema, dailySummaryResponseSchema } from './schemas/daily-summary.ts'
import {
  exerciseCatalogEntryResponseSchema,
  exerciseCatalogQuerySchema,
  exerciseCatalogSearchResponseSchema,
  exerciseMuscleGroupSchema,
} from './schemas/exercise-catalog.ts'
import { exportDumpLinkResponseSchema, exportDumpQuerySchema } from './schemas/export.ts'
import {
  FEED_IMAGE_MAX_EDGE,
  feedImageResponseSchema,
  feedImagesResponseSchema,
  MAX_FEED_IMAGE_BYTES,
  MAX_FEED_IMAGES_PER_ACCOUNT,
} from './schemas/feed-images.ts'
import {
  addPublicTagBlockBodySchema,
  publicTagBlockResponseSchema,
  publicTagBlocksResponseSchema,
  publicTagHiddenPostResponseSchema,
  publicTagHiddenPostsResponseSchema,
  publicTagPostsQuerySchema,
  publicTagPostsResponseSchema,
} from './schemas/feed.ts'
import {
  goalHistoryQuerySchema,
  goalHistoryResponseSchema,
  goalsProgressResponseSchema,
} from './schemas/goals.ts'
import { homeAssistantEntitiesResponseSchema } from './schemas/home-assistant.ts'
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
import { metricCatalogQuerySchema, metricCatalogResponseSchema } from './schemas/metric-catalog.ts'
import {
  addMetricBodySchema,
  addMetricResponseSchema,
  queryMetricsResponseSchema,
} from './schemas/metrics.ts'
import {
  muscleGroupHistoryQuerySchema,
  muscleGroupHistoryResponseSchema,
  muscleGroupsQuerySchema,
  muscleGroupsResponseSchema,
} from './schemas/muscle-groups.ts'
import {
  MUSCLE_RECOVERY_HISTORY_MAX_POINTS,
  muscleRecoveryHistoryQuerySchema,
  muscleRecoveryHistoryResponseSchema,
  muscleRecoveryQuerySchema,
  muscleRecoveryResponseSchema,
} from './schemas/muscle-recovery.ts'
import {
  deleteNoteAttachmentQuerySchema,
  deleteNoteAttachmentResponseSchema,
  MAX_ATTACHMENTS_PER_NOTE,
  NOTE_ATTACHMENT_MAX_BYTES,
  NOTE_ATTACHMENTS_ACCOUNT_BYTES,
  NOTE_IMAGE_MAX_EDGE,
  noteAttachmentContentQuerySchema,
  noteAttachmentResponseSchema,
  noteAttachmentsQuerySchema,
  noteAttachmentsResponseSchema,
} from './schemas/note-attachments.ts'
import {
  addNoteTemplateBodySchema,
  deleteNoteTemplateQuerySchema,
  deleteNoteTemplateResponseSchema,
  noteTemplateResponseSchema,
  noteTemplatesQuerySchema,
  noteTemplatesResponseSchema,
  updateNoteTemplateBodySchema,
} from './schemas/note-templates.ts'
import {
  addNoteBodySchema,
  deleteNoteQuerySchema,
  deleteNoteResponseSchema,
  noteConflictResponseSchema,
  noteResponseSchema,
  noteRevisionsResponseSchema,
  notesResponseSchema,
  notesSearchQuerySchema,
  notesSearchResponseSchema,
  updateNoteBodySchema,
} from './schemas/notes.ts'
import {
  addPushSubscriptionBodySchema,
  markAllNotificationsReadResponseSchema,
  notificationResponseSchema,
  notificationsQuerySchema,
  notificationsResponseSchema,
  notificationTypesResponseSchema,
  pushConfigResponseSchema,
  pushSubscriptionResponseSchema,
  pushSubscriptionsQuerySchema,
  pushSubscriptionsResponseSchema,
  sendTestPushResponseSchema,
  setNotificationPreferenceBodySchema,
  setNotificationPreferenceResponseSchema,
} from './schemas/notifications.ts'
import {
  addOidcProviderBodySchema,
  deleteOidcProviderQuerySchema,
  deleteOidcProviderResponseSchema,
  oidcCallbackQuerySchema,
  oidcExchangeBodySchema,
  oidcLinkCompleteBodySchema,
  oidcLinksResponseSchema,
  oidcLoginResponseSchema,
  oidcProviderResponseSchema,
  oidcProvidersResponseSchema,
  oidcPublicProvidersResponseSchema,
  oidcSignupBodySchema,
  oidcSignupInfoQuerySchema,
  oidcSignupInfoResponseSchema,
  oidcStartBodySchema,
  oidcStartResponseSchema,
  updateOidcProviderBodySchema,
} from './schemas/oidc.ts'
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
import {
  accountEmailResponseSchema,
  sendEmailVerificationResponseSchema,
  updateAccountEmailBodySchema,
} from './schemas/profile.ts'
import {
  addReminderBodySchema,
  reminderResponseSchema,
  remindersResponseSchema,
  updateReminderBodySchema,
} from './schemas/reminders.ts'
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
import {
  createSegmentBodySchema,
  promoteSuggestedSegmentBodySchema,
  segmentDetailResponseSchema,
  segmentMatchResponseSchema,
  segmentResponseSchema,
  segmentsQuerySchema,
  segmentsResponseSchema,
  suggestedSegmentScanResponseSchema,
  suggestedSegmentsResponseSchema,
  updateSegmentBodySchema,
} from './schemas/segments.ts'
import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.ts'
import { latestSleepResponseSchema, sleepDebtQuerySchema, sleepDebtResponseSchema } from './schemas/sleep.ts'
import {
  createStrengthPlanBodySchema,
  strengthPlanResponseSchema,
  strengthPlansQuerySchema,
  strengthPlansResponseSchema,
  updateStrengthPlanBodySchema,
} from './schemas/strength-plans.ts'
import {
  strengthScoreHistoryQuerySchema,
  strengthScoreHistoryResponseSchema,
  strengthScoreQuerySchema,
  strengthScoreResponseSchema,
} from './schemas/strength-score.ts'
import {
  dailyAggregatesBodySchema,
  healthConnectDeletionsBodySchema,
  healthConnectSyncBodySchema,
  reprocessGarminPushesBodySchema,
  reprocessGarminPushesResponseSchema,
  syncOuraBodySchema,
  syncGravlBodySchema,
  syncHomeAssistantBodySchema,
  gravlSyncResponseSchema,
  gravlSyncStatusResponseSchema,
  homeAssistantSyncResponseSchema,
  homeAssistantSyncStatusResponseSchema,
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
    '/challenges/{id}': {
      put: {
        description:
          'Update a challenge the authenticated user hosts; fields left out stay as they are. Once someone from another instance has joined, the scoring, dates and timezone are locked; the name and visibility can still change.',
        requestBody: { content: { 'application/json': { schema: updateChallengeBodySchema } } },
        requestParams: { path: z.object({ id: z.string().meta({ description: 'Challenge ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeResponseSchema } },
            description: 'The updated challenge',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Challenge not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The scoring, dates or timezone are locked',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a hosted challenge',
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
    '/challenges/participations/{id}': {
      get: {
        description:
          "A challenge the authenticated user joined, for the page on their own server: the participation, the host's page URL and, when the host can be read, the challenge and its standings as the host's page shows them (both absent otherwise).",
        requestParams: { path: z.object({ id: z.string().meta({ description: 'Participation ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: joinedChallengeResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such participation of the user',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a joined challenge',
        tags: ['Challenges'],
      },
    },
    '/challenges/thread': {
      get: {
        description:
          "A challenge's comment thread, as the authenticated user may see it: top-level entries newest first (20 a page), each with its replies oldest first. `participants` entries are shown to the host and members only; hidden entries only to the host. For a challenge hosted on another server, a member reads the copy of the host's thread kept here, pulled from the host when older than five minutes.",
        requestParams: { query: challengeThreadQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeThreadResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              "Not a challenge page URL, or the challenge's host offers no comments to other servers",
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A challenge on another server the user has not joined',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The challenge's host could not be reached and there is no copy of its thread yet",
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Read a challenge's comment thread",
        tags: ['Challenges'],
      },
    },
    '/challenges/thread/comments': {
      post: {
        description:
          'Comment in a challenge thread, or reply to an entry. The comment is a feed post of the author (edit or delete it through `PATCH`/`DELETE /feed/{postId}`). `participants` is for the host and members; an unlisted challenge takes only `participants`; a reply is never wider than its parent. A thread holds at most 2,000 entries.',
        requestBody: { content: { 'application/json': { schema: challengeCommentBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: challengeThreadEntryResponseSchema } },
            description: 'The new entry',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              "Blank comment, not a challenge page URL, or the challenge's host offers no comments to other servers",
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'The audience is not open to the user, or a challenge on another server the user has not joined',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge, or no such entry to reply to',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The thread is full',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Comment in a challenge thread',
        tags: ['Challenges'],
      },
    },
    '/challenges/thread/entries/{entryId}/hidden': {
      delete: {
        description:
          "Show a hidden thread entry again. The host of the challenge or an admin only, on the host's own server.",
        requestParams: {
          path: z.object({ entryId: z.string().meta({ description: 'Thread entry ID' }) }),
          query: challengeThreadHideQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeThreadEntryResponseSchema } },
            description: 'The entry',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not the host or an admin',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge or entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unhide a thread entry',
        tags: ['Challenges'],
      },
      post: {
        description:
          "Hide a thread entry (and, for a top-level entry, its replies) from everyone but the host. The host of the challenge or an admin only, on the host's own server.",
        requestBody: { content: { 'application/json': { schema: challengeThreadHideBodySchema } } },
        requestParams: { path: z.object({ entryId: z.string().meta({ description: 'Thread entry ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeThreadEntryResponseSchema } },
            description: 'The entry',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not the host or an admin',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge or entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Hide a thread entry',
        tags: ['Challenges'],
      },
    },
    '/public/{username}/challenges/{slug}/thread': {
      get: {
        description:
          "A challenge's comment thread as a visitor sees it: public entries that are not hidden. An unlisted challenge answers an empty thread. No authentication.",
        requestParams: {
          path: z.object({
            slug: z.string().meta({ description: 'Challenge slug' }),
            username: z.string().meta({ description: 'The host' }),
          }),
          query: publicChallengeThreadQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: challengeThreadResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such user or challenge',
          },
        },
        summary: "Read a challenge's public comment thread",
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
    '/autoshare-rules/skips': {
      post: {
        description:
          'Stop one activity (and the rest of its merge group) from being auto-shared. It can still be shared by hand.',
        requestBody: { content: { 'application/json': { schema: skipAutoshareBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: skipAutoshareResponseSchema } },
            description: 'The activities that will not be auto-shared',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Activity not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The activity is already shared',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Skip auto-sharing an activity',
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
        description:
          'Get activities of any type (sleep, exercise and its subtypes, meditation, custom types, ...) for a time range.',
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
    '/activity-type-catalog': {
      get: {
        description:
          "List Aurboda's built-in catalogue of activity types for things logged by hand (intake, meals and diet, health, symptoms, recovery, context), each with its fields. `in_use` says whether the user already has a type of that name, `missing_fields` which catalogue fields that type lacks (`POST /activity-types/{name}/catalog-fields` adds them), and `variants` the names that are the type with a field value set (`beer` is `alcohol` with kind beer). A type not in use becomes one of the user's types the first time an activity uses its name, or when `POST /activity-types` is given only its name. `q` matches word prefixes of the name, display name and aliases.",
        requestParams: { query: activityTypeCatalogQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: activityTypeCatalogResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List built-in activity type catalogue',
        tags: ['Activities'],
      },
    },
    '/exercise-catalog': {
      get: {
        description:
          'Search the built-in catalogue of strength, stretching and plyometric exercises by name (word prefixes of names, aliases and search terms, best matches first), equipment, muscle or category. `name` is an exact name-or-alias lookup (case and punctuation ignored) that returns that exercise or none and ignores `q`.',
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
    '/strength-plans': {
      get: {
        description:
          'List planned strength workouts. A plan is a named list of planned sets, for a day (`planned_for`) or, without one, a routine to start whenever. `sessions` are the strength activities started from it (their `data.plan_id` is its id), newest first. `status=open` (default) gives routines and the plans with a day that have no session yet; `all` also the done ones. Plans with a day come first, earliest first, then routines by name.',
        requestParams: { query: strengthPlansQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: strengthPlansResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List strength plans',
        tags: ['Activities'],
      },
      post: {
        description:
          'Plan a strength workout: a name, the sets in the order to do them, and `planned_for` for a workout on a day (left out for a routine). A set with an `exercise_key` that is not a key of the exercise catalogue is refused.',
        requestBody: { content: { 'application/json': { schema: createStrengthPlanBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: strengthPlanResponseSchema } },
            description: 'Plan created',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or an unknown exercise_key',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Create strength plan',
        tags: ['Activities'],
      },
    },
    '/strength-plans/{id}': {
      delete: {
        description: 'Delete a strength plan. Sessions started from it keep their `data.plan_id`.',
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Plan ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Plan deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Plan not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete strength plan',
        tags: ['Activities'],
      },
      get: {
        description: 'One strength plan with its sets and the sessions started from it.',
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Plan ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: strengthPlanResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Plan not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get strength plan',
        tags: ['Activities'],
      },
      patch: {
        description:
          'Change a strength plan: a field left out stays, `planned_for: null` and `note: null` clear, `sets` replaces the whole list. An empty body is refused.',
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Plan ID' }) }),
        },
        requestBody: { content: { 'application/json': { schema: updateStrengthPlanBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: strengthPlanResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid or empty body, or an unknown exercise_key',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Plan not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update strength plan',
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
    '/activity-types/{name}/muscle-groups': {
      get: {
        description:
          "Every muscle group of the exercise catalogue with when it was last trained: the start of the latest session of the type (or its subtypes) in which an exercise of the catalogue-backed item path trained it. For a group's sets over time, chart data takes filter_field=sets.exercise.muscle_group with the group as filter_value.",
        requestParams: { path: activityTypeNamePathSchema, query: muscleGroupsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: muscleGroupsResponseSchema } },
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
        summary: 'List muscle groups',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/muscle-groups/recovery': {
      get: {
        description:
          'Muscle recovery at a moment (default now; a later moment shows the recovery to come if nothing more is trained): per muscle group the share of the fatigue of the last 10 days that has worn off. Each working set of an exercise matched to the exercise catalogue adds 0.1 × its recruitment weight for the group × its effort (1.2 near failure, 0.7 easy, else 1), halving every 36 hours for large groups and 24 for the others from the end of the session; recovery is 100 × (1 − fatigue). 80 and above is ready; `ready_at` says when a group gets there.',
        requestParams: { path: activityTypeNamePathSchema, query: muscleRecoveryQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: muscleRecoveryResponseSchema } },
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
        summary: 'Get muscle recovery',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/muscle-groups/recovery/history': {
      get: {
        description:
          'Muscle recovery over a period (default the 14 days up to end, which defaults to now and may lie ahead): the recovery of every muscle group at end and every step_hours (default 6) before it down to start, oldest first.',
        requestParams: { path: activityTypeNamePathSchema, query: muscleRecoveryHistoryQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: muscleRecoveryHistoryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: `Start not before end, more than ${MUSCLE_RECOVERY_HISTORY_MAX_POINTS} points, or the field is not a catalogue-backed item field of the activity type`,
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get muscle recovery history',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/muscle-groups/{group}': {
      get: {
        description:
          "One muscle group's history over a period (default the last 90 days): its totals, every exercise logged for the type that trains it, and the sessions that did, newest first. Each set counts by the exercise's recruitment weight for the group (a bench press is 1 set for the chest, 0.5 for the shoulders).",
        requestParams: {
          path: activityTypeNamePathSchema.extend({ group: exerciseMuscleGroupSchema }),
          query: muscleGroupHistoryQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: muscleGroupHistoryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'Unknown muscle group, start not before end, or the field is not a catalogue-backed item field of the activity type',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get muscle group history',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/strength-score': {
      get: {
        description:
          'Strength score at a moment (default now): per reference lift the best estimated one-rep max (Epley) of the working sets with a weight in the last 90 days (reps above 12 count as 12), against a reference by sex and bodyweight (100 points: a solid recreational lifter); per muscle group the mean of its best 3 lifts, overall the mean of the groups. Only exercises matched to the exercise catalogue count. `missing` lists what the user has not given (sex in the settings, a weight); every score is then null.',
        requestParams: { path: activityTypeNamePathSchema, query: strengthScoreQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: strengthScoreResponseSchema } },
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
        summary: 'Get strength score',
        tags: ['Activities'],
      },
    },
    '/activity-types/{name}/strength-score/history': {
      get: {
        description:
          'The strength score over a period (default the last 365 days), one point every step_days (default 7) back from end, oldest first; each point looks back over its own 90 days. No points when sex or bodyweight is missing.',
        requestParams: { path: activityTypeNamePathSchema, query: strengthScoreHistoryQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: strengthScoreHistoryResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'Start not before end, more than 500 points, or the field is not a catalogue-backed item field of the activity type',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown activity type',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get strength score history',
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
    '/segments': {
      get: {
        description:
          'List segments with their effort count, best time and latest effort. Optionally only one activity type (and its descendant types); ordered by latest effort (default), effort count, length or name.',
        requestParams: { query: segmentsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List segments',
        tags: ['Segments'],
      },
      post: {
        description:
          'Create a segment from part of an activity track (seconds since its start) or of a route (km), then time every tracked activity of its type on it. Refused when shorter than 100 m, outside the track or route, for an activity without a track or a deleted route.',
        requestBody: {
          content: { 'application/json': { schema: createSegmentBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentDetailResponseSchema } },
            description: 'The new segment with its efforts',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The segment cannot be cut as asked',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Create segment',
        tags: ['Segments'],
      },
    },
    '/segments/suggested': {
      get: {
        description:
          'Pending suggested segments: stretches at least three activities of one type pass in the same direction on different routes. Most activities first, then longest.',
        responses: {
          200: {
            content: { 'application/json': { schema: suggestedSegmentsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List suggested segments',
        tags: ['Segments'],
      },
    },
    '/segments/suggested/scan': {
      post: {
        description:
          'Look through tracked activities not yet looked at for stretches passed often, for up to about 20 seconds. Run again while remaining > 0.',
        responses: {
          200: {
            content: { 'application/json': { schema: suggestedSegmentScanResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Scan for suggested segments',
        tags: ['Segments'],
      },
    },
    '/segments/suggested/{id}/promote': {
      post: {
        description:
          'Add a pending suggestion as a segment, optionally trimmed to start_km–end_km and named; every tracked activity of its type is timed on it. Refused like creating a segment (under 100 m, ends under 50 m apart, outside the line).',
        requestBody: {
          content: { 'application/json': { schema: promoteSuggestedSegmentBodySchema } },
        },
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Suggested segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentDetailResponseSchema } },
            description: 'The new segment with its efforts',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The segment cannot be cut as asked',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No pending suggestion with this ID',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add suggested segment',
        tags: ['Segments'],
      },
    },
    '/segments/suggested/{id}/dismiss': {
      post: {
        description: 'Dismiss a pending suggestion. The stretch is not suggested again.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Suggested segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No pending suggestion with this ID',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Dismiss suggested segment',
        tags: ['Segments'],
      },
    },
    '/segments/{id}': {
      delete: {
        description: 'Delete a segment and its efforts.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Segment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete segment',
        tags: ['Segments'],
      },
      get: {
        description:
          'A segment with its line, the named locations near its ends, and its efforts, newest first, the best one marked.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentDetailResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Segment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get segment',
        tags: ['Segments'],
      },
      patch: {
        description: 'Rename a segment.',
        requestBody: {
          content: { 'application/json': { schema: updateSegmentBodySchema } },
        },
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Segment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update segment',
        tags: ['Segments'],
      },
    },
    '/segments/{id}/match': {
      post: {
        description:
          'Time every tracked activity of the segment type on it again, replacing its efforts. New tracks are timed automatically.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Segment ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: segmentMatchResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Segment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Match segment',
        tags: ['Segments'],
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
          'Get a comprehensive summary of health data for a specific day including heart rate (avg time-weighted per 5-minute bin), steps, sleep, exercise, tags, productivity, and visited places.',
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

    '/sleep-debt': {
      get: {
        description:
          'Get sleep debt per night over a date range, against the sleep need you set (sleep_need_minutes, default 480). Each night debt = max(0, debt × 0.85 + need − slept), where slept is the total sleep of the nights ending on that date plus half of each nap over 20 minutes; a date with no night recorded only decays the debt. Severity is none, mild, moderate or severe by the ratio of debt to need.',
        requestParams: { query: sleepDebtQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: sleepDebtResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get sleep debt',
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

    '/status': {
      get: {
        description:
          'Public facts about this server the login and signup pages read: the signup mode, billing, contacts, whether it has an official feed and public tag pages, and whether it sends email (`email_enabled`: the login page offers a password reset or passkey recovery link only then).',
        responses: {
          200: {
            content: { 'application/json': { schema: serverStatusResponseSchema } },
            description: 'Server status',
          },
        },
        summary: 'Server status',
        tags: ['Auth'],
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
    '/metric-catalog': {
      get: {
        description:
          "List Aurboda's built-in metrics for lab values, circumferences and body composition, each with the unit it is stored in and the other units it accepts with their conversion. `in_use` says whether the user already has a metric of that name and `in_use_unit` the unit of that metric, which wins over the catalogue's. A metric not in use becomes one of the user's custom metrics the first time `POST /metrics`, `POST /metrics/bulk` or a report entry uses its name or an alias. `q` matches word prefixes of the name, display name and aliases.",
        requestParams: { query: metricCatalogQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: metricCatalogResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List built-in metric catalogue',
        tags: ['Metrics'],
      },
    },
    '/metrics': {
      post: {
        description:
          'Add a manual health metric measurement. `metric` may be a name or alias from the built-in metric catalogue (`GET /metric-catalog`), which is added on first use; `unit` converts the value to the unit the metric is stored in, and a unit that cannot be converted is refused.',
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
        description: `Get aggregated statistics for a time period. Returns min/max/avg/stddev for each metric, trend compared to previous period, and data completeness. ${timeWeightedAveragesNote}`,
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
    '/sync/garmin/reprocess-pushes': {
      post: {
        description:
          'Process the stored Connect with Garmin pushes again, the same way a fresh push is processed: every record Garmin pushed since the given time is queued, and each is read as it is stored now. For when processing failed or the processing changed.',
        requestBody: {
          content: { 'application/json': { schema: reprocessGarminPushesBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: reprocessGarminPushesResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Bad request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Process Garmin pushes again',
        tags: ['Sync'],
      },
    },

    '/notifications': {
      get: {
        description:
          'The newest notifications first, keyset-paginated. By default the in-app ones (the bell); `push_only` lists those meant for push delivery instead, which a device poller reads with `unread_only` and `after` (its high-water mark). `unread_count` always counts every unread in-app notification.',
        requestParams: { query: notificationsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: notificationsResponseSchema } },
            description: 'A page of notifications',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List notifications',
        tags: ['Notifications'],
      },
    },
    '/notifications/push/config': {
      get: {
        description:
          'Whether this server offers browser push (Web Push), and the VAPID public key to subscribe with. `enabled` is false when the web address is not HTTPS; `localhost` counts as allowed for development.',
        responses: {
          200: {
            content: { 'application/json': { schema: pushConfigResponseSchema } },
            description: 'The push configuration',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the browser push configuration',
        tags: ['Notifications'],
      },
    },
    '/notifications/push/subscriptions': {
      get: {
        description:
          "The browsers subscribed to this user's push notifications, oldest first. The keys are never returned. Give the SHA-256 of this browser's own endpoint as `endpoint_hash` to have its subscription marked `current`.",
        requestParams: { query: pushSubscriptionsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: pushSubscriptionsResponseSchema } },
            description: 'The subscribed browsers',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List push subscriptions',
        tags: ['Notifications'],
      },
      post: {
        description:
          'Subscribe a browser: the body is its `PushSubscription` JSON. Subscribing the same endpoint again updates it. The endpoint must be an HTTPS URL on a public address. A user keeps at most 20 subscriptions; past that the one that has gone longest without a push is dropped.',
        requestBody: { content: { 'application/json': { schema: addPushSubscriptionBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: pushSubscriptionResponseSchema } },
            description: 'The stored subscription',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or the endpoint is not an HTTPS URL on a public address',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'This server does not offer browser push',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Subscribe a browser to push',
        tags: ['Notifications'],
      },
    },
    '/notifications/push/subscriptions/{id}': {
      delete: {
        description: 'Remove a subscribed browser. It gets no more pushes from this server.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Subscription ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Removed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Subscription not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Remove a push subscription',
        tags: ['Notifications'],
      },
    },
    '/notifications/push/test': {
      post: {
        description:
          'Send "Aurboda can reach this browser" to every subscribed browser at once. It is not stored as a notification. Answers how many browsers accepted it.',
        responses: {
          200: {
            content: { 'application/json': { schema: sendTestPushResponseSchema } },
            description: 'How many browsers were reached',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'This server does not offer browser push',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Send a test push',
        tags: ['Notifications'],
      },
    },
    '/notifications/read-all': {
      post: {
        description: 'Mark every unread notification read.',
        responses: {
          200: {
            content: { 'application/json': { schema: markAllNotificationsReadResponseSchema } },
            description: 'How many were marked read',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Mark all notifications read',
        tags: ['Notifications'],
      },
    },
    '/notifications/types': {
      get: {
        description:
          "Every notification type this user can receive, with the user's in-app and push switches (both default on). Admin-only types are listed for admins only.",
        responses: {
          200: {
            content: { 'application/json': { schema: notificationTypesResponseSchema } },
            description: 'The notification types and their switches',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List notification types',
        tags: ['Notifications'],
      },
    },
    '/notifications/types/{type}': {
      put: {
        description:
          'Turn a notification type on or off in-app and/or as a push. Applies to notifications raised from now on. With both off, the type is not stored at all.',
        requestBody: { content: { 'application/json': { schema: setNotificationPreferenceBodySchema } } },
        requestParams: {
          path: z.object({ type: z.string().meta({ description: 'The notification type' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: setNotificationPreferenceResponseSchema } },
            description: 'The type and its switches after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Neither switch given',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such notification type for this user',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set a notification preference',
        tags: ['Notifications'],
      },
    },
    '/notifications/{id}/actions/{key}': {
      post: {
        description:
          'Run one of the actions a notification offers (its `actions` list). The server decides what the action does; running one marks the notification read and clears its actions, so an action runs at most once.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'Notification ID' }),
            key: z.string().meta({ description: 'The action key, from the notification’s `actions`' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: notificationResponseSchema } },
            description: 'The revised notification',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such notification, or it offers no such action (any more)',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The action could not be done (e.g. the activity was already shared)',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Run a notification action',
        tags: ['Notifications'],
      },
    },
    '/notifications/{id}/read': {
      post: {
        description: 'Mark one notification read. Marking an already read one keeps its first `read_at`.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Notification ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: notificationResponseSchema } },
            description: 'The notification',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Notification not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Mark a notification read',
        tags: ['Notifications'],
      },
    },

    '/notes': {
      post: {
        description:
          'Add a comment: on an entity, a reply, about a moment (`time`) or for a day (`day`, with `date`). Optional `title` (not on a reply) and `tags`; #hashtags in the content are tags too. Only `time` and `day` entries may have empty content.',
        requestBody: { content: { 'application/json': { schema: addNoteBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: noteResponseSchema } },
            description: 'The new comment',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a comment',
        tags: ['Notes'],
      },
    },
    '/notes/deleted': {
      get: {
        description:
          'The deleted comments that can still be restored, newest deletion first: deleted thread roots with the replies deleted with them, and deleted replies of live roots. Each has `deleted_at` and `purge_at`.',
        responses: {
          200: {
            content: { 'application/json': { schema: notesResponseSchema } },
            description: 'The deleted comments',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List deleted comments',
        tags: ['Notes'],
      },
    },
    '/notes/search': {
      get: {
        description:
          'Search and list comment thread roots, newest first, replies nested. Without filters it lists the free-standing entries (`time` and `day`), which is what the journal reads.',
        requestParams: { query: notesSearchQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: notesSearchResponseSchema } },
            description: 'A page of thread roots',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Search comments',
        tags: ['Notes'],
      },
    },
    '/notes/{id}': {
      delete: {
        description:
          'Delete a comment and, on a thread root, its replies. It can be restored for 30 days; `purge=true` removes it for good at once.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
          query: deleteNoteQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteNoteResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Comment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a comment',
        tags: ['Notes'],
      },
      patch: {
        description:
          "Change a comment's content, title or tags, and on a free-standing comment its anchor: times on a `time` entry, `date` on a `day` one (a date turns a `time` entry into a `day` one, a start_time the other way). With `expected_updated_at`, a comment changed since is a 409 carrying it as it now is. The replaced text is kept as a revision.",
        requestBody: { content: { 'application/json': { schema: updateNoteBodySchema } } },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteResponseSchema } },
            description: 'The comment after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Comment not found',
          },
          409: {
            content: { 'application/json': { schema: noteConflictResponseSchema } },
            description: 'Changed since expected_updated_at; nothing was written',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a comment',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/restore': {
      post: {
        description:
          'Restore a deleted comment, with the replies deleted with it. A reply whose root is deleted is a 409. A comment that is not deleted is answered as it is.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteResponseSchema } },
            description: 'The restored comment',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Comment not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Restore the comment it replies to first',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore a comment',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/revisions': {
      get: {
        description: "A comment's earlier texts (content and title), newest first.",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteRevisionsResponseSchema } },
            description: 'The revisions',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Comment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List comment revisions',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/attachments': {
      get: {
        description:
          "A journal entry's live pictures and recordings in page order, or with `deleted=true` its deleted ones that can still be restored, with `deleted_at` and `purge_at`.",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
          query: noteAttachmentsQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteAttachmentsResponseSchema } },
            description: 'The attachments',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a journal entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Entry not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List entry attachments',
        tags: ['Notes'],
      },
      post: {
        description: `Attach a picture or a recording to a journal entry (a \`time\` or \`day\` thread root), one file per request in page order. A picture (PNG, JPEG, WebP or GIF, by its content) is stored as WebP, turned upright, without metadata, with its longest edge at most ${NOTE_IMAGE_MAX_EDGE} px; a recording (WebM, Ogg, MP4/M4A, MP3 or WAV, by its first bytes) is stored as it is. At most ${NOTE_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB per file, ${MAX_ATTACHMENTS_PER_NOTE} per entry and ${NOTE_ATTACHMENTS_ACCOUNT_BYTES / 1024 / 1024 / 1024} GB per account.`,
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: z.object({
                file: z.string().meta({ description: 'The picture or recording', format: 'binary' }),
              }),
            },
          },
        },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          201: {
            content: { 'application/json': { schema: noteAttachmentResponseSchema } },
            description: 'The stored attachment',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No file, not a picture or recording Aurboda keeps, or not a journal entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Entry not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The entry or the account holds as much as it may',
          },
          413: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The file is too large',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add an entry attachment',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/attachments/{attachment_id}': {
      delete: {
        description:
          'Delete an attachment. It can be restored for 30 days; `purge=true` removes it for good at once.',
        requestParams: {
          path: z.object({
            attachment_id: z.string().uuid().meta({ description: 'Attachment ID' }),
            id: z.string().uuid().meta({ description: 'Note ID' }),
          }),
          query: deleteNoteAttachmentQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteNoteAttachmentResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Attachment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete an entry attachment',
        tags: ['Notes'],
      },
      get: {
        description:
          "The attachment's bytes, with its stored type, to its owner only. `max_edge` downscales a picture (WebP). A deleted attachment, or one on a deleted entry, is a 404. Cached privately for a year: an attachment's bytes never change.",
        requestParams: {
          path: z.object({
            attachment_id: z.string().uuid().meta({ description: 'Attachment ID' }),
            id: z.string().uuid().meta({ description: 'Note ID' }),
          }),
          query: noteAttachmentContentQuerySchema,
        },
        responses: {
          200: {
            content: {
              'audio/*': { schema: z.string().meta({ format: 'binary' }) },
              'image/webp': { schema: z.string().meta({ format: 'binary' }) },
            },
            description: 'The picture or recording',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid max_edge',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Attachment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get an entry attachment',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/attachments/{attachment_id}/restore': {
      post: {
        description: `Restore a deleted attachment. A 409 when the entry already holds ${MAX_ATTACHMENTS_PER_NOTE}.`,
        requestParams: {
          path: z.object({
            attachment_id: z.string().uuid().meta({ description: 'Attachment ID' }),
            id: z.string().uuid().meta({ description: 'Note ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteAttachmentResponseSchema } },
            description: 'The restored attachment',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Attachment not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The entry holds as many attachments as it may',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore an entry attachment',
        tags: ['Notes'],
      },
    },
    '/note-templates': {
      get: {
        description:
          'The journal entry templates by name, or with `deleted=true` the deleted ones that can still be restored, with `deleted_at` and `purge_at`.',
        requestParams: { query: noteTemplatesQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: noteTemplatesResponseSchema } },
            description: 'The templates',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List entry templates',
        tags: ['Notes'],
      },
      post: {
        description: 'Add a journal entry template: a name and the markdown text a new entry starts from.',
        requestBody: { content: { 'application/json': { schema: addNoteTemplateBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: noteTemplateResponseSchema } },
            description: 'The new template',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add an entry template',
        tags: ['Notes'],
      },
    },
    '/note-templates/{id}': {
      delete: {
        description:
          'Delete a template. It can be restored for 30 days; `purge=true` removes it for good at once.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Template ID' }) }),
          query: deleteNoteTemplateQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteNoteTemplateResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Template not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete an entry template',
        tags: ['Notes'],
      },
      patch: {
        description: "Change a template's name or text.",
        requestBody: { content: { 'application/json': { schema: updateNoteTemplateBodySchema } } },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Template ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteTemplateResponseSchema } },
            description: 'The template after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Template not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update an entry template',
        tags: ['Notes'],
      },
    },
    '/note-templates/{id}/restore': {
      post: {
        description: 'Restore a deleted template. A template that is not deleted is answered as it is.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Template ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteTemplateResponseSchema } },
            description: 'The restored template',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Template not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore an entry template',
        tags: ['Notes'],
      },
    },

    '/check-in-forms': {
      get: {
        description:
          "The user's check-in forms with their questions, score, schedule and current version; `deleted=true` lists the deleted ones, restorable for 30 days.",
        requestParams: { query: checkInFormsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormsResponseSchema } },
            description: 'The forms',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List check-in forms',
        tags: ['Check-ins'],
      },
      post: {
        description:
          'Create a check-in form, from `name` and `questions` or by copying a `template` (the other fields override its own). An answer to a question with `logs_to` is logged as a metric point; a metric name that does not exist yet becomes a custom metric on first use.',
        requestBody: { content: { 'application/json': { schema: addCheckInFormBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormResponseSchema } },
            description: 'The new form',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, unknown template, or a metric that cannot take check-in points',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a check-in form',
        tags: ['Check-ins'],
      },
    },
    '/check-in-forms/{id}': {
      delete: {
        description:
          'Delete a check-in form: it stops asking and its check-ins stay readable. Restorable for 30 days, then purged with its check-ins.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Check-in form ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormResponseSchema } },
            description: 'The deleted form',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a check-in form',
        tags: ['Check-ins'],
      },
      get: {
        description: 'One check-in form, deleted or not.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Check-in form ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormResponseSchema } },
            description: 'The form',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a check-in form',
        tags: ['Check-ins'],
      },
      patch: {
        description:
          'Change a check-in form. `questions` replaces them all; a change to a question other than its place, or to the score, makes a new version. A removed question key cannot come back with another type. A new or changed schedule starts with its next slot.',
        requestBody: { content: { 'application/json': { schema: updateCheckInFormBodySchema } } },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Check-in form ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormResponseSchema } },
            description: 'The form after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a check-in form',
        tags: ['Check-ins'],
      },
    },
    '/check-in-forms/{id}/restore': {
      post: {
        description: 'Restore a deleted check-in form; its schedule starts again with its next slot.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Check-in form ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInFormResponseSchema } },
            description: 'The restored form',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No deleted check-in form with that ID',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore a check-in form',
        tags: ['Check-ins'],
      },
    },
    '/check-in-templates': {
      get: {
        description:
          'Built-in check-in forms to copy with `template` on POST /check-in-forms, each with its source and licence.',
        responses: {
          200: {
            content: { 'application/json': { schema: checkInTemplatesResponseSchema } },
            description: 'The templates',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List check-in templates',
        tags: ['Check-ins'],
      },
    },
    '/check-ins': {
      get: {
        description:
          'Check-ins newest first, each with its form name and the questions of the version it answered.',
        requestParams: { query: checkInsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInsResponseSchema } },
            description: 'The check-ins',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List check-ins',
        tags: ['Check-ins'],
      },
      post: {
        description:
          "Save a check-in against the form's current version. Answers to questions with `logs_to` are logged as metric points at `answered_at` with data source `check_in`; 0, no, or no answer logs nothing. The due notification of a slot it does is marked read.",
        requestBody: { content: { 'application/json': { schema: submitCheckInBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInResponseSchema } },
            description: 'The check-in',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or answers',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Submit a check-in',
        tags: ['Check-ins'],
      },
    },
    '/check-ins/{id}': {
      delete: {
        description: 'Delete a check-in and the metric points it logged. Restorable for 30 days.',
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Check-in ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInResponseSchema } },
            description: 'The deleted check-in',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a check-in',
        tags: ['Check-ins'],
      },
      patch: {
        description:
          'Change a check-in. Answers are read against the version it answered; changing them or the time replaces exactly the metric points it logged.',
        requestBody: { content: { 'application/json': { schema: updateCheckInBodySchema } } },
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Check-in ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInResponseSchema } },
            description: 'The check-in after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or answers',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a check-in',
        tags: ['Check-ins'],
      },
    },
    '/check-ins/{id}/restore': {
      post: {
        description: 'Restore a deleted check-in; the metric points it logged are written again.',
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Check-in ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInResponseSchema } },
            description: 'The restored check-in',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore a check-in',
        tags: ['Check-ins'],
      },
    },
    '/due': {
      get: {
        description:
          "The slots of the user's scheduled check-in forms on a day, each `upcoming`, `due`, `done` or `missed`.",
        requestParams: { query: dueQuerySchema },
        responses: {
          200: { content: { 'application/json': { schema: dueResponseSchema } }, description: 'The slots' },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid date',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List due check-ins',
        tags: ['Check-ins'],
      },
    },

    '/reminders': {
      get: {
        description:
          "The user's recurring reminders, each with `next_due_at` (the next instant it raises a `reminder` notification, null when switched off), the earliest of those, and the time zone the times are read in.",
        responses: {
          200: {
            content: { 'application/json': { schema: remindersResponseSchema } },
            description: 'The reminders',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List reminders',
        tags: ['Reminders'],
      },
      post: {
        description:
          "Create a recurring reminder. It raises a `reminder` notification at `time_of_day` (in the user's time zone) on each of `weekdays`; one created after today's time starts with the next matching day.",
        requestBody: { content: { 'application/json': { schema: addReminderBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: reminderResponseSchema } },
            description: 'The new reminder',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a reminder',
        tags: ['Reminders'],
      },
    },
    '/reminders/{id}': {
      delete: {
        description: 'Delete a reminder. Notifications it already raised stay.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Reminder ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reminder not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a reminder',
        tags: ['Reminders'],
      },
      patch: {
        description:
          'Change a reminder. Changing the time or the days, or switching it back on, starts it afresh: an occurrence earlier today is not raised.',
        requestBody: { content: { 'application/json': { schema: updateReminderBodySchema } } },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Reminder ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: reminderResponseSchema } },
            description: 'The reminder after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reminder not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a reminder',
        tags: ['Reminders'],
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

    '/sync/home-assistant': {
      post: {
        description:
          "Pull the phone's positions from Home Assistant's history API (the configured device_tracker.* or person.* entity) and store them as locations with source home_assistant; the zone the state names becomes the location's region. A first sync or full_resync covers the last 10 days (or from start_date); later syncs continue from the last sync with a 5-minute overlap. Points inside an activity that has its own GPS track are soft-deleted. Requires home_assistant_url, home_assistant_token and home_assistant_entity_id in user settings.",
        requestBody: {
          content: { 'application/json': { schema: syncHomeAssistantBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: homeAssistantSyncResponseSchema } },
            description: 'Sync result',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Home Assistant integration unavailable',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Sync Home Assistant locations',
        tags: ['Sync'],
      },
    },
    '/sync/home-assistant/status': {
      get: {
        description: 'Current Home Assistant sync state: last sync time, status and error.',
        responses: {
          200: {
            content: { 'application/json': { schema: homeAssistantSyncStatusResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get Home Assistant sync status',
        tags: ['Sync'],
      },
    },
    '/home-assistant/entities': {
      get: {
        description:
          'List the person.* and device_tracker.* entities of the configured Home Assistant server that currently carry coordinates, to pick the one to pull locations from. Needs home_assistant_url and home_assistant_token in user settings; doubles as a connection test.',
        responses: {
          200: {
            content: { 'application/json': { schema: homeAssistantEntitiesResponseSchema } },
            description: 'Trackable entities, person.* first',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Home Assistant URL or token not set',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Home Assistant could not be reached or rejected the request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List Home Assistant tracker entities',
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

    '/auth/oidc/providers': {
      get: {
        description:
          'The enabled single sign-on (OpenID Connect) providers, for the login and signup pages. Public.',
        responses: {
          200: {
            content: { 'application/json': { schema: oidcPublicProvidersResponseSchema } },
            description: 'Enabled providers',
          },
        },
        summary: 'List sign-in providers',
        tags: ['Auth'],
      },
    },
    '/auth/oidc/{provider}/start': {
      post: {
        description:
          "Begin a login (or a signup, when the provider allows it) through a provider: returns the provider's authorization URL to send the browser to. Authorization Code with PKCE; the state, nonce and verifier stay on the server.",
        requestBody: { content: { 'application/json': { schema: oidcStartBodySchema } } },
        requestParams: { path: z.object({ provider: z.string().meta({ description: 'Provider id' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcStartResponseSchema } },
            description: 'Where to send the browser',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such enabled provider',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The provider could not be reached',
          },
        },
        summary: 'Start a provider sign-in',
        tags: ['Auth'],
      },
    },
    '/auth/oidc/callback': {
      get: {
        description:
          'The one redirect URI registered with every provider. Always answers with a 302 to the web: /login/oidc#code=… after a login, /signup/oidc#code=… for a new account, /settings/oidc-link#code=… for a link, or /login?oidc_error=<code> (/settings?oidc_error=<code> for a link) when it fails. Nothing is signed in or linked here: the browser that started the flow trades the code together with the verifier its start answered with, and the session token never travels in a URL.',
        requestParams: { query: oidcCallbackQuerySchema },
        responses: { 302: { description: 'Redirect to the web' } },
        summary: 'Provider redirect target',
        tags: ['Auth'],
      },
    },
    '/auth/oidc/exchange': {
      post: {
        description:
          'Trade the one-time login code (valid 60 seconds) and the verifier of the start for a session token.',
        requestBody: { content: { 'application/json': { schema: oidcExchangeBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcLoginResponseSchema } },
            description: 'Signed in',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown, used or expired code, or a verifier that does not match it',
          },
        },
        summary: 'Finish a provider login',
        tags: ['Auth'],
      },
    },
    '/auth/oidc/signup-info': {
      get: {
        description:
          'What the provider said about a new user, for the signup form: the provider, the email and a suggested username. Does not use up the code (valid 5 minutes).',
        requestParams: { query: oidcSignupInfoQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcSignupInfoResponseSchema } },
            description: 'The signup details',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown, used or expired code',
          },
        },
        summary: 'Provider signup details',
        tags: ['Auth'],
      },
    },
    '/auth/oidc/signup': {
      post: {
        description:
          'Create an account for a provider identity with the chosen username, link the identity and sign in. Needs the verifier of the start. Goes through the same checks as a password signup; the account has no password its user knows.',
        requestBody: { content: { 'application/json': { schema: oidcSignupBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcLoginResponseSchema } },
            description: 'Signed up and in',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid username, or an expired code or a verifier that does not match it',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Signup closed or invitation invalid',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Username taken, or the identity is linked already',
          },
        },
        summary: 'Sign up through a provider',
        tags: ['Auth'],
      },
    },
    '/account/oidc/{provider}/link/start': {
      post: {
        description:
          "Begin linking a provider identity to the signed-in account: returns the provider's authorization URL. Web only, like the rest of linking.",
        requestParams: { path: z.object({ provider: z.string().meta({ description: 'Provider id' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcStartResponseSchema } },
            description: 'Where to send the browser',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such enabled provider',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Start linking a provider',
        tags: ['Auth'],
      },
    },
    '/account/oidc/link/complete': {
      post: {
        description:
          "Finish linking: the code the provider's redirect put on /settings/oidc-link (valid 5 minutes) and the verifier of the link start, from the account that started it.",
        requestBody: { content: { 'application/json': { schema: oidcLinkCompleteBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Linked (or linked to this account already)',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Unknown, used or expired code, another account, or a verifier that does not match',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The identity is linked to another account',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Complete linking a provider',
        tags: ['Auth'],
      },
    },
    '/account/oidc/links': {
      get: {
        description:
          'The provider identities linked to the signed-in account, and how many ways it has to log in.',
        responses: {
          200: {
            content: { 'application/json': { schema: oidcLinksResponseSchema } },
            description: 'Linked providers',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List linked providers',
        tags: ['Auth'],
      },
    },
    '/account/oidc/links/{id}': {
      delete: {
        description: 'Unlink a provider identity. Refused when it is the last way the account can log in.',
        requestParams: { path: z.object({ id: z.uuid().meta({ description: 'Link id' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Unlinked',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such link',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The last login method',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unlink a provider',
        tags: ['Auth'],
      },
    },
    '/admin/oidc-providers': {
      get: {
        description:
          'The single sign-on providers, with the redirect URI to register with each. The client secret is never returned. Admin-only.',
        responses: {
          200: {
            content: { 'application/json': { schema: oidcProvidersResponseSchema } },
            description: 'Every provider',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List sign-in providers (admin)',
        tags: ['Auth'],
      },
      post: {
        description:
          'Add a single sign-on provider. The issuer must be https and answer with an OpenID Connect discovery document. Admin-only.',
        requestBody: { content: { 'application/json': { schema: addOidcProviderBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: oidcProviderResponseSchema } },
            description: 'The added provider',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not an https issuer, or not an OpenID Connect issuer',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The id is taken',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a sign-in provider',
        tags: ['Auth'],
      },
    },
    '/admin/oidc-providers/{id}': {
      delete: {
        description:
          'Delete a provider and its links. Refused with the count when a linked user would be left with no way to log in, unless force=true. Admin-only.',
        requestParams: {
          path: z.object({ id: z.string().meta({ description: 'Provider id' }) }),
          query: deleteOidcProviderQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteOidcProviderResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such provider',
          },
          409: {
            content: { 'application/json': { schema: deleteOidcProviderResponseSchema } },
            description: 'Users would be left without a login method',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a sign-in provider',
        tags: ['Auth'],
      },
      put: {
        description:
          'Change a provider; an omitted field, the client secret included, keeps its value. Admin-only.',
        requestBody: { content: { 'application/json': { schema: updateOidcProviderBodySchema } } },
        requestParams: { path: z.object({ id: z.string().meta({ description: 'Provider id' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: oidcProviderResponseSchema } },
            description: 'The changed provider',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not an https issuer, or not an OpenID Connect issuer',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such provider',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Change a sign-in provider',
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
          "The authenticated user's email address, whether it is verified, and whether this server sends email. It is private: only the user and the server's admins see it, and it is never public or federated.",
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
          "Set or clear the authenticated user's email address (null or an empty string clears it). Private: only the user and the server's admins see it. A changed address is unverified; when the server sends email, a verification link goes to it (at most 3 a hour). Allowed for a read-only account.",
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
    '/account/email/verification': {
      post: {
        description:
          "Send a new verification link to the authenticated user's email address (valid 24 hours; it replaces any earlier link). At most 3 verification mails per account per hour. Allowed for a read-only account.",
        responses: {
          200: {
            content: { 'application/json': { schema: sendEmailVerificationResponseSchema } },
            description: 'Sent, or already verified',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No email address is set',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'This server does not send email',
          },
          429: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Too many verification mails for this account in the last hour',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The mail server refused or could not be reached',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Resend my email verification link',
        tags: ['Settings'],
      },
    },
    '/account/email/verify': {
      post: {
        description:
          'Confirm an account email address with the token from its emailed link (the web page `/verify-email?token=…` posts it). Public: the token is the credential. It verifies only while the account still has the address the link was sent to. Unknown, used and expired tokens get the same answer. No MCP twin, like `/login`.',
        requestBody: { content: { 'application/json': { schema: verifyEmailBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'The address is verified',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The link is invalid, used or expired',
          },
        },
        summary: 'Verify an email address',
        tags: ['Auth'],
      },
    },
    '/account/recovery/request': {
      post: {
        description:
          "Ask for a password reset or passkey recovery link by username or email address. Always the same answer, whatever matched: the lookup and the mail happen afterwards. A username gets a link at that account's verified email; an email address gets one per account with that verified address (at most 5). Unverified addresses never get mail, and an account gets at most 3 links an hour. The link (`/recover?token=…`) is valid 30 minutes, once. Public and rate-limited per client IP. No MCP twin, like `/login`.",
        requestBody: { content: { 'application/json': { schema: recoveryRequestBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: recoveryRequestResponseSchema } },
            description: 'Accepted (says nothing about whether an account matched)',
          },
        },
        summary: 'Request an account recovery link',
        tags: ['Auth'],
      },
    },
    '/account/recovery/complete': {
      post: {
        description:
          "Use a recovery link: with `new_password`, sets the account's password; without it, changes nothing about the password. Either way the answer is a session token like `/login`'s, with the username, so the user can then add a new passkey. The link works once, within 30 minutes, and only while the address it went to is still the account's verified email. Works for a read-only account. Public and rate-limited per client IP. No MCP twin, like `/login`.",
        requestBody: { content: { 'application/json': { schema: recoveryCompleteBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: recoveryCompleteResponseSchema } },
            description: 'Signed in',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The link is invalid, used or expired',
          },
        },
        summary: 'Complete account recovery',
        tags: ['Auth'],
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
    '/admin/email/test': {
      post: {
        description:
          "Send a fixed test mail with the server's SMTP settings, to `to` or else the admin's own account email (verified or not). The answer carries the SMTP error on failure, to fix the settings by. At most 10 an hour per admin. Admin-only; REST only, like the other server settings.",
        requestBody: { content: { 'application/json': { schema: adminTestEmailBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: adminTestEmailResponseSchema } },
            description: 'Sent',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No address given and the admin has no account email, or email is not configured',
          },
          429: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Too many test mails',
          },
          502: {
            content: { 'application/json': { schema: adminTestEmailResponseSchema } },
            description: 'The mail server refused or could not be reached; `error` says why',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Send a test mail',
        tags: ['Auth'],
      },
    },
    '/admin/federation/delivery-failures': {
      get: {
        description:
          'The remote servers whose inboxes the outbound delivery queue could not reach, with the status of the latest failure. A server leaves the list when it accepts a delivery again. Recorded only while deliveries are queued (the server has a job queue). Admin-only.',
        responses: {
          200: {
            content: { 'application/json': { schema: federationDeliveryFailuresResponseSchema } },
            description: 'Servers whose latest deliveries failed, most recent failure first',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List failing delivery servers',
        tags: ['Auth'],
      },
    },
    '/admin/federation/resend-post-updates': {
      post: {
        description:
          "Re-send the Update of every public and unlisted post of every user on this server, so remote servers refresh their copy (such as the quote policy Mastodon cached as 'nobody' for posts federated before it was declared). Only Updates are sent, so repeating it is harmless. The posts are listed at once and handed to delivery one after another in the background, where a failed inbox is retried. Admin-only.",
        responses: {
          202: {
            content: { 'application/json': { schema: resendPostUpdatesResponseSchema } },
            description: 'The number of posts whose Update is being queued for re-sending',
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
    '/admin/public-tag-posts/{id}': {
      delete: {
        description:
          'Hide one post from the public tag pages and the official feed: the post is removed and its object id is remembered, so a later Announce or edit does not bring it back. Admin-only.',
        requestParams: {
          path: z.object({
            id: z.string().uuid().meta({ description: 'The post id, as the tag page lists it' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: publicTagHiddenPostResponseSchema } },
            description: 'The post is hidden',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such post on the tag pages',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Hide a tag page post',
        tags: ['Auth'],
      },
    },
    '/admin/public-tag-hidden': {
      get: {
        description: 'The posts hidden from the public tag pages, newest first, at most 200. Admin-only.',
        responses: {
          200: {
            content: { 'application/json': { schema: publicTagHiddenPostsResponseSchema } },
            description: 'Hidden posts',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List hidden tag page posts',
        tags: ['Auth'],
      },
    },
    '/admin/public-tag-hidden/{id}': {
      delete: {
        description:
          'Stop hiding a post. Nothing is fetched back: the post returns when it is announced or edited again. Admin-only.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Id of the hide' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'No longer hidden',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not hidden',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unhide a tag page post',
        tags: ['Auth'],
      },
    },
    '/admin/public-tag-blocks': {
      get: {
        description: 'The authors and domains kept off the public tag pages, newest first. Admin-only.',
        responses: {
          200: {
            content: { 'application/json': { schema: publicTagBlocksResponseSchema } },
            description: 'Every block',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List tag page blocks',
        tags: ['Auth'],
      },
      post: {
        description:
          "Keep an author (kind actor, by actor URI) or a domain and its subdomains (kind domain) off the public tag pages and the official feed. The posts it matches are removed at once and new ones are not stored. This server's own host cannot be blocked. Admin-only.",
        requestBody: { content: { 'application/json': { schema: addPublicTagBlockBodySchema } } },
        responses: {
          201: {
            content: { 'application/json': { schema: publicTagBlockResponseSchema } },
            description: 'The block, and how many posts it removed',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "Not an http(s) actor URI, not a domain, or this server's own host",
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Already blocked',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Block an author or domain from the tag pages',
        tags: ['Auth'],
      },
    },
    '/admin/public-tag-blocks/{id}': {
      delete: {
        description:
          'Remove a block. Nothing is fetched back: posts return as they are announced or edited again. Admin-only.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Block id' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Block removed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Block not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Remove a tag page block',
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
    { description: 'Comments on anything, and journal entries', name: 'Notes' },
    { description: 'Notifications: the bell, read state and per-type switches', name: 'Notifications' },
    { description: 'RescueTime productivity data', name: 'Productivity' },
    {
      description: 'Check-in forms, their answers logged as metrics, and their schedules',
      name: 'Check-ins',
    },
    { description: 'Recurring reminders delivered as notifications', name: 'Reminders' },
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
