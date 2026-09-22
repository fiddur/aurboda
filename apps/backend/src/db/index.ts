export type {
  Activity,
  ActivityUpdate,
  BucketedMetricData,
  CachedActorPresentation,
  CalendarConfig,
  DailyAggregate,
  DailyMetricAggregate,
  DetectedLocation,
  DetectedLocationInput,
  DetectedLocationUpdate,
  EntityType,
  GeocodeStatus,
  LabResult,
  Location,
  McpSessionRecord,
  FoodItemEntity,
  Meal,
  MealFoodItem,
  MealFoodItemLink,
  MergedActivity,
  Micros,
  MetricStats,
  NamedLocation,
  NamedLocationInput,
  Note,
  OAuthToken,
  Place,
  ProductivityRecord,
  RawRecord,
  Report,
  ReportConfidence,
  ReportEntry,
  ReportFlag,
  ScreentimeCategory,
  ScreentimeCategoryInput,
  SyncState,
  SyncStatus,
  TimeSeriesPoint,
  UserSettings,
} from './types.ts'

export {
  _setClientForUser,
  dropUserDb,
  getDbForUser,
  initializeSchema,
  isInvalidPasswordError,
  listUserNames,
  loginToUserDb,
  makeNewUserDb,
  migrateAllUsers,
  migrateSchema,
  migrateSchemaIfNeeded,
  query,
  schemaInitialized,
} from './connection.ts'

export {
  getAllScrobbles,
  getScrobbles,
  insertRawRecord,
  queryRawRecords,
  type QueryRawRecordsParams,
  type RawRecordRow,
  type ScrobbleRecord,
} from './raw-records.ts'

export {
  deleteTimeSeriesBySource,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getDailyAggregates,
  getDistinctMetrics,
  getRawDailySum,
  getSourceFilter,
  getLatestMetricValuesMulti,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesEntriesMultiMetric,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
  getTimeSeriesWithSource,
  insertTimeSeries,
} from './time-series.ts'

export {
  deleteDeductionRule,
  deleteRuleActivities,
  deleteStaleRuleActivities,
  getDeductionRule,
  getDeductionRules,
  getDeductionRulesByIds,
  getEnabledDeductionRules,
  insertDeductionRule,
  insertDeductionRuleRun,
  updateDeductionRule,
} from './deduction-rules.ts'

