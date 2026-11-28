/** Generates the OpenAPI 3.1 specification from the Zod schemas: pnpm generate:openapi */

import * as fs from 'node:fs'
import * as yaml from 'yaml'
import { z } from 'zod'
import { createDocument } from 'zod-openapi'

import { kotlinOpenApiDocument } from './openapi-kotlin-filter.ts'
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
  challengePostFollowBodySchema,
  challengePostFollowResponseSchema,
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
  checkInAdherenceQuerySchema,
  checkInAdherenceResponseSchema,
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
import {
  activityImpactQuerySchema,
  activityImpactResponseSchema,
  baselineQuerySchema,
  baselineResponseSchema,
  continuousCorrelationBodySchema,
  continuousCorrelationResponseSchema,
  correlationSelectorsResponseSchema,
  eventProbabilityBodySchema,
  eventProbabilityResponseSchema,
  genericCorrelationBodySchema,
  genericCorrelationResponseSchema,
  hrvActivitiesQuerySchema,
  hrvActivitiesResponseSchema,
  impactMetricsQuerySchema,
  impactMetricsResponseSchema,
} from './schemas/correlations.ts'
import { dailySummaryQuerySchema, dailySummaryResponseSchema } from './schemas/daily-summary.ts'
import { recentActivitiesQuerySchema } from './schemas/dashboard.ts'
import { dataSourcesOverviewResponseSchema } from './schemas/data-sources-overview.ts'
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
  articleDraftResponseSchema,
  articleDraftsResponseSchema,
  articleExportResponseSchema,
  articlePreviewResponseSchema,
  createArticleBodySchema,
  createArticleDraftBodySchema,
  dashboardSharePreviewResponseSchema,
  exerciseSharePreviewResponseSchema,
  feedPostReactionsResponseSchema,
  feedPostRepliesResponseSchema,
  feedPostResponseSchema,
  feedPostsQuerySchema,
  feedPostsResponseSchema,
  followActorBodySchema,
  followActorResponseSchema,
  followedTagsResponseSchema,
  followerResponseSchema,
  followersQuerySchema,
  followersResponseSchema,
  followingResponseSchema,
  followTagBodySchema,
  followTagResponseSchema,
  previewArticleBodySchema,
  publicTagBlockResponseSchema,
  publicTagBlocksResponseSchema,
  publicTagHiddenPostResponseSchema,
  publicTagHiddenPostsResponseSchema,
  publicTagPostsQuerySchema,
  publicTagPostsResponseSchema,
  publishArticleDraftBodySchema,
  replyToPostBodySchema,
  shareActivityBodySchema,
  shareChallengeBodySchema,
  shareDashboardPeriodBodySchema,
  shareExerciseBodySchema,
  sharePreviewResponseSchema,
  timelineEntryResponseSchema,
  timelineQuerySchema,
  timelineRepliesResponseSchema,
  timelineResponseSchema,
  updateArticleBodySchema,
  updateArticleDraftBodySchema,
  updateFeedPostBodySchema,
  updateFollowingBodySchema,
} from './schemas/feed.ts'
import {
  addFoodItemPortionBodySchema,
  deleteFoodItemPortionResponseSchema,
  foodItemPortionResponseSchema,
  foodItemPortionsResponseSchema,
  setDefaultFoodItemPortionBodySchema,
  updateFoodItemPortionBodySchema,
} from './schemas/food-item-portions.ts'
import {
  addFoodItemBodySchema,
  deleteFoodItemResponseSchema,
  findFoodByBarcodeBodySchema,
  foodItemDetailResponseSchema,
  foodItemResponseSchema,
  foodItemsQuerySchema,
  foodItemsResponseSchema,
  mergeFoodItemsBodySchema,
  mergeFoodItemsPreviewResponseSchema,
  mergeFoodItemsQuerySchema,
  mergeFoodItemsResponseSchema,
  resnapshotMealsResponseSchema,
  setFoodItemIngredientsBodySchema,
  setFoodItemReferenceBodySchema,
  setSharedFoodItemOverrideBodySchema,
  sharedFoodItemOverrideResponseSchema,
  updateFoodItemBodySchema,
} from './schemas/food-items.ts'
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
  journalContextQuerySchema,
  journalContextResponseSchema,
  noteDetailResponseSchema,
  noteGetQuerySchema,
} from './schemas/journal-context.ts'
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
  INLINE_PICTURE_HINT,
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
  dismissNoteLinkSuggestionBodySchema,
  noteConflictResponseSchema,
  noteLinkSuggestionsPageQuerySchema,
  noteLinkSuggestionsPageResponseSchema,
  noteLinkSuggestionsResponseSchema,
  noteNeighborsQuerySchema,
  noteNeighborsResponseSchema,
  noteTagsListQuerySchema,
  noteTagsListResponseSchema,
  mergeNoteTagsBodySchema,
  mergeNoteTagsResponseSchema,
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
import {
  addPersonBodySchema,
  addPersonDateBodySchema,
  deletePersonQuerySchema,
  importantDatesQuerySchema,
  importantDatesResponseSchema,
  peopleQuerySchema,
  peopleResponseSchema,
  personActivitiesQuerySchema,
  personActivitiesResponseSchema,
  personDateResponseSchema,
  personDatesResponseSchema,
  personDetailResponseSchema,
  personPostsQuerySchema,
  personPostsResponseSchema,
  personResponseSchema,
  updatePersonBodySchema,
  updatePersonDateBodySchema,
} from './schemas/people.ts'
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
  addReportBodySchema,
  deleteReportResponseSchema,
  importReportsBodySchema,
  importReportsResponseSchema,
  reportResponseSchema,
  reportsQuerySchema,
  reportsResponseSchema,
  updateReportBodySchema,
  updateReportResponseSchema,
} from './schemas/reports.ts'
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
import { setFoodItemSensitivitiesBodySchema } from './schemas/sensitivities.ts'
import { updateSettingsInputSchema, userSettingsResponseSchema } from './schemas/settings.ts'
import { latestSleepResponseSchema, sleepDebtQuerySchema, sleepDebtResponseSchema } from './schemas/sleep.ts'
import { recentActivitiesResponseSchema } from './schemas/social.ts'
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
  syncWeatherBodySchema,
  weatherSyncResponseSchema,
  weatherSyncStatusResponseSchema,
} from './schemas/sync.ts'
import { activityTrackResponseSchema, trackBackfillResponseSchema } from './schemas/tracks.ts'
import {
  createUploadUrlBodySchema,
  UPLOAD_URL_TTL_MINUTES,
  uploadResultResponseSchema,
  uploadUrlResponseSchema,
} from './schemas/uploads.ts'
import { weatherQuerySchema, weatherResponseSchema } from './schemas/weather.ts'
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

