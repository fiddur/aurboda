/**
 * Barrel re-export for all database modules.
 *
 * All consumers can continue importing from './db.ts' or '../db' unchanged.
 */

// Types (interfaces & type aliases)
export type {
  Activity,
  ActivityUpdate,
  BucketedMetricData,
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

// Connection & schema management
export {
  _setClientForUser,
  getDbForUser,
  initializeSchema,
  loginToUserDb,
  makeNewUserDb,
  migrateSchema,
  query,
  schemaInitialized,
} from './connection.ts'

// Raw records
export { getAllScrobbles, getScrobbles, insertRawRecord, type ScrobbleRecord } from './raw-records.ts'

// Time series
export {
  deleteTimeSeriesBySource,
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getDailyAggregates,
  getDistinctMetrics,
  getRawDailySum,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
  getTimeSeriesWithSource,
  insertTimeSeries,
} from './time-series.ts'

// Deduction Rules
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

// Activity Type Definitions
export {
  activityTypeExists,
  deleteActivityTypeDefinition,
  getActivityTypeDefinition,
  getActivityTypeDefinitions,
  getActivityTypeNames,
  getHealthConnectExerciseType,
  insertActivityTypeDefinition,
  mergeActivityTypeDefinition,
  renameActivityTypeDefinition,
  resolveActivityTypeByAlias,
  resolveActivityTypeFromHcExerciseType,
  resolveOrCreateActivityType,
  updateActivityTypeDefinition,
} from './activity-type-definitions.ts'

// Activities
export {
  checkActivityConflict,
  deleteActivity,
  deleteGarminActivityWithWrongType,
  softDeleteActivityByExternalId,
  findMergeableActivity,
  findMergedGroupForActivity,
  getActivities,
  getActivitiesByCategory,
  getActivitiesExcludingCategories,
  getActivitiesNeedingDetail,
  getAllActivitiesInRange,
  migrateExerciseTypes,
  getNonSleepActivitiesMerged,
  getAllActivityTypeNames,
  getActivityById,
  getNearbyActivities,
  getOverlappingActivities,
  getSleepSessions,
  hardDeleteActivitiesByExternalIdPrefix,
  hardDeleteActivitiesBySource,
  insertActivities,
  insertActivity,
  insertNewActivity,
  markActivityDetailSynced,
  mergeOverlappingActivities,
  restoreActivity,
  updateActivity,
  updateActivityEndTimeByExternalId,
  updateActivityTypeByTagKey,
} from './activities.ts'

// Locations
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
  softDeleteLocationRange,
  updateDetectedLocation,
  updateNamedLocation,
} from './locations.ts'

// Productivity
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

// Screentime categories
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

// Notes
export {
  deleteNote,
  getNoteById,
  getNotesByEntityIds,
  getNotesForEntity,
  getNotesForTimeRange,
  insertNote,
  updateNote,
  updateNoteTimesForEntity,
  upsertSyncedNote,
} from './notes.ts'

// Food Items
export {
  deleteFoodItem,
  findOrCreateFoodItem,
  getFoodItemById,
  getFoodItemByName,
  listFoodItems,
  searchFoodItems,
  updateFoodItem,
  upsertFoodItem,
} from './food-items.ts'
export { getMealFoodItems, getMealFoodItemsBatch, setMealFoodItems } from './meal-food-items.ts'

// Meals
export {
  deleteMeal,
  getMealById,
  getMealLogCompleted,
  getMeals,
  insertMeal,
  upsertMeal,
  setMealLogCompleted,
  unsetMealLogCompleted,
  updateMeal,
} from './meals.ts'

// Lab results (legacy)
export { getLabResults, insertLabResult } from './lab-results.ts'

// Reports (structured lab results)
export {
  deleteReport,
  getLatestMetricValue,
  getReportById,
  getReportEntryMetrics,
  getReports,
  insertReport,
  updateReport,
} from './reports.ts'

// OAuth
export { getOAuthToken, upsertOAuthToken } from './oauth.ts'

// Sync state
export { getAllSyncStates, getSyncState, resetSyncState, upsertSyncState } from './sync-state.ts'

// Health Connect
export {
  deleteHealthConnectRecords,
  getDailyAggregateValue,
  processDailyAggregate,
  processHealthConnectBatch,
  processHealthConnectData,
} from './health-connect.ts'

// Outbound sync queue
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

// Uploaded icons
export { deleteIcon, getIcon, insertIcon } from './icons.ts'

// Settings
export { getUserSettings, upsertUserSettings } from './settings.ts'

// Goals
export { deleteGoal, getGoals, insertGoal, replaceGoals } from './goals.ts'

// Custom metric definitions
export {
  bulkInsertCustomMetricDefinitions,
  deleteCustomMetricDefinition,
  getCustomMetricByName,
  getCustomMetricDefinitions,
  insertCustomMetricDefinition,
  mergeCustomMetric,
  updateCustomMetricDefinition,
} from './custom-metrics.ts'

// MCP sessions
export {
  deleteExpiredMcpSessions,
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions.ts'

// Audit log
export {
  cleanupAuditLog,
  insertAuditLog,
  queryAuditLog,
  type AuditLogQueryParams,
  type AuditLogRow,
} from './audit-log.ts'

// Row mappers (re-export for consumers that need them directly)
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
