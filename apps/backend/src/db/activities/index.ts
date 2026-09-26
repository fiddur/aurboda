export {
  CROSS_MERGE_SOURCES,
  findMergedGroupForActivity,
  isSupersedable,
  mergeOverlappingActivities,
} from './merge.ts'

export { backfillSuperseded, materializeSuperseded } from './supersession.ts'

export {
  adoptLegacyActivity,
  deleteActivity,
  deleteGarminActivityWithWrongType,
  hardDeleteActivitiesByExternalIdPrefix,
  hardDeleteActivitiesBySource,
  insertActivities,
  insertActivity,
  insertNewActivity,
  insertOverride,
  markActivityDetailSynced,
  migrateExerciseTypes,
  restoreActivity,
  softDeleteActivityByExternalId,
  updateActivity,
  updateActivityEndTimeByExternalId,
  updateActivityTypeByTagKey,
  updateScreentimeActivityCategoryPath,
} from './mutations.ts'

export {
  checkActivityConflict,
  type DataFilter,
  findAdjacentActivity,
  findActivityByExternalId,
  findDeletedActivityByExternalId,
  findMergeableActivity,
  getActivities,
  getActivitiesByCategory,
  getActivitiesExcludingCategories,
  getActivitiesNeedingDetail,
  getActivityById,
  getActivitySourcesByIds,
  getAllActivitiesInRange,
  getAllActivityTypeNames,
  getNearbyActivities,
  getNonSleepActivitiesMerged,
  getOverlappingActivities,
  getOverrideForActivity,
  getScreentimeActivities,
  getSleepSessions,
} from './queries.ts'