const foodItemIdPathSchema = z.object({
  id: z.string().uuid().meta({ description: 'Food item ID, of a per-user or a shared library item' }),
})

const foodItemPortionPathSchema = foodItemIdPathSchema.extend({
  portionId: z.string().uuid().meta({ description: 'Portion ID' }),
})

const activityImpactPathSchema = z.object({
  activity: z.string().meta({ description: 'Activity type, tag or event pattern' }),
})

const reportIdPathSchema = z.object({ id: z.string().uuid().meta({ description: 'Report ID' }) })

const feedPostIdPathSchema = z.object({ postId: z.string().uuid().meta({ description: 'Feed post ID' }) })

const timelineEntryIdPathSchema = z.object({
  id: z.string().uuid().meta({ description: 'Timeline entry ID, the local one a timeline entry carries' }),
})

const articleDraftIdPathSchema = z.object({ id: z.string().uuid().meta({ description: 'Article draft ID' }) })

const followingIdPathSchema = z.object({
  id: z.string().uuid().meta({ description: 'Follow ID, the `id` a followed account carries' }),
})

const followedTagPathSchema = z.object({
  tag: z.string().meta({ description: 'The followed hashtag, with or without `#`' }),
})

const followerIdPathSchema = z.object({
  id: z.string().uuid().meta({ description: 'Follower ID, the `id` a follower carries' }),
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
    '/challenges/thread/entries/{entryId}/following': {
      put: {
        description:
          'Follow or stop following the replies under a top-level post of a challenge thread: one hosted on this instance, or one on another server that you joined. A reply under a post you follow raises `challenge_reply` for you. Without a choice you follow a post you wrote or replied under. The host and members only.',
        requestBody: { content: { 'application/json': { schema: challengePostFollowBodySchema } } },
        requestParams: { path: z.object({ entryId: z.string().meta({ description: 'Thread entry ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: challengePostFollowResponseSchema } },
            description: 'Whether you now follow the post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'Not a challenge page URL, or the entry is a reply (only a top-level post is followed)',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not the host or a member of the challenge',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such challenge or entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Follow the replies under a challenge post',
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
    '/feed': {
      get: {
        description:
          "The authenticated user's own posts, newest first, a page at a time: pass `next_cursor` as `cursor` for the next. Each post carries its structured payload.",
        requestParams: { query: feedPostsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostsResponseSchema } },
            description: 'A page of posts',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my posts',
        tags: ['Feed'],
      },
    },
    '/feed/timeline': {
      get: {
        description:
          'The home timeline: posts received from the accounts and hashtags the user follows, newest first, a page at a time: pass `next_cursor` as `cursor` for the next. `tag` narrows it to the posts carrying that hashtag.',
        requestParams: { query: timelineQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineResponseSchema } },
            description: 'A page of timeline entries',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List the home timeline',
        tags: ['Feed'],
      },
    },
    '/feed/timeline/{id}/replies': {
      get: {
        description:
          "A live snapshot of a timeline post's reply thread, read from its origin, with the user's own replies merged in. Nothing is stored. `fetched: false` means the origin's thread could not be read, so an empty list then means unknown rather than no replies.",
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineRepliesResponseSchema } },
            description: 'The reply thread',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Replies are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Read a timeline post's replies",
        tags: ['Feed'],
      },
    },
    '/feed/timeline/{id}/reply': {
      post: {
        description:
          "Reply to a timeline post: publishes a reply post and delivers it to the user's followers and to the inbox of the author it answers.",
        requestBody: { content: { 'application/json': { schema: replyToPostBodySchema } } },
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The reply post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a reply without text',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The author's server could not be reached",
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Replies are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Reply to a timeline post',
        tags: ['Feed'],
      },
    },
    '/feed/timeline/{id}/like': {
      delete: {
        description: 'Take back a like. Taking back a like that is not there changes nothing.',
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineEntryResponseSchema } },
            description: 'The timeline entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reactions are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unlike a timeline post',
        tags: ['Feed'],
      },
      post: {
        description:
          'Like a timeline post, delivering the like to its author. A repeat like returns the entry unchanged and delivers nothing.',
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineEntryResponseSchema } },
            description: 'The timeline entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The author's server could not be reached",
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reactions are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Like a timeline post',
        tags: ['Feed'],
      },
    },
    '/feed/timeline/{id}/boost': {
      delete: {
        description: 'Take back a boost. Taking back a boost that is not there changes nothing.',
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineEntryResponseSchema } },
            description: 'The timeline entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reactions are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unboost a timeline post',
        tags: ['Feed'],
      },
      post: {
        description:
          "Boost a timeline post to the user's followers. A repeat boost returns the entry unchanged and delivers nothing.",
        requestParams: { path: timelineEntryIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: timelineEntryResponseSchema } },
            description: 'The timeline entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Timeline entry not found',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The author's server could not be reached",
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Reactions are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Boost a timeline post',
        tags: ['Feed'],
      },
    },
    '/feed/article-drafts': {
      get: {
        description: "The user's article drafts. A draft is private and never federated.",
        responses: {
          200: {
            content: { 'application/json': { schema: articleDraftsResponseSchema } },
            description: 'The drafts',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my article drafts',
        tags: ['Feed'],
      },
      post: {
        description: 'Start an article draft, empty unless `article` is given.',
        requestBody: { content: { 'application/json': { schema: createArticleDraftBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: articleDraftResponseSchema } },
            description: 'The new draft',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Create an article draft',
        tags: ['Feed'],
      },
    },
    '/feed/article-drafts/{id}': {
      delete: {
        description: 'Delete an article draft.',
        requestParams: { path: articleDraftIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Draft not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete an article draft',
        tags: ['Feed'],
      },
      get: {
        description: 'One article draft.',
        requestParams: { path: articleDraftIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: articleDraftResponseSchema } },
            description: 'The draft',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Draft not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get an article draft',
        tags: ['Feed'],
      },
      patch: {
        description: 'Change an article draft; fields left out keep their value.',
        requestBody: { content: { 'application/json': { schema: updateArticleDraftBodySchema } } },
        requestParams: { path: articleDraftIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: articleDraftResponseSchema } },
            description: 'The updated draft',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Draft not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update an article draft',
        tags: ['Feed'],
      },
    },
    '/feed/article-drafts/{id}/publish': {
      post: {
        description:
          'Publish an article draft as an article post, federated to followers, and remove the draft.',
        requestBody: { content: { 'application/json': { schema: publishArticleDraftBodySchema } } },
        requestParams: { path: articleDraftIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The published article',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a draft that is not a valid article',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Draft not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Publish an article draft',
        tags: ['Feed'],
      },
    },
    '/feed/{postId}/reactions': {
      get: {
        description: "Who liked, boosted or quoted one of the user's own posts, newest first.",
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostReactionsResponseSchema } },
            description: 'The reactions',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Feed post not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "List a post's reactions",
        tags: ['Feed'],
      },
    },
    '/feed/{postId}/replies': {
      get: {
        description:
          "The replies under one of the user's own posts that this server already holds, the latest 100, oldest first.",
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostRepliesResponseSchema } },
            description: 'The replies',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Feed post not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Replies are not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "List a post's replies",
        tags: ['Feed'],
      },
    },
    '/feed/activities/{id}/share': {
      post: {
        description: 'Share an activity as a feed post, federated to followers.',
        requestBody: { content: { 'application/json': { schema: shareActivityBodySchema } } },
        requestParams: { path: z.object({ id: z.string().meta({ description: 'Activity ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The new post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a mentioned person who cannot be mentioned',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Activity not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Share an activity',
        tags: ['Feed'],
      },
    },
    '/feed/activities/{id}/preview': {
      post: {
        description: 'What sharing an activity with this body would publish. Nothing is created.',
        requestBody: { content: { 'application/json': { schema: shareActivityBodySchema } } },
        requestParams: { path: z.object({ id: z.string().meta({ description: 'Activity ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: sharePreviewResponseSchema } },
            description: 'The preview',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a mentioned person who cannot be mentioned',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Activity not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview sharing an activity',
        tags: ['Feed'],
      },
    },
    '/feed/challenges': {
      post: {
        description:
          'Share an invitation to a challenge: one the user hosts (`challenge_id`) or one they joined (`participation_id`), exactly one of the two.',
        requestBody: { content: { 'application/json': { schema: shareChallengeBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The new post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or not exactly one of the two ids',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Challenge or participation not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Sharing is not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Share a challenge',
        tags: ['Feed'],
      },
    },
    '/feed/exercises': {
      post: {
        description: "Share one exercise's progress as a feed post, federated to followers.",
        requestBody: { content: { 'application/json': { schema: shareExerciseBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The new post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No sessions with that exercise',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Share an exercise',
        tags: ['Feed'],
      },
    },
    '/feed/exercises/preview': {
      post: {
        description: 'What sharing an exercise with this body would publish. Nothing is created.',
        requestBody: { content: { 'application/json': { schema: shareExerciseBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: exerciseSharePreviewResponseSchema } },
            description: 'The preview',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No sessions with that exercise',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview sharing an exercise',
        tags: ['Feed'],
      },
    },
    '/feed/dashboards': {
      post: {
        description: 'Share a finished period of a period dashboard as a feed post, federated to followers.',
        requestBody: { content: { 'application/json': { schema: shareDashboardPeriodBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The new post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, not a period dashboard, or a period that is invalid or not finished',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Dashboard not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Share a dashboard period',
        tags: ['Feed'],
      },
    },
    '/feed/dashboards/preview': {
      post: {
        description: 'What sharing a dashboard period with this body would publish. Nothing is created.',
        requestBody: { content: { 'application/json': { schema: shareDashboardPeriodBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: dashboardSharePreviewResponseSchema } },
            description: 'The preview',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, not a period dashboard, or a period that is invalid or not finished',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Dashboard not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview sharing a dashboard period',
        tags: ['Feed'],
      },
    },
    '/feed/articles': {
      post: {
        description:
          'Publish an article: a title, prose and inline chart and correlation blocks, federated to followers. Delete one with `DELETE /feed/{postId}`.',
        requestBody: { content: { 'application/json': { schema: createArticleBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The new article',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or article content',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Publish an article',
        tags: ['Feed'],
      },
    },
    '/feed/articles/preview': {
      post: {
        description:
          'An article as it would render, with the chart data its blocks draw from. Nothing is created.',
        requestBody: { content: { 'application/json': { schema: previewArticleBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: articlePreviewResponseSchema } },
            description: 'The preview',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Article preview is not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview an article',
        tags: ['Feed'],
      },
    },
    '/feed/articles/{postId}': {
      patch: {
        description:
          'Change an article; fields left out keep their value. The edit is federated as an update.',
        requestBody: { content: { 'application/json': { schema: updateArticleBodySchema } } },
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The updated article',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or article content',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Article not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update an article',
        tags: ['Feed'],
      },
    },
    '/feed/articles/{postId}/export': {
      get: {
        description:
          'An article as paste-ready markdown: its title, prose and one image link per chart or correlation block. Only a public or unlisted article can be exported, since a followers-only one needs a private link for its charts.',
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: articleExportResponseSchema } },
            description: 'The markdown',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A followers-only article',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Article not found',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Export is not available on this server',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Export an article as markdown',
        tags: ['Feed'],
      },
    },
    '/feed/{postId}': {
      delete: {
        description: "Delete one of the user's own posts; the deletion is federated to followers.",
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Feed post not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a post',
        tags: ['Feed'],
      },
      get: {
        description: "One of the user's own posts, with its structured payload.",
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The post',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Feed post not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a post',
        tags: ['Feed'],
      },
      patch: {
        description:
          'Change a post: its metric selection, attachments, visibility, message, hashtags or mentioned people. Fields left out keep their value. The edit is federated as an update.',
        requestBody: { content: { 'application/json': { schema: updateFeedPostBodySchema } } },
        requestParams: { path: feedPostIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: feedPostResponseSchema } },
            description: 'The updated post',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              "Invalid body, a mentioned person who cannot be mentioned, or a visibility a challenge thread's post cannot take",
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Feed post not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a post',
        tags: ['Feed'],
      },
    },
    '/feed/following': {
      get: {
        description: 'The fediverse accounts the user follows, with whether each has accepted.',
        responses: {
          200: {
            content: { 'application/json': { schema: followingResponseSchema } },
            description: 'The follows',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List who I follow',
        tags: ['Feed'],
      },
      post: {
        description:
          'Follow a fediverse account by handle (`@user@host`) or actor URL: resolves the actor and sends it a signed Follow. The follow is pending until the account accepts.',
        requestBody: { content: { 'application/json': { schema: followActorBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: followActorResponseSchema } },
            description: 'The follow',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No actor could be resolved for the handle',
          },
          422: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The user themselves, or not an account that can be followed',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Follow an account',
        tags: ['Feed'],
      },
    },
    '/feed/following/{id}': {
      delete: {
        description: 'Unfollow: sends the account an Undo of the Follow.',
        requestParams: { path: followingIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followActorResponseSchema } },
            description: 'Unfollowed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not following that actor',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unfollow an account',
        tags: ['Feed'],
      },
      patch: {
        description:
          "Turn a follow's bell on or off: whether new posts from the account raise a notification.",
        requestBody: { content: { 'application/json': { schema: updateFollowingBodySchema } } },
        requestParams: { path: followingIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followActorResponseSchema } },
            description: 'The follow',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not following that actor',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a follow',
        tags: ['Feed'],
      },
    },
    '/feed/followed-tags': {
      get: {
        description: 'The hashtags the user follows.',
        responses: {
          200: {
            content: { 'application/json': { schema: followedTagsResponseSchema } },
            description: 'The followed hashtags',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my followed hashtags',
        tags: ['Feed'],
      },
      post: {
        description:
          "Follow a hashtag: follows its tag actor on the tag actor host, which boosts every public post it sees carrying the tag into the user's timeline.",
        requestBody: { content: { 'application/json': { schema: followTagBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: followTagResponseSchema } },
            description: 'The followed hashtag',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or hashtag',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The tag's actor could not be resolved",
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The hashtag is already followed',
          },
          422: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: "The tag's actor cannot be followed",
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Follow a hashtag',
        tags: ['Feed'],
      },
    },
    '/feed/followed-tags/{tag}': {
      delete: {
        description: 'Unfollow a hashtag.',
        requestParams: { path: followedTagPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteResponseSchema } },
            description: 'Unfollowed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not following that tag',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Unfollow a hashtag',
        tags: ['Feed'],
      },
      patch: {
        description:
          "Turn a followed hashtag's bell on or off: whether new posts carrying it raise a notification.",
        requestBody: { content: { 'application/json': { schema: updateFollowingBodySchema } } },
        requestParams: { path: followedTagPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followTagResponseSchema } },
            description: 'The followed hashtag',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not following that tag',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a followed hashtag',
        tags: ['Feed'],
      },
    },
    '/feed/followers': {
      get: {
        description: "The user's followers; `status` narrows them to pending requests or approved followers.",
        requestParams: { query: followersQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followersResponseSchema } },
            description: 'The followers',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List my followers',
        tags: ['Feed'],
      },
    },
    '/feed/followers/{id}': {
      delete: {
        description:
          'Reject a pending follow request, or remove an approved follower; either way the follower is sent a Reject.',
        requestParams: { path: followerIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followerResponseSchema } },
            description: 'Removed',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such follower',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Reject or remove a follower',
        tags: ['Feed'],
      },
    },
    '/feed/followers/{id}/approve': {
      post: {
        description: 'Approve a pending follow request; the follower is sent an Accept.',
        requestParams: { path: followerIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: followerResponseSchema } },
            description: 'The approved follower',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No such follower',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Approve a follower',
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
            person_id: z.string().optional().meta({
              description:
                'Only the activities the person was with (any row of a merged activity linked counts)',
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
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query, or a person_id that is not a live person',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get activities',
        tags: ['Activities'],
      },
    },
    '/activities/recent': {
      get: {
        description:
          "The latest activities, newest first: today's so far or the most recent ones, by default of the types a day overview draws as icons. The read behind the dashboard's latest activities card.",
        requestParams: { query: recentActivitiesQuerySchema },
        responses: {
          200: {
            content: {
              'application/json': { schema: recentActivitiesResponseSchema },
            },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the latest activities',
        tags: ['Activities'],
      },
    },
    '/activities/{id}/track': {
      get: {
        description:
          "Get an activity's full-resolution GPS track: points with altitude and seconds since the track's start_time, the start of the row that owns it (for an override, possibly a row it overrides).",
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
    '/food-items': {
      get: {
        description:
          "Search the food library (the user's own items and the shared library merged) by name, or list the user's items when no query is given.",
        requestParams: { query: foodItemsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Search food items',
        tags: ['Food items'],
      },
      post: {
        description:
          'Add a per-user food item, or update the one with the same name (or the same source and source ID).',
        requestBody: { content: { 'application/json': { schema: addFoodItemBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemResponseSchema } },
            description: 'The stored food item',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add food item',
        tags: ['Food items'],
      },
    },
    '/food-items/by-barcode': {
      post: {
        description:
          'Find a food by its barcode in the library, else look it up at Open Food Facts and add it to the shared library.',
        requestBody: { content: { 'application/json': { schema: findFoodByBarcodeBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The food item with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a valid barcode (8 to 14 digits)',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No food with this barcode',
          },
          502: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Open Food Facts could not be reached',
          },
          503: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Too many barcode lookups at once',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Find food by barcode',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}': {
      get: {
        description:
          'A food item with its ingredients, derived nutrients, reference, portions and sensitivities.',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The food item with its detail',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get food item',
        tags: ['Food items'],
      },
      patch: {
        description:
          'Update a per-user food item; fields left out stay as they are. Shared library items are refused.',
        requestBody: { content: { 'application/json': { schema: updateFoodItemBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The updated food item with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update food item',
        tags: ['Food items'],
      },
      delete: {
        description:
          'Delete a per-user food item. Refused for shared library items and for an item used as an ingredient of a recipe.',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteFoodItemResponseSchema } },
            description: 'Deleted',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The item is an ingredient of a recipe',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete food item',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/duplicate': {
      post: {
        description: 'Copy a food item, per-user or shared, into a new per-user item named "<name> (copy)".',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The copy with its detail',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Duplicate food item',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/ingredients': {
      put: {
        description:
          'Replace the ingredients of a per-user item, making it a recipe whose nutrients are derived from them.',
        requestBody: { content: { 'application/json': { schema: setFoodItemIngredientsBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The recipe with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The ingredients would make a cycle, or a portion does not belong to its ingredient',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set food item ingredients',
        tags: ['Food items'],
      },
      delete: {
        description: 'Clear the ingredients of a per-user item, so it is an atomic item again.',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The item with its detail',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Clear food item ingredients',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/reference': {
      put: {
        description:
          'Point a per-user atomic item at another (per-user or shared, not a recipe) whose nutrients fill the ones it lacks. Null clears it.',
        requestBody: { content: { 'application/json': { schema: setFoodItemReferenceBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The item with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The reference is the item itself, a recipe, missing, or the item is a recipe',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set food item reference',
        tags: ['Food items'],
      },
      delete: {
        description: 'Clear the reference of a per-user item.',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The item with its detail',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: only per-user items are edited this way',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Clear food item reference',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/merge-preview': {
      get: {
        description:
          'What merging source_id into this item would re-point (meals, recipes, portions) and which empty fields of this item the source could fill.',
        requestParams: { path: foodItemIdPathSchema, query: mergeFoodItemsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: mergeFoodItemsPreviewResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'An item is missing or the two cannot be merged',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Preview food item merge',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/merge': {
      post: {
        description:
          "Merge source_id into this item: its references are re-pointed here and the source is deleted, optionally filling this item's empty fields from it.",
        requestBody: { content: { 'application/json': { schema: mergeFoodItemsBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: mergeFoodItemsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'An item is missing or the two cannot be merged',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Merge food items',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/sensitivities': {
      put: {
        description: 'Replace the sensitivity flags on a food item, per-user or shared.',
        requestBody: { content: { 'application/json': { schema: setFoodItemSensitivitiesBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The item with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A sensitivity flag does not exist',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set food item sensitivities',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/resnapshot-meals': {
      post: {
        description: "Store the item's current nutrient values on every meal that contains it.",
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: resnapshotMealsResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Re-snapshot meals for food item',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/override': {
      get: {
        description:
          "The user's override (icon, default portion and quantity) of a shared library item; no data when there is none.",
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: sharedFoodItemOverrideResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A per-user item, which has no override layer',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get shared food item override',
        tags: ['Food items'],
      },
      put: {
        description: "Set the user's override of a shared library item.",
        requestBody: { content: { 'application/json': { schema: setSharedFoodItemOverrideBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: sharedFoodItemOverrideResponseSchema } },
            description: 'The stored override',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A per-user item, or a default portion that is missing or not of this item',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set shared food item override',
        tags: ['Food items'],
      },
      delete: {
        description: "Clear the user's override of a shared library item.",
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: sharedFoodItemOverrideResponseSchema } },
            description: 'Cleared',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A per-user item, which has no override layer',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Clear shared food item override',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/portions': {
      get: {
        description: 'The named portions of a food item, per-user or shared.',
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemPortionsResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List food item portions',
        tags: ['Food items'],
      },
      post: {
        description: 'Add a named portion (label unit and its base-unit equivalent) to a food item.',
        requestBody: { content: { 'application/json': { schema: addFoodItemPortionBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemPortionResponseSchema } },
            description: 'The new portion',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add food item portion',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/portions/{portionId}': {
      patch: {
        description: 'Update a portion of this food item.',
        requestBody: { content: { 'application/json': { schema: updateFoodItemPortionBodySchema } } },
        requestParams: { path: foodItemPortionPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemPortionResponseSchema } },
            description: 'The updated portion',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Portion not found on this food item',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update food item portion',
        tags: ['Food items'],
      },
      delete: {
        description: 'Delete a portion of this food item.',
        requestParams: { path: foodItemPortionPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteFoodItemPortionResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Portion not found on this food item',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete food item portion',
        tags: ['Food items'],
      },
    },
    '/food-items/{id}/default-portion': {
      put: {
        description:
          'Set the portion and quantity preselected when logging a per-user item; a null portion is the base unit. For a shared item this lives on the override.',
        requestBody: { content: { 'application/json': { schema: setDefaultFoodItemPortionBodySchema } } },
        requestParams: { path: foodItemIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: foodItemDetailResponseSchema } },
            description: 'The item with its detail',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The portion is missing or not of this item',
          },
          403: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A shared library item: use the override',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Food item not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Set default food item portion',
        tags: ['Food items'],
      },
    },
    '/reports': {
      get: {
        description: 'List reports, optionally of one type and within a date range.',
        requestParams: { query: reportsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: reportsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Query reports',
        tags: ['Reports'],
      },
      post: {
        description: 'Add a report: a dated set of entries of one report type.',
        requestBody: { content: { 'application/json': { schema: addReportBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: reportResponseSchema } },
            description: 'The new report',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add report',
        tags: ['Reports'],
      },
    },
    '/reports/import': {
      post: {
        description:
          'Import lab results from a spreadsheet table (pasted or a CSV file) with a column mapping: one report per date, results already imported are skipped; dry_run previews without writing.',
        requestBody: { content: { 'application/json': { schema: importReportsBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: importReportsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The text or the mapping cannot be imported',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Import reports',
        tags: ['Reports'],
      },
    },
    '/reports/{id}': {
      get: {
        description: 'Get one report.',
        requestParams: { path: reportIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: reportResponseSchema } },
            description: 'Successful response',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Report not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get report',
        tags: ['Reports'],
      },
      patch: {
        description: 'Update a report; fields left out stay as they are.',
        requestBody: { content: { 'application/json': { schema: updateReportBodySchema } } },
        requestParams: { path: reportIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: updateReportResponseSchema } },
            description: 'The updated report',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Report not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update report',
        tags: ['Reports'],
      },
      delete: {
        description: 'Delete a report.',
        requestParams: { path: reportIdPathSchema },
        responses: {
          200: {
            content: { 'application/json': { schema: deleteReportResponseSchema } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Report not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete report',
        tags: ['Reports'],
      },
    },
    '/correlations/baseline': {
      get: {
        description:
          '7- and 30-day averages of HRV, resting heart rate and stress up to the reference date (today by default), with the trend against the 30 days before.',
        requestParams: { query: baselineQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: baselineResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get physiological baseline',
        tags: ['Correlations'],
      },
    },
    '/correlations/hrv-activities': {
      get: {
        description:
          'How heart rate, HRV and stress during and after each activity type compare with the baseline, over the last period_days.',
        requestParams: { query: hrvActivitiesQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: hrvActivitiesResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request or extra metrics',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Correlate HRV with activities',
        tags: ['Correlations'],
      },
    },
    '/correlations/activity-impact/{activity}': {
      get: {
        description:
          'How metrics before, during and after occurrences of an activity, tag or event compare with the baseline, optionally broken down by a dimension and bucketed by duration or time of day.',
        requestParams: { path: activityImpactPathSchema, query: activityImpactQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: activityImpactResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid period, metrics, buckets, breakdown or filters',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get activity impact',
        tags: ['Correlations'],
      },
    },
    '/correlations/impact-metrics': {
      get: {
        description:
          'The metrics with data in the last period_days that an activity impact can be measured on.',
        requestParams: { query: impactMetricsQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: impactMetricsResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List impact metrics',
        tags: ['Correlations'],
      },
    },
    '/correlations/event-probability': {
      post: {
        description:
          'How likely an outcome tag is within each lag window after a trigger, against its base rate.',
        requestBody: { content: { 'application/json': { schema: eventProbabilityBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: eventProbabilityResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get event probability',
        tags: ['Correlations'],
      },
    },
    '/correlations/generic': {
      post: {
        description: 'Correlate triggers (all must hold) with an outcome over lag windows.',
        requestBody: { content: { 'application/json': { schema: genericCorrelationBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: genericCorrelationResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get generic correlation',
        tags: ['Correlations'],
      },
    },
    '/correlations/continuous': {
      post: {
        description:
          'Correlate the daily values of a trigger dimension with those of an outcome dimension, at a lag in days.',
        requestBody: { content: { 'application/json': { schema: continuousCorrelationBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: continuousCorrelationResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid request',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get continuous correlation',
        tags: ['Correlations'],
      },
    },
    '/correlations/selectors': {
      get: {
        description:
          "What correlation triggers and outcomes can be picked from: the user's activity types, tags, metrics, nutrients, productivity categories, people and sensitivities.",
        responses: {
          200: {
            content: { 'application/json': { schema: correlationSelectorsResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List correlation selectors',
        tags: ['Correlations'],
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
          "Create a segment from part of an activity track (seconds since the track's start_time) or of a route (km), then time every tracked activity of its type on it. Refused when shorter than 100 m, outside the track or route, for an activity without a track or a deleted route.",
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

    '/journal-context': {
      get: {
        description:
          'The journal context line for a day: the figures configured in the `journal_context` setting, computed for that calendar day in tz. Items without a value for the day are left out; `items` is empty when none are configured.',
        requestParams: { query: journalContextQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: journalContextResponseSchema } },
            description: 'The context line',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the journal context line for a day',
        tags: ['Notes'],
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
    '/notes/link-suggestions': {
      get: {
        description:
          "A page of journal entries, newest first, with the links suggested for each: the people named in the text, the night's sleep of an entry written before noon, and the activities of the entry's day. Only entries with a suggestion are listed, so a page may hold fewer than `limit` entries (or none) while `next_cursor` is set. `unlinked_only` (default true) leaves out entries already related to anything. Nothing is linked: save the accepted ones with `PATCH /notes/{id}` and `related`.",
        requestParams: { query: noteLinkSuggestionsPageQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: noteLinkSuggestionsPageResponseSchema } },
            description: 'A page of entries with their suggestions',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List link suggestions over journal entries',
        tags: ['Notes'],
      },
    },
    '/notes/tags': {
      get: {
        description:
          'The tags used on journal entries and comments (explicit tags and #hashtags in the text), with how many live notes carry each and when it was last used, most used first. `entity_types` narrows like search (default: the free-standing journal entries).',
        requestParams: { query: noteTagsListQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: noteTagsListResponseSchema } },
            description: 'The tags',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List journal tags',
        tags: ['Notes'],
      },
    },
    '/notes/tags/merge': {
      post: {
        description:
          'Merge tags: every live note carrying a tag in `from` gets `into` instead. Explicit tags are replaced and #hashtags in the text are rewritten (each rewritten text keeps a revision). Renaming is a merge with one `from`.',
        requestBody: { content: { 'application/json': { schema: mergeNoteTagsBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: mergeNoteTagsResponseSchema } },
            description: 'How many notes changed',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Merge journal tags',
        tags: ['Notes'],
      },
    },
    '/notes/{id}': {
      get: {
        description:
          "One live comment: a thread root with its replies (oldest first) and, for a journal entry, its attachments and, when the user configured one, its context line for the entry's day; a reply on its own.",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
          query: noteGetQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteDetailResponseSchema } },
            description: 'The comment',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Comment not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a comment',
        tags: ['Notes'],
      },
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
    '/notes/{id}/neighbors': {
      get: {
        description:
          "The Journal entries just before (older, `previous`) and after (newer, `next`) one entry, in the Journal list's order: the free-standing `time` and `day` entries, newest first by their time or day (a `day` entry at the start of its date in tz).",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
          query: noteNeighborsQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteNeighborsResponseSchema } },
            description: 'The neighbouring entries',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a live Journal entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the neighbouring Journal entries',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/link-suggestions': {
      get: {
        description:
          'The links suggested for one journal entry: the people whose name is written in it, the sleep that ended on the morning of an entry written before noon, and the activities of its day. Archived people, what it is already related to and what was dismissed for it are left out. Nothing is linked: save the accepted ones with `PATCH /notes/{id}` and `related`.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: noteLinkSuggestionsResponseSchema } },
            description: 'The suggestions',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a live journal entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get link suggestions for a journal entry',
        tags: ['Notes'],
      },
    },
    '/notes/{id}/link-suggestions/dismissals': {
      post: {
        description:
          'Stop suggesting a person or an activity for this journal entry. Dismissing twice is the same as once.',
        requestBody: { content: { 'application/json': { schema: dismissNoteLinkSuggestionBodySchema } } },
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Note ID' }) }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Dismissed',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a live journal entry',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Dismiss a link suggestion',
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
        description: `Attach a picture or a recording to a journal entry (a \`time\` or \`day\` thread root), one file per request in page order. A picture (PNG, JPEG, WebP, GIF or HEIC, by its content) is stored as WebP, turned upright, without metadata, with its longest edge at most ${NOTE_IMAGE_MAX_EDGE} px; a recording (WebM, Ogg, MP4/M4A, MP3 or WAV, by its first bytes) is stored as it is. At most ${NOTE_ATTACHMENT_MAX_BYTES / 1024 / 1024} MB per file, ${MAX_ATTACHMENTS_PER_NOTE} per entry and ${NOTE_ATTACHMENTS_ACCOUNT_BYTES / 1024 / 1024 / 1024} GB per account. ${INLINE_PICTURE_HINT}`,
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
    '/check-in-forms/{id}/adherence': {
      get: {
        description:
          "How a form was kept up from `from` to `to` (local days, at most 366, default the last 30): its slots counted `done`, `skipped`, `missed` and `upcoming` (today's still open), per day and in total, read against the form's current schedule; and per question how many answered check-ins answered it with something other than 0 or no.",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Check-in form ID' }) }),
          query: checkInAdherenceQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInAdherenceResponseSchema } },
            description: 'The adherence',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid dates, or a window longer than 366 days',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get check-in adherence',
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
          'Check-ins newest first, each with its form name and the questions of the version it answered. `entity_type` and `entity_id` list those tied to an activity.',
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
          "Save a check-in against the form's current version. Answers to questions with `logs_to` are logged as metric points or activities at `answered_at` with data source `check_in`; 0, no, or no answer logs nothing. `use_defaults` saves a routine's preset answers. `status: skipped` records the slot `scheduled_for` as skipped; answering a skipped slot later replaces the skip. The due notification of a slot it does or skips is marked read and its actions cleared.",
        requestBody: { content: { 'application/json': { schema: submitCheckInBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: checkInResponseSchema } },
            description: 'The check-in',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description:
              'Invalid body or answers, `use_defaults` on a form that is not a routine, a skip of no slot of the form, or an entity that is not a live activity',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Check-in form not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A skip of a slot already done or skipped',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Submit a check-in',
        tags: ['Check-ins'],
      },
    },
    '/check-ins/{id}': {
      delete: {
        description:
          'Delete a check-in, the metric points it logged and the activities it logged. Restorable for 30 days.',
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
          'Change a check-in. Answers are read against the version it answered; changing them or the time replaces exactly the metric points and activities it logged. A skipped check-in takes no answers.',
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
        description:
          'Restore a deleted check-in; the metric points it logged are written again and its activities restored.',
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
          "The slots of the user's scheduled check-in forms on a day, each `upcoming`, `due`, `done`, `skipped` or `missed`.",
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

    '/people': {
      get: {
        description:
          "The user's private profiles of people, by name, each with the fediverse account read at query time when it has a handle. `archived=true` includes archived people; `deleted=true` lists the deleted ones that can still be restored instead, with `deleted_at` and `purge_at`.",
        requestParams: { query: peopleQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: peopleResponseSchema } },
            description: 'The people',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List people',
        tags: ['People'],
      },
      post: {
        description:
          'Add a private profile of someone. A `handle` (`@name@server`) is resolved the way a follow resolves one and stored as the actor URI; at most one live profile per actor.',
        requestBody: { content: { 'application/json': { schema: addPersonBodySchema } } },
        responses: {
          200: {
            content: { 'application/json': { schema: personResponseSchema } },
            description: 'The new person',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a handle that does not resolve',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Another person already has this fediverse account',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a person',
        tags: ['People'],
      },
    },
    '/people/dates': {
      get: {
        description:
          "Every occurrence between `from` and `to` (at most 400 days apart; default today to 60 days on, in the user's time zone) of the dates and birthdays of the live, non-archived people, by date. 29 February falls on 28 February in other years.",
        requestParams: { query: importantDatesQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: importantDatesResponseSchema } },
            description: 'The occurrences',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid or too long a window',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'List important dates',
        tags: ['People'],
      },
    },
    '/people/{id}': {
      delete: {
        description:
          'Soft-delete a person: they, their dates, notes and activity links go out of sight and can be restored for 30 days, after which they are removed for good. `purge=true` removes it all at once.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }),
          query: deletePersonQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Delete a person',
        tags: ['People'],
      },
      get: {
        description:
          'A person with their dates, the 20 latest activities they were with, how many there are in all (`activity_count`) and by type (`activity_types`). Merged activities count once.',
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: personDetailResponseSchema } },
            description: 'The person',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get a person',
        tags: ['People'],
      },
      patch: {
        description: 'Change a person; only the given fields. `handle: null` clears the fediverse account.',
        requestBody: { content: { 'application/json': { schema: updatePersonBodySchema } } },
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: personResponseSchema } },
            description: 'The person after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body, or a handle that does not resolve',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Another person already has this fediverse account',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Update a person',
        tags: ['People'],
      },
    },
    '/people/{id}/restore': {
      post: {
        description:
          'Bring back a deleted person with their dates, notes and activity links. A live person is answered as they are.',
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: personResponseSchema } },
            description: 'The restored person',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Another live person has the same fediverse account',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Restore a person',
        tags: ['People'],
      },
    },
    '/people/{id}/activities': {
      get: {
        description:
          'The activities the person was with, newest first, a page at a time: pass `next_cursor` as `before` for the next. A merged activity (synced rows, an override, a cross-source group) appears once, under the id its detail page takes; it is with the person when any of its rows is. `types` (with subtypes), `start` and `end` narrow the list, and `total` counts what matches over all pages.',
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }),
          query: personActivitiesQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: personActivitiesResponseSchema } },
            description: 'A page of activities',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query or cursor',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "List a person's activities",
        tags: ['People'],
      },
    },
    '/people/{id}/posts': {
      get: {
        description:
          "The posts this server holds from the person's fediverse account, as timeline entries, newest first.",
        requestParams: {
          path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }),
          query: personPostsQuerySchema,
        },
        responses: {
          200: {
            content: { 'application/json': { schema: personPostsResponseSchema } },
            description: "The person's posts",
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid query',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found, or without a fediverse handle',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "List a person's posts",
        tags: ['People'],
      },
    },
    '/people/{id}/dates': {
      get: {
        description: "The person's yearly dates, by month and day.",
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: personDatesResponseSchema } },
            description: 'The dates',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "List a person's dates",
        tags: ['People'],
      },
      post: {
        description:
          'A yearly date; `notify_days_before` raises an `important_date` notification that many days ahead of each occurrence, from 08:00 local.',
        requestBody: { content: { 'application/json': { schema: addPersonDateBodySchema } } },
        requestParams: { path: z.object({ id: z.string().uuid().meta({ description: 'Person ID' }) }) },
        responses: {
          200: {
            content: { 'application/json': { schema: personDateResponseSchema } },
            description: 'The new date',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Add a date to a person',
        tags: ['People'],
      },
    },
    '/people/{id}/dates/{date_id}': {
      delete: {
        description: 'Delete a date for good.',
        requestParams: {
          path: z.object({
            date_id: z.string().uuid().meta({ description: 'Date ID' }),
            id: z.string().uuid().meta({ description: 'Person ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: baseResponseSchemaMeta } },
            description: 'Deleted',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person or date not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Delete a person's date",
        tags: ['People'],
      },
      patch: {
        description:
          'Change a date; only the given fields; `year` and `notify_days_before` take null to clear.',
        requestBody: { content: { 'application/json': { schema: updatePersonDateBodySchema } } },
        requestParams: {
          path: z.object({
            date_id: z.string().uuid().meta({ description: 'Date ID' }),
            id: z.string().uuid().meta({ description: 'Person ID' }),
          }),
        },
        responses: {
          200: {
            content: { 'application/json': { schema: personDateResponseSchema } },
            description: 'The date after the change',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Invalid body or not a real date',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Person or date not found',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: "Update a person's date",
        tags: ['People'],
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
    '/sync/weather': {
      post: {
        description:
          'Fetch the hourly weather (WMO code, temperature, precipitation, wind speed) from Open-Meteo for the places in your location history, sending only coordinates rounded to 0.1°. Each hour gets the last location fix at or before its middle, carried forward up to 7 days. The first sync or full_resync covers the last 90 days; later syncs continue from 48 hours before the last sync; start_date fetches from that date instead (older than 90 days from the archive). At most 20 rounded locations per run, the most used first: the scheduler continues a first sync by itself, a start_date fetch that reports cells_deferred is finished by fetching again. Requires weather_enabled in user settings.',
        requestBody: {
          content: { 'application/json': { schema: syncWeatherBodySchema } },
        },
        responses: {
          200: {
            content: { 'application/json': { schema: weatherSyncResponseSchema } },
            description: 'Sync result',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Sync weather',
        tags: ['Sync'],
      },
    },
    '/sync/weather/status': {
      get: {
        description: 'Current weather sync state: last sync time, status and error.',
        responses: {
          200: {
            content: { 'application/json': { schema: weatherSyncStatusResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get weather sync status',
        tags: ['Sync'],
      },
    },
    '/sync/weather/state': {
      delete: {
        description:
          'Forget the weather sync state, the last sync time included, so the next sync is a first sync. Stored weather is kept.',
        responses: {
          200: {
            content: { 'application/json': { schema: syncResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Reset weather sync state',
        tags: ['Sync'],
      },
    },
    '/weather': {
      get: {
        description:
          "The stored hourly weather where you were, for a calendar day (date, with tz) or a span (start and end; every hour that overlaps it), with a summary. A day's summary follows the rounded location where most of its hours were spent, and its condition the hours 07:00–21:59 when any of them has a code. The same as the get_weather MCP tool.",
        requestParams: { query: weatherQuerySchema },
        responses: {
          200: {
            content: { 'application/json': { schema: weatherResponseSchema } },
            description: 'Successful response',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Neither or both of date and start/end given',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the weather for a day or span',
        tags: ['Weather'],
      },
    },
    '/data-sources/overview': {
      get: {
        description:
          'Which data sources the user has connected, the kinds of data each brings, which sources feed each kind, and where two sources send the same thing (overlap). The read behind the Data sources page; MCP has the same as get_data_sources_overview.',
        responses: {
          200: {
            content: { 'application/json': { schema: dataSourcesOverviewResponseSchema } },
            description: 'Successful response',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Get the data sources overview',
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
    '/uploads': {
      post: {
        description: `Mint a short-lived, single-use upload URL for one target: \`note_attachment\` (a picture or a recording on a journal entry, needs \`note_id\`), \`feed_image\` (a picture to embed in markdown), \`challenge_banner\` (needs \`challenge_id\`) or \`profile_avatar\`. The URL is good for one upload within ${UPLOAD_URL_TTL_MINUTES} minutes and takes the raw bytes without an Authorization header (\`curl -T photo.jpg '<upload_url>'\`), so a client that cannot send multipart or large bodies itself can hand it on. Minting draws on the account's upload budget.`,
        requestBody: {
          content: { 'application/json': { schema: createUploadUrlBodySchema } },
        },
        responses: {
          201: {
            content: { 'application/json': { schema: uploadUrlResponseSchema } },
            description: 'The upload URL',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'A missing or unexpected id for the target, or a note that is not a journal entry',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The journal entry or challenge was not found',
          },
          429: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The account has used its upload budget for now',
          },
        },
        security: [{ bearerAuth: [] }],
        summary: 'Create an upload URL',
        tags: ['Uploads'],
      },
    },
    '/uploads/{username}/{token}': {
      post: {
        description:
          'Upload the file as multipart/form-data, in field `file`, to a URL from `POST /uploads`. Otherwise the same as the PUT.',
        requestBody: {
          content: {
            'multipart/form-data': {
              schema: z.object({
                file: z.string().meta({ description: 'The file', format: 'binary' }),
              }),
            },
          },
        },
        requestParams: {
          path: z.object({
            token: z.string().meta({ description: 'The URL token' }),
            username: z.string().meta({ description: 'The account the URL was minted for' }),
          }),
        },
        responses: {
          201: {
            content: { 'application/json': { schema: uploadResultResponseSchema } },
            description: 'What the upload stored, by target',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No file, or a file the target cannot use',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The URL is unknown, expired or already used, or its entry or challenge is gone',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The entry or the account holds as much as it may',
          },
          413: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The file is too large; the URL can still be used',
          },
          415: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a picture Aurboda can use (feed_image)',
          },
        },
        summary: 'Upload a file (multipart)',
        tags: ['Uploads'],
      },
      put: {
        description: `Upload a file to a URL from \`POST /uploads\`: the body is the file's raw bytes, with any content type, and no Authorization header is needed, since the URL is the credential. The URL works once, within ${UPLOAD_URL_TTL_MINUTES} minutes of minting: a stored upload or a refused file uses it up, while a body over \`max_bytes\` (413) or an empty one (400) leaves it usable. The answer is what the target's own upload would answer, under \`data\` with its \`target\`. An unknown, expired or used URL answers 404 without saying which.`,
        requestBody: {
          content: {
            'application/octet-stream': {
              schema: z.string().meta({ description: 'The file', format: 'binary' }),
            },
          },
        },
        requestParams: {
          path: z.object({
            token: z.string().meta({ description: 'The URL token' }),
            username: z.string().meta({ description: 'The account the URL was minted for' }),
          }),
        },
        responses: {
          201: {
            content: { 'application/json': { schema: uploadResultResponseSchema } },
            description: 'What the upload stored, by target',
          },
          400: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'No file, or a file the target cannot use',
          },
          404: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The URL is unknown, expired or already used, or its entry or challenge is gone',
          },
          409: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The entry or the account holds as much as it may',
          },
          413: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'The file is too large; the URL can still be used',
          },
          415: {
            content: { 'application/json': { schema: errorResponseSchema } },
            description: 'Not a picture Aurboda can use (feed_image)',
          },
        },
        summary: 'Upload a file',
        tags: ['Uploads'],
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
    {
      description: 'The food library: per-user and shared items, recipes, portions and overrides',
      name: 'Food items',
    },
    { description: 'Lab and other dated reports, and their import from spreadsheets', name: 'Reports' },
    {
      description: 'Baselines, activity impact and correlations between data dimensions',
      name: 'Correlations',
    },
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
    {
      description: 'Private profiles of people, their important dates and who an activity was with',
      name: 'People',
    },
    { description: 'User settings and preferences', name: 'Settings' },
    {
      description:
        'Short-lived, single-use URLs for uploading files without multipart or an Authorization header',
      name: 'Uploads',
    },
    {
      description: 'Data synchronization with external services',
      name: 'Sync',
    },
    { description: 'Hourly weather where you were, from Open-Meteo', name: 'Weather' },
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
fs.writeFileSync('./generated/openapi.kotlin.yaml', yaml.stringify(kotlinOpenApiDocument(openApiDocument)))

console.info('Generated OpenAPI specification:')
console.info('  - generated/openapi.yaml')
console.info('  - generated/openapi.json')
console.info('  - generated/openapi.kotlin.yaml (without the feed, for the Kotlin models)')
