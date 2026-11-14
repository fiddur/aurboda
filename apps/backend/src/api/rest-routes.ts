/**
 * Mounts the per-domain REST routers under the Express app. Each router lives
 * in `routes/` and is instantiated with the auth middleware (and any service
 * dependencies). The `activities` router additionally needs a Garmin
 * activity-detail fetcher that's plumbed in here.
 */
import type { Express } from 'express'
import type { Client } from 'pg'

import type { Auth } from '../auth.ts'
import type { GarminClient } from '../integrations/garmin/source.ts'
import type { DetailSyncedCallback, TrackWrittenCallback } from '../integrations/garmin/sync.ts'
import type { HomeAssistantClient } from '../integrations/home-assistant/client.ts'
import type { AutosharePreviewDeps } from '../mcp/autoshare-rule-tools.ts'
import type { AccountDeleter } from '../services/account-deletion.ts'
import type { AccountPlans } from '../services/account-plan.ts'
import type { PostUpdateResender } from '../services/activitypub/post-update-resend.ts'
import type { AdminUsers } from '../services/admin-users.ts'
import type { ArticlePreviewer } from '../services/article-preview.ts'
import type { SkipAutoshare } from '../services/autoshare-skip.ts'
import type { CentralDb } from '../services/central-db.ts'
import type { DiscoverChallenges } from '../services/challenge-discovery.ts'
import type { DeductionEngineDeps } from '../services/deduction-engine.ts'
import type { ActivityNotifier, DeductionQueue } from '../services/deduction-queue.ts'
import type { DumpExporter, DumpLinkIssuer } from '../services/export-dump.ts'
import type { ExportTokens } from '../services/export-token.ts'
import type { ReactionActions } from '../services/feed-reactions.ts'
import type { FollowerActions } from '../services/followers.ts'
import type { FollowActions } from '../services/following.ts'
import type { InvitationAuth } from '../services/invitation.ts'
import type { NamedLocationsChanged } from '../services/locations.ts'
import type { RunNotificationAction } from '../services/notification-actions.ts'
import type { OuraWebhookManager } from '../services/oura-webhook-manager.ts'
import type { PublicTagActions } from '../services/public-tags.ts'
import type { SyncProvider } from '../services/queries/index.ts'
import type { RelayActions } from '../services/relays.ts'
import type { HrSettingsChanged, ProfileChanged } from '../services/settings.ts'
import type { TimelineHub } from '../services/timeline-hub.ts'
import type { RetroEnrichTrigger } from '../services/timeline-retro-enrich.ts'
import type { WebAuthnService } from '../services/webauthn.ts'
import type { AnyMiddleware } from '../typed-router.ts'

