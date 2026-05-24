/**
 * Shared types and helpers for query services.
 */

import type { ActivityComputedMetrics, DataSource } from '@aurboda/api-spec'

import type { MetricType } from '../../schema.ts'
import type { HrZoneSecs } from '../settings.ts'

import { getActivityTypeDefinitions, getNotesByEntityIds } from '../../db/index.ts'

// ============================================================================
// Helpers
// ============================================================================

/** Build a map of activity_type -> display_category from type definitions. */
export const buildCategoryMap = async (user: string): Promise<Map<string, string>> => {
  const defs = await getActivityTypeDefinitions(user)
  return new Map(defs.map((d) => [d.name, d.display_category]))
}

export interface CommentSummary {
  id: string
  content: string
  source?: string
  start_time?: string
  end_time?: string
  created_at: string
  updated_at: string
}

export const getCommentsMap = async (
  user: string,
  entityType: 'activity' | 'productivity' | 'metric',
  ids: string[],
): Promise<Map<string, CommentSummary[]>> => {
  const notesMap = await getNotesByEntityIds(user, entityType, ids)
  const result = new Map<string, CommentSummary[]>()
  for (const [entityId, notes] of notesMap) {
    result.set(
      entityId,
      notes.map((n) => ({
        content: n.content,
        created_at: n.created_at.toISOString(),
        end_time: n.end_time?.toISOString(),
        id: n.id,
        source: n.source ?? undefined,
        start_time: n.start_time?.toISOString(),
        updated_at: n.updated_at.toISOString(),
      })),
    )
  }
  return result
}

// ============================================================================
// Types
// ============================================================================

/**
 * Provider for auto-syncing data from external sources before queries.
 * Pass this to query functions to enable automatic data refresh.
 */
export interface SyncProvider {
  /** Sync Oura data if stale (tags, sessions, etc.) */
  syncOuraIfNeeded: (user: string, dataType: 'tags' | 'sessions') => Promise<void>
  /** Sync Garmin data if stale */
  syncGarminIfNeeded: (user: string, dataType: string) => Promise<void>
  /** Sync RescueTime productivity data if stale */
  syncRescueTimeIfNeeded: (user: string) => Promise<void>
  /** Sync calendar data if stale */
  syncCalendarsIfNeeded: (user: string) => Promise<void>
  /** Sync Last.fm scrobbles if stale */
  syncLastFmIfNeeded: (user: string) => Promise<void>
}

export interface MetricDataPoint {
  source?: string
  time: string
  value: number
}

export interface QueryMetricsResult {
  metric: string
  unit: string
  count: number
  data: MetricDataPoint[]
}

/**
 * Bucket size string in {number}{unit} format (e.g., '5m', '10s', '1h', '1d', '1M').
 */
export type BucketSize = string

/**
 * Bucket statistics for a single metric.
 */
export interface BucketMetricStats {
  avg: number
  min: number
  max: number
  count: number
  sum?: number
  first_time: string
  last_time: string
}

/**
 * A single time bucket with aggregated metrics.
 */
export interface MetricBucket {
  start: string
  end: string
  metrics: Partial<Record<MetricType, BucketMetricStats>>
}

/**
 * Result of a bucketed metrics query.
 */
export interface QueryMetricsBucketedResult {
  start: string
  end: string
  bucket: BucketSize
  buckets: MetricBucket[]
}

export interface HeartRateStats {
  min: number
  max: number
  avg: number
  count: number
}

export interface SessionSummary {
  start_time: string
  end_time?: string
  duration?: number // minutes
  title?: string
  hr_zone_secs?: HrZoneSecs
}

export interface StressZoneSecs {
  rest: number
  low: number
  medium: number
  high: number
}

export interface ActivitySummary {
  activity_type: string
  start_time: string
  end_time?: string
  title?: string
  data?: Record<string, unknown>
  comments?: CommentSummary[]
  hr_zone_secs?: HrZoneSecs
  stress_zone_secs?: StressZoneSecs
  category_path?: string[]
}

export interface SleepLocation {
  name: string
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  lat?: number
  lon?: number
}

