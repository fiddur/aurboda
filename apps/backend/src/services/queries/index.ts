/**
 * Query services for health data.
 *
 * These functions contain the business logic for querying health data.
 * They are used by both the MCP tools and the REST API.
 */

export {
  type ActivityResult,
  type ActivitySummary,
  type BucketMetricStats,
  type BucketSize,
  type CategoryInfo,
  type CommentSummary,
  type DailySummaryResult,
  type HeartRateStats,
  type MealSummary,
  type MetricBucket,
  type MetricDataPoint,
  type NoteSummary,
  type PeriodMetricStats,
  type PeriodSummaryResult,
  type PlaceSummary,
  type ProductivityResult,
  type ProductivitySummary,
  type QueryMetricsBucketedResult,
  type QueryMetricsResult,
  type Scores,
  type SessionSummary,
  type SleepLocation,
  type SleepSessionSummary,
  type SleepStageSummary,
  type StressZoneSecs,
  type SyncProvider,
  type TagSummary,
} from './types.ts'

export { parseBucketSize, queryMetrics, queryMetricsBucketed } from './metrics.ts'

export {
  computeSleepStageSummary,
  computeStressZoneSecs,
  findSleepLocation,
  getDailySummary,
} from './daily-summary.ts'

export { getPeriodSummary } from './period-summary.ts'

export { queryTags } from './tags.ts'

export { queryActivities } from './activities.ts'

export {
  ALL_METRICS_SENTINEL,
  computeActivityDetailMetrics,
  type ActivityDetailMetrics,
  type ActivityFullDetail,
  type ActivityFullDetailOptions,
  getActivityFullDetail,
  parseMetricsParam,
} from './activity-detail.ts'

export {
  assembleScreentimeBuckets,
  mergeByCategorySpans,
  mergeProductivitySpans,
  queryProductivity,
} from './productivity.ts'

export { queryLocations } from './locations.ts'