export {
  activityTypeExists,
  deleteActivityTypeDefinition,
  expandActivityTypes,
  getActivityTypeDefinition,
  getActivityTypeDefinitions,
  getActivityTypeNames,
  getDescendantTypes,
  getHealthConnectExerciseType,
  insertActivityTypeDefinition,
  mergeActivityTypeDefinition,
  renameActivityTypeDefinition,
  resolveActivityTypeByAlias,
  resolveActivityTypeFromHcExerciseType,
  resolveOrCreateActivityType,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

export {
  adoptLegacyActivity,
  checkActivityConflict,
  deleteActivity,
  deleteGarminActivityWithWrongType,
  softDeleteActivityByExternalId,
  findActivityByExternalId,
  findMergeableActivity,
  findMergedGroupForActivity,
  getActivities,
  getActivitiesByCategory,
  getActivitiesExcludingCategories,
  getActivitiesNeedingDetail,
  getAllActivitiesInRange,
  getScreentimeActivities,
  migrateExerciseTypes,
  getNonSleepActivitiesMerged,
  getAllActivityTypeNames,
  getActivityById,
  getActivitySourcesByIds,
  getNearbyActivities,
  backfillSuperseded,
  getOverlappingActivities,
  getOverrideForActivity,
  getSleepSessions,
  hardDeleteActivitiesByExternalIdPrefix,
  hardDeleteActivitiesBySource,
  insertActivities,
  insertActivity,
  insertNewActivity,
  insertOverride,
  markActivityDetailSynced,
  materializeSuperseded,
  mergeOverlappingActivities,
  restoreActivity,
  updateActivity,
  updateActivityEndTimeByExternalId,
  updateActivityTypeByTagKey,
  updateScreentimeActivityCategoryPath,
} from './activities/index.ts'

export {
  deleteDetectedLocation,
  deleteNamedLocation,
  findNearbyDetectedLocation,
  getDetectedLocationById,
  getDetectedLocations,
  getDetectedLocationsNeedingGeocode,
  getLocations,
  getNamedLocationById,
  getNamedLocations,
  insertDetectedLocation,
  insertLocation,
  insertLocations,
  insertNamedLocation,
  insertPlace,
  softDeleteSupersededLocations,
  updateDetectedLocation,
  updateNamedLocation,
} from './locations.ts'

export {
  batchUpdateResolvedCategory,
  deleteProductivityRecord,
  getAllProductivityForCategorization,
  getDistinctApps,
  getProductivity,
  type ProductivityBucketRow,
  getProductivityBucketed,
  getProductivityById,
  insertProductivity,
  restoreProductivityRecord,
} from './productivity.ts'

export {
  bulkInsertScreentimeCategories,
  deleteAllScreentimeCategories,
  deleteScreentimeCategoryWithChildren,
  getScreentimeCategories,
  getScreentimeCategoryById,
  insertScreentimeCategory,
  moveScreentimeCategory,
  updateScreentimeCategory,
  upsertScreentimeCategory,
} from './screentime-categories.ts'

export {
  deleteNote,
  deleteNotesForEntity,
  getNoteById,
  getNoteRoot,
  getNotesByEntityIds,
  getNotesForEntity,
  getNotesForTimeRange,
  getRepliesForRootIds,
  getUserNotesJoined,
  insertNote,
  type NoteFieldUpdates,
  reanchorNotes,
  replaceUserNotes,
  updateNoteFields,
  updateNoteTimesForEntity,
  upsertSyncedNote,
} from './notes.ts'

export {
  createSharedDashboard,
  deleteSharedDashboard,
  getSharedDashboardById,
  getSharedDashboardBySlug,
  listPublicSharedDashboards,
  listSharedDashboards,
  type SharedDashboardInput,
  type SharedDashboardPatch,
  type SharedDashboardRecord,
  updateSharedDashboard,
} from './shared-dashboards.ts'

export {
  type ChallengeInput,
  type ChallengeMemberInput,
  type ChallengeMemberRecord,
  type ChallengeParticipationInput,
  type ChallengeParticipationRecord,
  type ChallengePatch,
  type ChallengeRecord,
  type ChallengeSpecFields,
  createChallenge,
  createChallengeParticipation,
  deleteChallenge,
  deleteChallengeParticipation,
  getChallengeById,
  getChallengeBySlug,
  getChallengeMemberByIdentity,
  getParticipationById,
  getParticipationByToken,
  getParticipationByUrl,
  listChallengeMembers,
  listChallengeParticipations,
  listChallenges,
  listChallengesAwaitingResult,
  listLeftChallengeUrls,
  listPublicChallenges,
  markChallengeResultPublished,
  removeChallengeMember,
  updateChallenge,
  updateChallengeMemberCache,
  upsertChallengeMember,
} from './challenges.ts'

export { isMissingDatabase } from './pg-errors.ts'

export { type ActorKeyPair, getOrCreateActorKeyPair } from './feed-actor.ts'

export {
  countFeedFollowers,
  type FeedFollowerInput,
  type FeedFollowerRecord,
  getFeedFollowerByActor,
  getFeedFollowerById,
  listFeedFollowers,
  removeFeedFollower,
  removeFeedFollowerById,
  setFeedFollowerAccepted,
  updateFeedFollowerPresentation,
  upsertFeedFollower,
} from './feed-follower.ts'

export {
  countAcceptedFeedFollowing,
  type FeedFollowingInput,
  type FeedFollowingRecord,
  getFeedFollowing,
  getFeedFollowingByActor,
  listAcceptedFeedFollowing,
  listFeedFollowing,
  markFeedFollowingAccepted,
  removeFeedFollowing,
  removeFeedFollowingByActor,
  updateFeedFollowingNotify,
  updateFeedFollowingPresentation,
  upsertFeedFollowing,
} from './feed-following.ts'

export {
  countFeedPostReactions,
  type FeedPostReactionCount,
  type FeedPostReactionInput,
  type FeedPostReactionRecord,
  type FeedReactionInput,
  type FeedReactionRecord,
  type FeedReactionState,
  getFeedReaction,
  insertFeedReaction,
  listFeedPostReactions,
  listFeedReactionsForObjects,
  removeFeedPostReaction,
  removeFeedPostReactionByActivity,
  removeFeedReaction,
  updateFeedPostReactionPresentation,
  upsertFeedPostReaction,
} from './feed-reactions.ts'

export {
  type BoostedCopyFields,
  countTimelineRepliesTo,
  deleteBoostEntry,
  deleteTimelineEntriesByActor,
  deleteTimelineEntryByUri,
  getTimelineEntryById,
  getTimelineEntryByObjectUri,
  hasCachedActorPresentation,
  isTimelineEntryVisible,
  listReplyUncheckedEntries,
  listTimelineEntries,
  listTimelineRepliesTo,
  listUnenrichedAurbodaEntries,
  markEnrichTransientFailure,
  markTimelineEntryReplyChecked,
  refreshBoostedCopies,
  setTimelineEntryReplyInfo,
  setTimelineEntryStructured,
  type TimelineCursor,
  type TimelineEntryInput,
  type TimelineEntryRecord,
  type TimelinePageRow,
  type TimelineReplyCount,
  type TimelineReplyFilter,
  type UnenrichedTimelineEntry,
  updateTimelineActorPresentation,
  upsertTimelineEntry,
} from './timeline.ts'
export { emitTimelineNotify, openTimelineChannel } from './timeline-notify.ts'

export {
  type ArticlePostInput,
  countPublicFeedPosts,
  type ChallengePostInput,
  createArticlePost,
  createChallengePost,
  createFeedPost,
  createReplyPost,
  deleteFeedPost,
  type FeedPostCursor,
  type FeedPostInput,
  type FeedPostPageRow,
  type FeedPostPatch,
  type FeedPostRecord,
  findCoveringSharedSeriesWindow,
  getFeedPostById,
  getFeedTombstone,
  listFeedPostIdsByActivityIds,
  listFeedPosts,
  listPublicFeedPosts,
  listPublicFeedPostsKeyset,
  listPublicFeedPostsPage,
  listReplyPostsTo,
  type PublicFeedPageOpts,
  type ReplyPostInput,
  updateFeedPost,
} from './feed.ts'

export {
  type AutoshareCandidate,
  type AutoshareRuleInput,
  type AutoshareRulePatch,
  type AutoshareRuleRecord,
  countAutosharePostsByRule,
  deleteAutoshareRule,
  getActivityIngestTimes,
  getAutoshareRules,
  getEnabledAutoshareRules,
  insertAutoshareRule,
  listAutoshareCandidates,
  listAutoshareSuppressedIds,
  updateAutoshareRule,
} from './autoshare-rules.ts'

export {
  deleteFoodItem,
  findOrCreateFoodItem,
  getFoodItemById,
  getFoodItemByName,
  getFoodItemsByIds,
  listFoodItems,
  type MergeFoodItemResult,
  mergeFoodItems,
  searchFoodItems,
  setFoodItemReference,
  updateFoodItem,
  upsertFoodItem,
} from './food-items.ts'
export {
  findMealsContainingFoodItem,
  getMealFoodItems,
  getMealFoodItemsBatch,
  setMealFoodItems,
} from './meal-food-items.ts'

export {
  deleteFoodItemSensitivities,
  deleteSensitivityFlag,
  type FoodItemSensitivityRow,
  getFoodItemSensitivities,
  getFoodItemSensitivityFlagIds,
  getFoodItemSensitivityNamesBatch,
  getSensitivityFlagByName,
  insertSensitivityFlag,
  listSensitivityFlags,
  mergeFoodItemSensitivities,
  type SensitivityFlag,
  type SensitivityFlagInput,
  setFoodItemSensitivities,
  updateSensitivityFlag,
} from './sensitivities.ts'

export {
  clearIngredients,
  findCompositeParentsOfIngredient,
  type FoodItemIngredientInput,
  type FoodItemIngredientRow,
  getIngredients,
  getIngredientsBatch,
  setIngredients,
} from './food-item-ingredients.ts'

export {
  deleteFoodItemPortion,
  deletePortionsForFoodItem,
  type FoodItemPortionRow,
  getFoodItemPortionById,
  getPortionsByFoodItemIds,
  insertFoodItemPortion,
  type InsertFoodItemPortionInput,
  listPortionsForFoodItem,
  type UpdateFoodItemPortionInput,
  updateFoodItemPortion,
} from './food-item-portions.ts'

export {
  type DailyNutrientTotal,
  deleteMeal,
  type FrequentFoodItemRow,
  type FrequentMealRow,
  getDailyNutrientTotals,
  getFrequentFoodItems,
  getFrequentMeals,
  getMealById,
  getMealLogCompleted,
  getMealLogCompletedInRange,
  getMeals,
  getNutritionCompleteDaysInRange,
  insertMeal,
  type NutrientKey,
  NUTRIENT_KEYS,
  upsertMeal,
  setMealLogCompleted,
  unsetMealLogCompleted,
  updateMeal,
} from './meals.ts'

export { getLabResults, insertLabResult } from './lab-results.ts'

export {
  deleteReport,
  getLatestMetricValue,
  getReportById,
  getReportEntryMetrics,
  getReports,
  insertReport,
  updateReport,
} from './reports.ts'

export { getOAuthToken, upsertOAuthToken } from './oauth.ts'

export { getAllSyncStates, getSyncState, resetSyncState, upsertSyncState } from './sync-state.ts'

export {
  deleteHealthConnectRecords,
  getDailyAggregateValue,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
} from './health-connect.ts'

export {
  ackOutboundSync,
  enqueueOutboundSync,
  failOutboundSync,
  findHcRecordId,
  getOutboundSyncHistory,
  getPendingOutboundSync,
  reportSyncFailure,
  requeueOutboundSync,
  type EnqueueOutboundSyncInput,
  type OutboundSyncEntry,
  type OutboundSyncOperation,
  type OutboundSyncStatus,
  type PendingOutboundSyncResult,
} from './outbound-sync.ts'

export { deleteIcon, getIcon, insertIcon } from './icons.ts'

export {
  deleteProfileAvatar,
  getProfileAvatar,
  getProfileAvatarVersion,
  type ProfileAvatar,
  upsertProfileAvatar,
} from './profile-avatar.ts'

export {
  clearSharedFoodItemOverride,
  getSharedFoodItemOverride,
  getSharedFoodItemOverridesByIds,
  setSharedFoodItemOverride,
  type SharedFoodItemOverride,
  type SharedFoodItemOverrideInput,
} from './shared-food-item-overrides.ts'

export {
  clearUserNutrientRecommendation,
  getUserNutrientRecommendation,
  listUserNutrientRecommendations,
  upsertUserNutrientRecommendation,
  type UserNutrientRecommendationInput,
  type UserNutrientRecommendationRow,
} from './user-nutrient-recommendations.ts'

export { getUserSettings, upsertUserSettings } from './settings.ts'

export { deleteGoal, getGoals, insertGoal, replaceGoals } from './goals.ts'

export {
  bulkInsertCustomMetricDefinitions,
  deleteCustomMetricDefinition,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  mergeCustomMetric,
  updateCustomMetricDefinition,
} from './custom-metrics.ts'

export {
  deleteExpiredMcpSessions,
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions.ts'

export {
  cleanupAuditLog,
  insertAuditLog,
  queryAuditLog,
  type AuditLogQueryParams,
  type AuditLogRow,
} from './audit-log.ts'

export {
  deleteWebAuthnCredential,
  getWebAuthnCredentialById,
  getWebAuthnCredentialsForUser,
  insertWebAuthnCredential,
  updateWebAuthnCredentialNickname,
  updateWebAuthnCredentialUsage,
  type WebAuthnCredentialRow,
} from './webauthn.ts'

export {
  mapActivityRow,
  mapDetectedLocationRow,
  mapMcpSessionRow,
  mapMealRow,
  mapNamedLocationRow,
  mapNoteRow,
  mapReportEntryRow,
  mapReportRow,
  mapSyncStateRow,
  parseActivityType,
  parseDataSource,
  parseEntityType,
  parseGeocodeStatus,
  parseMetricType,
  parseSyncStatus,
} from './row-mappers.ts'
