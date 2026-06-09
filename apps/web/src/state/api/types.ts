import type {
  Activity as ApiActivity,
  DetectedLocation as ApiDetectedLocation,
  Meal as ApiMeal,
  PlaceVisit as ApiPlaceVisit,
  ProductivityRecord as ApiProductivityRecord,
  Report as ApiReport,
  DataSchemaDefinition,
} from '@aurboda/api-spec'

// Frontend types with Date objects (converted from API string types)
export type BuiltinActivityType = 'sleep' | 'exercise' | 'meditation' | 'nap' | 'rest'
export type ActivityType = string

export interface ActivityTypeDefinition {
  name: string
  display_name: string
  display_category: string
  color: string
  icon?: string
  aliases?: string[]
  is_builtin: boolean
  show_on_timeline: boolean
  data_schema?: DataSchemaDefinition
  /** Snake-case name of the parent activity type, if this type is a child. */
  parent_type?: string
}

export interface DataFilter {
  field: string
  operator: 'eq' | 'neq' | 'exists' | 'not_exists'
  value?: string | number | boolean
}

export interface DeductionRuleCondition {
  kind: 'activity' | 'screentime_category' | 'activity_data' | 'location' | 'after_date' | 'scrobble'
  activity_type?: string
  data_filters?: DataFilter[]
  category?: string[]
  field?: string
  operator?: 'eq' | 'neq' | 'exists' | 'not_exists'
  value?: string | number | boolean
  location_name?: string
  date?: string
  // Scrobble condition fields
  artist?: string[]
  track?: string
  match_mode?: 'exact' | 'contains'
  duration_seconds?: number
}

export interface DeductionRule {
  id: string
  name: string
  enabled: boolean
  priority: number
  conditions: DeductionRuleCondition[]
  output_activity_type: string
  output_title?: string
  merge_gap_seconds?: number
  mode?: 'create' | 'enrich'
  output_data?: Record<string, unknown>
  created_at?: string
}

export interface SourceRecord {
  id: string
  source: string
  start_time: string
  end_time?: string
  title?: string
  data_origin?: string
  activity_type?: string
}

export interface Activity extends Omit<ApiActivity, 'start_time' | 'end_time'> {
  start_time: Date
  end_time?: Date
  source_records?: SourceRecord[]
  merged_start_time?: Date
  merged_end_time?: Date
  /**
   * Provenance of activities that were folded into this one by
   * `collapseToParentType`. Set only on the synthetic survivor; never on
   * activities returned by the API. Drives the "Merged: Running, Yoga"
   * tooltip line for hierarchy-collapsed bars.
   */
  collapsed_types?: { type: string; count: number }[]
}

export interface ProductivityRecord extends Omit<ApiProductivityRecord, 'start_time' | 'end_time'> {
  start_time: Date
  end_time: Date
}

export interface Place {
  region: string
  start_time: Date
  end_time: Date
}

export interface PlaceVisit extends Omit<ApiPlaceVisit, 'start_time' | 'end_time'> {
  start_time: Date
  end_time: Date
  durationMinutes: number
}

export interface StoredDetectedLocation extends Omit<ApiDetectedLocation, 'first_visit' | 'last_visit'> {
  first_visit: Date
  last_visit: Date
}

/**
 * Scrobble shape used by the music staff renderer + Data/MusicPlaylist pages.
 * `fetchScrobbles` derives these from `music_scrobble` activities — there is
 * no longer a wire schema (the old `/lastfm/scrobbles` endpoint was a
 * redundant wrapper over the activities table).
 */
export interface Scrobble {
  artist: string
  track: string
  album: string
  recorded_at: Date
}

export interface Meal extends Omit<ApiMeal, 'time' | 'created_at'> {
  time: Date
  created_at?: Date
  nutrients?: Record<string, number>
}

export interface Report extends Omit<ApiReport, 'date' | 'created_at'> {
  date: Date
  created_at?: Date
}

export type { AddReportBody, Confidence, ReportEntry, ReportFlag } from '@aurboda/api-spec'

// Defined locally to avoid Zod type resolution issues with api-spec's z.infer<z.ZodEnum>
export type BiologicalSex = 'male' | 'female'

// Re-export API types that don't need Date conversion
export type {
  ActivityCorrelation,
  ActivityImpactData,
  ActivityImpactType,
  BaselineData,
  CustomMetricDefinition,
  DashboardConfig,
  ExerciseTypeName,
  Goal,
  GoalProgress,
  HrvActivitiesData,
  HrvContextMetric,
  HrvStats,
  HrvStatsWithDelta,
  HrZoneThresholds,
  LocationCorrelation,
  NamedLocation,
  PeriodMetricStats,
  ProductivityCorrelation,
  TrendDisplayPeriod,
  TrendResult,
  TrendSourceType,
  UpdateSettingsInput,
  UserSettingsResponse,
} from '@aurboda/api-spec'
