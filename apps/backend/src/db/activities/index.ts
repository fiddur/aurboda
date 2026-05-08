/**
 * Barrel re-export for activity DB operations. The original `db/activities.ts`
 * was split into:
 *   - merge.ts        — pure merge logic (cross-source + same-type)
 *   - supersession.ts — superseded_by materialization (uses merge)
 *   - mutations.ts    — insert/update/delete writes
 *   - queries.ts      — read operations
 */
export {
  CROSS_MERGE_SOURCES,
  findMergedGroupForActivity,
  isSupersedable,
  mergeOverlappingActivities,
} from './merge.ts'

export { backfillSuperseded, materializeSuperseded } from './supersession.ts'

export {
  deleteActivity,
  deleteGarminActivityWithWrongType,
  hardDeleteActivitiesByExternalIdPrefix,
  hardDeleteActivitiesBySource,
  insertActivities,
  insertActivity,
  insertNewActivity,
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
  findMergeableActivity,
  getActivities,
  getActivitiesByCategory,
  getActivitiesExcludingCategories,
  getActivitiesNeedingDetail,
  getActivityById,
  getAllActivitiesInRange,
  getAllActivityTypeNames,
  getNearbyActivities,
  getNonSleepActivitiesMerged,
  getOverlappingActivities,
  getScreentimeActivities,
  getSleepSessions,
} from './queries.ts'
