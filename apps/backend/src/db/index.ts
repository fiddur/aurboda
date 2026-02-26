/**
 * Barrel re-export for all database modules.
 *
 * All consumers can continue importing from './db' or '../db' unchanged.
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
  MergedActivity,
  MetricStats,
  NamedLocation,
  NamedLocationInput,
  Note,
  OAuthToken,
  Place,
  ProductivityRecord,
  RawRecord,
  SyncState,
  SyncStatus,
  Tag,
  TimeSeriesPoint,
  UserSettings,
} from './types'

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
} from './connection'

// Raw records
export { getAllScrobbles, getScrobbles, insertRawRecord, type ScrobbleRecord } from './raw-records'

// Time series
export {
  deleteTimeSeriesMetric,
  deleteTimeSeriesPoint,
  getDailyAggregates,
  getTimeSeries,
  getTimeSeriesBucketed,
  getTimeSeriesMultiMetric,
  getTimeSeriesStats,
  insertTimeSeries,
} from './time-series'

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
} from './activities'

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
} from './locations'

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
  updateTagEndTime,
  updateTagNameByKey,
} from './tags'

// Productivity
export {
  deleteProductivityRecord,
  getProductivity,
  insertProductivity,
  restoreProductivityRecord,
} from './productivity'

// Notes
export {
  deleteNote,
  getNoteById,
  getNotesByEntityIds,
  getNotesForEntity,
  insertNote,
  updateNote,
} from './notes'

// Lab results
export { getLabResults, insertLabResult } from './lab-results'

// OAuth
export { getOAuthToken, upsertOAuthToken } from './oauth'

// Sync state
export { getAllSyncStates, getSyncState, resetSyncState, upsertSyncState } from './sync-state'

// Health Connect
export {
  deleteHealthConnectRecords,
  getDailyAggregateValue,
  processDailyAggregate,
  processHealthConnectData,
} from './health-connect'

// Outbound sync queue
export {
  ackOutboundSync,
  enqueueOutboundSync,
  failOutboundSync,
  findHcRecordId,
  getPendingOutboundSync,
  type EnqueueOutboundSyncInput,
  type OutboundSyncEntry,
  type OutboundSyncOperation,
  type OutboundSyncStatus,
} from './outbound-sync'

// Settings
export { getUserSettings, upsertUserSettings } from './settings'

// Last.fm tag rules
export { deleteLastFmTagRule, getLastFmTagRules, insertLastFmTagRule } from './lastfm-rules'

// MCP sessions
export {
  deleteExpiredMcpSessions,
  deleteMcpSession,
  getMcpSession,
  getMcpSessionsForUser,
  saveMcpSession,
  touchMcpSession,
} from './mcp-sessions'

// Row mappers (re-export for consumers that need them directly)
export {
  mapActivityRow,
  mapDetectedLocationRow,
  mapLastFmTagRuleRow,
  mapMcpSessionRow,
  mapNamedLocationRow,
  mapNoteRow,
  mapSyncStateRow,
  mapTagRow,
  parseActivityType,
  parseDataSource,
  parseEntityType,
  parseGeocodeStatus,
  parseMetricType,
  parseSyncStatus,
} from './row-mappers'
