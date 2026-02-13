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
  GeocodeStatus,
  LabResult,
  LastFmMatchMode,
  LastFmMatchType,
  LastFmTagRule,
  LastFmTagRuleInput,
  Location,
  McpSessionRecord,
  MetricStats,
  NamedLocation,
  NamedLocationInput,
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
export { insertRawRecord } from './raw-records'

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
  getActivities,
  getActivityById,
  getSleepSessions,
  insertActivity,
  mergeOverlappingActivities,
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
  findMergeableTag,
  getProgrammaticTags,
  getTags,
  getUniqueTags,
  insertTag,
  isProgrammaticTag,
  updateTagEndTime,
} from './tags'

// Productivity
export { getProductivity, insertProductivity } from './productivity'

// Lab results
export { getLabResults, insertLabResult } from './lab-results'

// OAuth
export { getOAuthToken, upsertOAuthToken } from './oauth'

// Sync state
export { getAllSyncStates, getSyncState, resetSyncState, upsertSyncState } from './sync-state'

// Health Connect
export { getDailyAggregateValue, processDailyAggregate, processHealthConnectData } from './health-connect'

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
  mapSyncStateRow,
  mapTagRow,
  parseActivityType,
  parseDataSource,
  parseGeocodeStatus,
  parseMetricType,
  parseSyncStatus,
} from './row-mappers'