import {
  getFeedPostById,
  getLocations,
  getPublicSharedDashboardBySlug,
  getTimeSeries,
  listUserNames,
  markActivityDetailSynced,
} from '../db/index.ts'
import { processActivityDetail } from '../integrations/garmin/process.ts'
import { gravlRedirectUri } from '../integrations/gravl/client.ts'
import { createAccountRouter } from '../routes/account-router.ts'
import { createActivitiesRouter } from '../routes/activities-router.ts'
import { createActivityTypeCatalogRouter } from '../routes/activity-type-catalog-router.ts'
import { createActivityTypesRouter } from '../routes/activity-types-router.ts'
import { createAdminRouter } from '../routes/admin-router.ts'
import { createAgentsRouter } from '../routes/agents-router.ts'
import { createAuditLogRouter } from '../routes/audit-log-router.ts'
import { createAutoshareRulesRouter } from '../routes/autoshare-rules-router.ts'
import { createChallengeDataRouter } from '../routes/challenge-data-router.ts'
import { createChallengeQuantpubRouter } from '../routes/challenge-quantpub-router.ts'
import { createChallengesRouter } from '../routes/challenges-router.ts'
import { createChartDataRouter } from '../routes/chart-data-router.ts'
import { createCorrelationsRouter } from '../routes/correlations-router.ts'
import { createDashboardRouter } from '../routes/dashboard-router.ts'
import { createDeductionRulesRouter } from '../routes/deduction-rules-router.ts'
import { createExerciseCatalogRouter } from '../routes/exercise-catalog-router.ts'
import { createExportRouter } from '../routes/export-router.ts'
import { createFeedFollowedTagsRouter } from '../routes/feed-followed-tags-router.ts'
import { createFeedFollowersRouter } from '../routes/feed-followers-router.ts'
import { createFeedFollowingRouter } from '../routes/feed-following-router.ts'
import { createFeedImageRouter } from '../routes/feed-image-router.ts'
import { createFeedImagesRouter } from '../routes/feed-images-router.ts'
import { createFeedPublicRouter } from '../routes/feed-public-router.ts'
import { createFeedRouter, type FeedDeliver } from '../routes/feed-router.ts'
import { createFoodItemsRouter } from '../routes/food-items-router.ts'
import { createHomeAssistantRouter } from '../routes/home-assistant-router.ts'
import { createIconsRouter } from '../routes/icons-router.ts'
import { createImportsRouter } from '../routes/imports-router.ts'
import { createLocationsRouter } from '../routes/locations-router.ts'
import { createMealsRouter } from '../routes/meals-router.ts'
import { createMediaRouter } from '../routes/media-router.ts'
import { createMetricsRouter } from '../routes/metrics-router.ts'
import { createNotesRouter } from '../routes/notes-router.ts'
import { createNotificationsRouter } from '../routes/notifications-router.ts'
import { createNutrientRecommendationsRouter } from '../routes/nutrient-recommendations-router.ts'
import { createOEmbedRouter } from '../routes/oembed-router.ts'
import { createOgImageRouter } from '../routes/og-image-router.ts'
import { createProductivityRouter } from '../routes/productivity-router.ts'
import { createProfileRouter } from '../routes/profile-router.ts'
import { createPublicAvatarRouter } from '../routes/public-avatar-router.ts'
import { createPublicBannerRouter } from '../routes/public-banner-router.ts'
import { createPublicFeedImageRouter } from '../routes/public-feed-image-router.ts'
import { createPublicSharesRouter } from '../routes/public-shares-router.ts'
import { createRawRecordsRouter } from '../routes/raw-records-router.ts'
import { createReportsRouter } from '../routes/reports-router.ts'
import { createRoutesRouter } from '../routes/routes-router.ts'
import { createScreentimeCategoriesRouter } from '../routes/screentime-categories-router.ts'
import { createSensitivityFlagsRouter } from '../routes/sensitivity-flags-router.ts'
import { createSettingsRouter } from '../routes/settings-router.ts'
import { createShareHtmlRouter, createShareResolvers } from '../routes/share-html-router.ts'
import { createSharedDashboardsRouter } from '../routes/shared-dashboards-router.ts'
import { createSharedExercisesRouter } from '../routes/shared-exercises-router.ts'
import { createTracksRouter } from '../routes/tracks-router.ts'
import { createTrainingLoadRouter } from '../routes/training-load-router.ts'
import { createTrendsRouter } from '../routes/trends-router.ts'
import { createWebAuthnRouter } from '../routes/webauthn-router.ts'
import { createWellKnownRouter, type WellKnownConfig } from '../routes/well-known-router.ts'
import {
  renderChartPng,
  renderImpactPng,
  renderRaceChartPng,
  renderRoutePng,
  renderScatterPng,
  svgToPng,
} from '../services/activitypub/feed-images.ts'
import { fetchOsmTile } from '../services/activitypub/osm-tiles.ts'
import {
  getArticleChartSeriesData,
  getArticleCorrelationScatter,
  getArticleImpact,
} from '../services/article-block-data.ts'
import { articleBlockMisses } from '../services/article-block-misses.ts'
import { loadAvatarDataUri, loadChallengeBannerDataUri } from '../services/avatar-resolve.ts'
import { buildChartSvg } from '../services/charts/chart-svg.ts'
import { buildImpactSvg } from '../services/charts/impact-svg.ts'
import { buildRaceChartSvg } from '../services/charts/race-chart-svg.ts'
import { buildScatterSvg } from '../services/charts/scatter-svg.ts'
import { loadPublicDashboardChartWith } from '../services/dashboard-chart.ts'
import { latestExerciseSession } from '../services/exercise-card.ts'
import { resolveChallengeRaceByUrl, resolveStandingsChart } from '../services/feed-structured-challenge.ts'
import { resolveExerciseTrendSeries } from '../services/feed-structured-exercise.ts'
import { resolveFeedActivity } from '../services/feed.ts'
import { readOfficialFeedSetting } from '../services/official-feed.ts'
import { createOgImageRenderer } from '../services/og-image.ts'
import { loadPublicPostChartWith, type PostChartDeps } from '../services/post-chart.ts'
import { getSettings, getUserTimezone } from '../services/settings.ts'
import { resolveDashboardView } from '../services/shared-dashboard-data.ts'
import { resolveSharedExerciseData } from '../services/shared-exercise-data.ts'
import { createTemplateLoader } from '../services/web-template.ts'

