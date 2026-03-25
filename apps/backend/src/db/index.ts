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
  LastFmMatchMode,
  LastFmMatchType,
  LastFmTagRule,
  LastFmTagRuleInput,
  Location,
  McpSessionRecord,
  Meal,
  MealFoodItem,
  MergedActivity,
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
  Tag,
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

// Activities
export {
  deleteActivity,
  findMergedGroupForActivity,
  getActivities,
  getActivityById,
  getOverlappingActivities,
  getSleepSessions,
  insertActivity,
  mergeOverlappingActivities,
  restoreActivity,
  updateActivity,
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
  insertNamedLocation,
  insertPlace,
  updateDetectedLocation,
  updateNamedLocation,
} from './locations.ts'

// Tags
export {
  deleteTag,
  deleteTagById,
  findMergeableTag,
  getProgrammaticTags,
  getTagById,
  getTags,
  getUniqueTags,
  hardDeleteTagsByExternalIdPrefix,
  hardDeleteTagsBySource,
  insertTag,
  isProgrammaticTag,
  restoreTag,
  updateTag,
  updateTagEndTime,
  updateTagNameByKey,
} from './tags.ts'

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

// Meals
export { deleteMeal, getMealById, getMeals, insertMeal, updateMeal } from './meals.ts'

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

// Last.fm tag rules
export {
  deleteLastFmTagRule,
  getLastFmTagRules,
  insertLastFmTagRule,
  updateLastFmTagRule,
} from './lastfm-rules.ts'

// MCP sessions
export {
  deleteExpiredMcpSessions,
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions.ts'

// Row mappers (re-export for consumers that need them directly)
export {
  mapActivityRow,
  mapDetectedLocationRow,
  mapLastFmTagRuleRow,
  mapMcpSessionRow,
  mapMealRow,
  mapNamedLocationRow,
  mapNoteRow,
  mapReportEntryRow,
  mapReportRow,
  mapSyncStateRow,
  mapTagRow,
  parseActivityType,
  parseDataSource,
  parseEntityType,
  parseGeocodeStatus,
  parseMetricType,
  parseSyncStatus,
} from './row-mappers.ts'