export interface SleepStageSummary {
  awake_min?: number
  light_min?: number
  deep_min?: number
  rem_min?: number
}

export interface SleepSessionSummary {
  start_time: string
  end_time?: string
  duration?: number // minutes (actual sleep time or time in bed)
  time_in_bed?: number // minutes
  total_sleep?: number // minutes (from sleep stage data)
  sleep_date?: string // YYYY-MM-DD — the date this sleep "belongs to" (wake-up convention)
  sleep_location?: SleepLocation
  sleep_stages?: SleepStageSummary
}

export interface TagSummary {
  id?: string
  external_id?: string
  tag: string
  start_time: string
  end_time?: string
  source?: DataSource
  comments: CommentSummary[]
}

export interface PlaceSummary {
  name: string
  start_time: string
  end_time: string
  duration: number // minutes
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  lat?: number
  lon?: number
  address?: string
  detected_location_id?: string
}

export interface ProductivitySummary {
  total_duration_sec: number
  productive_sec: number
  very_productive_sec: number
  distracting_sec: number
  categories?: Array<{ path: string[]; duration_sec: number }>
}

export interface Scores {
  sleep_score: number | null
  readiness_score: number | null
  resilience_score: number | null
  cardiovascular_age: number | null
}

export interface MealSummary {
  time: string
  meal_type?: string
  name?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: string[]
}

export interface NoteSummary {
  id: string
  entity_type: 'activity' | 'productivity' | 'metric' | 'report'
  entity_id: string
  content: string
  start_time?: string
  end_time?: string
  created_at: string
  updated_at: string
}

export interface DailySummaryMetricEntry {
  time: string
  value: number
  source: string
  notes?: string
}

export interface DailySummaryMetricStats {
  unit: string
  count: number
  min: number
  max: number
  avg: number
  latest: number
  latest_time: string
  entries: DailySummaryMetricEntry[]
}

export interface DailySummaryMetricLatest {
  value: number
  time: string
  unit: string
  source: string
  notes?: string
}

export interface DailySummaryResult {
  date: string
  activities: ActivitySummary[]
  heart_rate: HeartRateStats | null
  meals: MealSummary[]
  metrics_today: Record<string, DailySummaryMetricStats>
  metrics_latest: Record<string, DailySummaryMetricLatest>
  notes: NoteSummary[]
  steps: { total: number }
  sleep_sessions: SleepSessionSummary[]
  productivity: ProductivitySummary | null
  places: PlaceSummary[]
  scores: Scores | null
  stress_zones: StressZoneSecs | null
}

export interface PeriodMetricStats {
  metric: string
  unit: string
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  trend_per_day: number | null
  change_from_previous_period_percent: number | null
  completeness_percent: number
  outliers?: { type: 'high' | 'low'; value: number }[]
}

export interface PeriodSummaryResult {
  start: string
  end: string
  period_days: number
  metrics: PeriodMetricStats[]
}

/**
 * Activity query result with formatted timestamps. Inherits all computed
 * metric fields (avg pace, body battery before/after, hr_zone_secs, avg_hrv,
 * etc.) from the api-spec ActivityComputedMetrics contract.
 */
export interface ActivityResult extends ActivityComputedMetrics {
  id?: string
  start_time: string
  end_time?: string
  duration?: number // minutes
  time_in_bed?: number // minutes (end_time - start_time, sleep only)
  total_sleep?: number // minutes (actual sleep excluding awake, sleep only)
  activity_type: string
  title?: string
  source: string
  data?: Record<string, unknown>
  comments: CommentSummary[]
  override_target_ids?: string[]
}

/**
 * Productivity record with formatted timestamps.
 * source_ids lists all original record IDs that were merged into this span.
 */
export interface ProductivityResult {
  id?: string
  source_ids?: string[]
  start_time: string
  end_time: string
  activity: string
  title?: string
  category?: string
  category_id?: string
  productivity?: number
  duration_sec: number
  is_mobile?: boolean
  source?: DataSource
  resolved_category?: string[]
  comments: CommentSummary[]
}

export interface CategoryInfo {
  name: string[]
  color?: string
  score?: number
}