interface RestRoutesDeps {
  httpd: Express
  accountDeleter: AccountDeleter
  accountPlans: AccountPlans
  authMiddleware: AnyMiddleware
  adminMiddleware: AnyMiddleware
  adminUsers: AdminUsers
  centralDb: CentralDb
  invitationAuth: InvitationAuth
  webHost: string
  webIndexPath: string | undefined
  apiBaseUrl: string
  /** Open challenges from followed peers (`GET /challenges/discover`). */
  discoverChallenges: DiscoverChallenges
  garmin: GarminClient
  /** Home Assistant client behind `GET /home-assistant/entities`. */
  homeAssistant: HomeAssistantClient
  /** Fire-and-forget: re-federate the shares of an activity whose detail was (re)synced. */
  onActivityDetailSynced: DetailSyncedCallback
  /** Fire-and-forget: queue post-processing for an activity whose GPS track was written. */
  onTrackWritten: TrackWrittenCallback
  syncProvider: SyncProvider
  activityNotifier: ActivityNotifier
  engineDeps: DeductionEngineDeps
  deductionQueue: DeductionQueue | null
  ouraWebhookManager: OuraWebhookManager
  auth: Auth
  webAuthn: WebAuthnService
  wellKnown: WellKnownConfig
  userDb: Client
  feedDeliver: FeedDeliver
  followActions: FollowActions
  followerActions: FollowerActions
  relayActions: RelayActions
  publicTagActions: PublicTagActions
  postUpdateResender: PostUpdateResender
  /** Outbound like ⭐ / boost 🔄 toggles for the home timeline. */
  reactionActions: ReactionActions
  timelineHub: TimelineHub
  retroEnrichTimeline: RetroEnrichTrigger
  /** Fire-and-forget: federate an `Update{Person}` after an avatar or display-name change. */
  onProfileChanged: ProfileChanged
  /** Merge-group/window resolution behind the auto-share rule preview (#903). */
  autosharePreviewDeps: AutosharePreviewDeps
  /** Keeps one activity from being auto-shared (the `skip` action and `/autoshare-rules/skips`). */
  skipAutoshare: SkipAutoshare
  /** Runs a notification's action server-side. */
  runNotificationAction: RunNotificationAction
  /** Fire-and-forget: recompute activity features after HR zones, birth date or maf_hr change. */
  onHrSettingsChanged: HrSettingsChanged
  onNamedLocationsChanged: NamedLocationsChanged
  dataExport: { exporter: DumpExporter; requestDumpLink: DumpLinkIssuer; tokens: ExportTokens }
  /** The article preview, shared with MCP's `preview_article`. */
  previewArticle: ArticlePreviewer
}

/** Where a post's chart data comes from, for its feed images and its link-preview card alike. */
export const postChartDeps: PostChartDeps = {
  // Merged-span window so the rendered chart covers what the user shared,
  // matching the Note's duration/metrics (#881).
  getActivity: resolveFeedActivity,
  // Shared with the markdown export's eligibility check (#974), so "would
  // this block's image render?" can never drift from the endpoint.
  getArticleChartSeries: getArticleChartSeriesData,
  getArticleImpact,
  getChallengeRaceByUrl: resolveChallengeRaceByUrl,
  getCorrelationScatter: getArticleCorrelationScatter,
  getExerciseTrend: (user, post) => resolveExerciseTrendSeries(user, post),
  getSeries: getTimeSeries,
  getStandingsChart: resolveStandingsChart,
}

export const mountRestRouters = ({
  httpd,
  accountDeleter,
  accountPlans,
  authMiddleware,
  adminMiddleware,
  adminUsers,
  centralDb,
  invitationAuth,
  webHost,
  webIndexPath,
  apiBaseUrl,
  discoverChallenges,
  garmin,
  homeAssistant,
  onActivityDetailSynced,
  onTrackWritten,
  syncProvider,
  activityNotifier,
  engineDeps,
  deductionQueue,
  autosharePreviewDeps,
  skipAutoshare,
  runNotificationAction,
  dataExport,
  feedDeliver,
  followActions,
  followerActions,
  relayActions,
  publicTagActions,
  postUpdateResender,
  previewArticle,
  reactionActions,
  onProfileChanged,
  onHrSettingsChanged,
  onNamedLocationsChanged,
  retroEnrichTimeline,
  timelineHub,
  ouraWebhookManager,
  auth,
  webAuthn,
  wellKnown,
  userDb,
}: RestRoutesDeps): void => {
  httpd.use(createMetricsRouter(authMiddleware, syncProvider))
  httpd.use(createAgentsRouter(apiBaseUrl))
  httpd.use('/icons', createIconsRouter(authMiddleware))
  httpd.use('/notes', createNotesRouter(authMiddleware))
  httpd.use(
    '/notifications',
    createNotificationsRouter(authMiddleware, {
      isAdmin: centralDb.isAdmin,
      runAction: runNotificationAction,
    }),
  )
  httpd.use('/media', createMediaRouter(authMiddleware))
  httpd.use('/meals', createMealsRouter(authMiddleware))
  httpd.use('/food-items', createFoodItemsRouter(authMiddleware, centralDb))
  httpd.use('/sensitivity-flags', createSensitivityFlagsRouter(authMiddleware))
  httpd.use('/nutrient-recommendations', createNutrientRecommendationsRouter(authMiddleware))
  httpd.use('/admin/imports', createImportsRouter(authMiddleware, adminMiddleware, centralDb))
  httpd.use('/reports', createReportsRouter(authMiddleware))
  httpd.use(
    createActivitiesRouter(
      authMiddleware,
      syncProvider,
      activityNotifier,
      async (user, activityId, garminActivityId, activitySpan, activityStart) => {
        const detail = await garmin.getActivityDetail(user, garminActivityId)
        const points = await processActivityDetail(user, detail, {
          activityId,
          activitySpan,
          activityStart,
          onTrackWritten,
        })
        await markActivityDetailSynced(user, activityId)
        onActivityDetailSynced(user, activityId)
        return points
      },
    ),
  )
  httpd.use('/productivity', createProductivityRouter(authMiddleware, syncProvider))
  httpd.use('/activity-types', createActivityTypesRouter(authMiddleware))
  httpd.use(
    '/deduction-rules',
    createDeductionRulesRouter(authMiddleware, engineDeps, deductionQueue ?? undefined),
  )
  httpd.use(
    '/autoshare-rules',
    createAutoshareRulesRouter(authMiddleware, autosharePreviewDeps, skipAutoshare),
  )
  httpd.use('/locations', createLocationsRouter(authMiddleware, onNamedLocationsChanged))
  httpd.use(
    '/home-assistant',
    createHomeAssistantRouter(authMiddleware, { client: homeAssistant, getSettings }),
  )
  httpd.use(createSettingsRouter(authMiddleware, onHrSettingsChanged, onProfileChanged))
  httpd.use(createAuditLogRouter(authMiddleware))
  httpd.use('/export', createExportRouter({ authMiddleware, ...dataExport }))
  httpd.use('/account', createAccountRouter(authMiddleware, accountDeleter, accountPlans, centralDb))
  httpd.use(createRawRecordsRouter(authMiddleware))
  httpd.use('/dashboard', createDashboardRouter(authMiddleware))
  httpd.use('/shared-dashboards', createSharedDashboardsRouter(authMiddleware, webHost))
  httpd.use('/shared-exercises', createSharedExercisesRouter(authMiddleware, webHost))
  httpd.use('/activity-type-catalog', createActivityTypeCatalogRouter(authMiddleware))
  httpd.use('/exercise-catalog', createExerciseCatalogRouter(authMiddleware))
  httpd.use('/profile', createProfileRouter(authMiddleware, webHost, onProfileChanged))
  // Mount the following, followers and images routers before `/feed` so `/feed/following/*`,
  // `/feed/followers/*` and `/feed/images/*` resolve here and never touch the
  // feed router's `/:postId`.
  httpd.use('/feed/following', createFeedFollowingRouter(authMiddleware, followActions))
  httpd.use('/feed/followed-tags', createFeedFollowedTagsRouter(authMiddleware, followActions))
  httpd.use('/feed/followers', createFeedFollowersRouter(authMiddleware, followerActions))
  httpd.use('/feed/images', createFeedImagesRouter(authMiddleware, apiBaseUrl))
  httpd.use(
    '/feed',
    createFeedRouter(
      authMiddleware,
      feedDeliver,
      timelineHub,
      apiBaseUrl,
      retroEnrichTimeline,
      webHost,
      reactionActions,
      previewArticle,
    ),
  )
  httpd.use('/challenges', createChallengesRouter(authMiddleware, webHost, apiBaseUrl, discoverChallenges))
  httpd.use(createChallengeDataRouter())
  // Public feed series must be mounted before the generic /public/:username/:slug
  // resolver so `series` is not matched as a share slug.
  httpd.use(
    createFeedPublicRouter({
      apiBaseUrl,
      listOfficialRemotePosts: (handles, tags, limit, before) =>
        centralDb.listOfficialRemotePosts(handles, tags, limit, before),
      publicTags: publicTagActions,
      readOfficialFeed: () => readOfficialFeedSetting(centralDb),
      webHost,
    }),
  )
  // Public feed-post images (chart / route map), rendered on demand for opted-in
  // public/unlisted posts. Mounted alongside the series router (same guard).
  httpd.use(
    createFeedImageRouter({
      ...postChartDeps,
      articleBlockMisses,
      getPost: getFeedPostById,
      getRoute: async (user, start, end) =>
        (await getLocations(user, start, end)).locations.map((l) => l.coordinates),
      rasterizeSvg: svgToPng,
      renderChart: renderChartPng,
      renderChartSvg: buildChartSvg,
      renderImpact: renderImpactPng,
      renderImpactSvg: buildImpactSvg,
      renderRaceChart: renderRaceChartPng,
      renderRaceChartSvg: buildRaceChartSvg,
      // Draw the route over the OSM basemap; falls back to a bare shape if tiles
      // can't be fetched (e.g. offline).
      renderRoute: (coords) => renderRoutePng(coords, { fetchTile: fetchOsmTile }),
      renderScatter: renderScatterPng,
      renderScatterSvg: buildScatterSvg,
    }),
  )
  // Before the public-shares router, whose `/public/:username/:slug` resolver
  // would otherwise take `/public/:username/challenges` and `/public/:username/images/*`.
  httpd.use(createChallengeQuantpubRouter({ apiBaseUrl, webHost }))
  httpd.use(createPublicFeedImageRouter())
  httpd.use(createPublicSharesRouter(webHost))
  // Mounted before the share-html router so `/u/.../opengraph-image.png`,
  // `/u/:username/avatar.png` and `/u/:username/:slug/banner.webp` win over the
  // generic `/u/:username/:slug` HTML route.
  httpd.use(createPublicAvatarRouter())
  httpd.use(createPublicBannerRouter())
  httpd.use(createOEmbedRouter({ webHost, ...createShareResolvers() }))
  httpd.use(
    createOgImageRouter({
      latestExerciseSession: (username, exercise) => latestExerciseSession(username, exercise),
      loadAvatarDataUri,
      loadBannerDataUri: loadChallengeBannerDataUri,
      loadDashboardChart: loadPublicDashboardChartWith({
        getDashboard: getPublicSharedDashboardBySlug,
        getTimezone: getUserTimezone,
        resolveView: resolveDashboardView,
      }),
      loadPostChart: loadPublicPostChartWith({ ...postChartDeps, getPost: getFeedPostById }),
      loadExerciseCard: async (username, exercise) => {
        const [data, timeZone] = await Promise.all([
          resolveSharedExerciseData(username, exercise),
          getUserTimezone(username),
        ])
        return { data, timeZone }
      },
      renderImage: createOgImageRenderer(),
      webHost,
      ...createShareResolvers(),
    }),
  )
  httpd.use(
    createShareHtmlRouter({
      apiBaseUrl,
      loadTemplate: createTemplateLoader(webIndexPath),
      readOfficialFeed: () => readOfficialFeedSetting(centralDb),
      webHost,
      ...createShareResolvers(),
    }),
  )
  httpd.use('/correlations', createCorrelationsRouter(authMiddleware, syncProvider))
  httpd.use('/tracks', createTracksRouter(authMiddleware))
  httpd.use('/routes', createRoutesRouter(authMiddleware))
  httpd.use('/training-load', createTrainingLoadRouter(authMiddleware))
  httpd.use('/trends', createTrendsRouter(authMiddleware))
  httpd.use('/chart-data', createChartDataRouter(authMiddleware))
  httpd.use('/screentime-categories', createScreentimeCategoriesRouter(authMiddleware))
  httpd.use(
    '/admin',
    createAdminRouter(
      authMiddleware,
      adminMiddleware,
      centralDb,
      adminUsers,
      invitationAuth,
      webHost,
      gravlRedirectUri(apiBaseUrl),
      async (username) => (await listUserNames(userDb)).includes(username),
      ouraWebhookManager,
      accountDeleter,
      accountPlans,
      relayActions,
      publicTagActions,
      postUpdateResender,
    ),
  )
  httpd.use(
    '/webauthn',
    createWebAuthnRouter({ auth, authMiddleware, centralDb, invitationAuth, userDb, webAuthn }),
  )
  httpd.use(createWellKnownRouter(wellKnown))
}
