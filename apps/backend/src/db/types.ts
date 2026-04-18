/**
 * Shared type definitions for all db modules.
 *
 * Interfaces and type aliases extracted from the monolithic db.ts.
 * These are imported by both domain modules and row-mappers to avoid circular dependencies.
 */
import type {
  ActivityType,
  BiologicalSex,
  Confidence,
  DashboardConfig,
  DataSource,
  EntityType,
  GarminDataType,
  GeocodeStatus,
  MetricType,
  ReportFlag,
  SyncStatus,
  TrainingLoadSettings,
} from '@aurboda/api-spec'

// ============================================================================
// Raw Records
// ============================================================================

export interface RawRecord {
  id?: string
  source: DataSource
  record_type: string
  external_id?: string
  recorded_at: Date
  data: Record<string, unknown>
}

// ============================================================================
// Time Series
// ============================================================================

export interface TimeSeriesPoint {
  time: Date
  metric: string
  value: number
  unit?: string
  source: DataSource
}

export interface MetricStats {
  metric: string
  count: number
  min: number
  max: number
  avg: number
  stddev: number
  unit: string
}

export interface DailyMetricAggregate {
  date: string
  metric: string
  avg: number
  sum: number
}

export interface BucketedMetricData {
  bucket_start: Date
  metric: MetricType
  avg: number
  min: number
  max: number
  count: number
  sum: number
}

// ============================================================================
// Activities
// ============================================================================

export interface Activity {
  id?: string
  source: DataSource
  external_id?: string
  activity_type: ActivityType
  start_time: Date
  end_time?: Date
  title?: string
  notes?: string
  data?: Record<string, unknown>
  deleted_at?: Date
  /** If set, this activity is a cross-source duplicate of the referenced activity. */
  superseded_by?: string
}

export interface MergedActivity extends Activity {
  source_ids?: string[] // only set when 2+ activities were merged
}

export interface ActivityUpdate {
  activity_type?: ActivityType
  start_time?: Date
  end_time?: Date | null
  title?: string
  notes?: string
  data?: Record<string, unknown>
}

// ============================================================================
// Locations
// ============================================================================

export interface Location {
  id?: string
  source?: DataSource
  time: Date
  lat: number
  lon: number
  accuracy?: number
  altitude?: number
  velocity?: number
  regions?: string[]
}

export interface Place {
  id?: string
  source?: DataSource
  external_id?: string
  name: string
  lat: number
  lon: number
  radius: number
}

export interface NamedLocation {
  id: string
  name: string
  lat: number
  lon: number
  radius: number
  created_at: Date
  updated_at: Date
}

export interface NamedLocationInput {
  name: string
  lat: number
  lon: number
  radius?: number
}

export type { GeocodeStatus }

export interface DetectedLocation {
  id: string
  lat: number
  lon: number
  radius: number
  total_minutes: number
  visit_count: number
  first_visit: Date
  last_visit: Date
  address: string | null
  geocode_status: GeocodeStatus
  created_at: Date
  updated_at: Date
}

export interface DetectedLocationInput {
  lat: number
  lon: number
  radius?: number
  total_minutes: number
  visit_count: number
  first_visit: Date
  last_visit: Date
}

export interface DetectedLocationUpdate {
  lat?: number
  lon?: number
  radius?: number
  total_minutes?: number
  visit_count?: number
  first_visit?: Date
  last_visit?: Date
  address?: string | null
  geocode_status?: GeocodeStatus
}

// ============================================================================
// Productivity
// ============================================================================

export interface ProductivityRecord {
  id?: string
  source?: DataSource
  start_time: Date
  end_time: Date
  activity: string
  title?: string
  category?: string
  productivity?: number
  duration_sec: number
  is_mobile?: boolean
  device_name?: string
  resolved_category?: string[]
  deleted_at?: Date
}

// ============================================================================
// Screentime Categories
// ============================================================================

export interface ScreentimeCategory {
  id: string
  name: string[]
  rule_type: 'regex' | 'none'
  rule_regex?: string
  ignore_case: boolean
  color?: string
  score?: number
  exclude_from_screentime?: boolean
  sort_order: number
  created_at: Date
  updated_at: Date
}

export interface ScreentimeCategoryInput {
  name: string[]
  rule_type: 'regex' | 'none'
  rule_regex?: string
  ignore_case?: boolean
  color?: string
  score?: number
  exclude_from_screentime?: boolean
  sort_order?: number
}

// ============================================================================
// Notes
// ============================================================================

export type { EntityType }

export interface Note {
  id: string
  entity_type: EntityType
  entity_id: string
  content: string
  /** Data source that created this note (e.g. 'oura'). Null for user-created notes. */
  source?: DataSource
  /** Inherited from the parent entity's start_time. Null for metric notes (composite key). */
  start_time?: Date
  /** Inherited from the parent entity's end_time, if any. */
  end_time?: Date
  created_at: Date
  updated_at: Date
}

// ============================================================================
// Lab Results
// ============================================================================

export interface LabResult {
  id?: string
  test_date: Date
  test_name: string
  test_category?: string
  value: number
  unit: string
  reference_low?: number
  reference_high?: number
  flag?: 'normal' | 'high' | 'low' | 'critical'
  lab_name?: string
  notes?: string
}

// ============================================================================
// Reports (structured lab results)
// ============================================================================

export type ReportConfidence = Confidence
export type { ReportFlag }

export interface ReportEntry {
  id: string
  report_id: string
  metric: string
  value: number
  unit: string
  method?: string
  confidence?: ReportConfidence
  reference_low?: number
  reference_high?: number
  flag?: ReportFlag
}

export interface Report {
  id: string
  report_type: string
  report_date: Date
  location?: string
  notes?: string
  created_at: Date
  entries: ReportEntry[]
}

// ============================================================================
// Meals
// ============================================================================

export type NutrientValue = number | { value: number; unit: string }
export type Micros = Record<string, NutrientValue>

export interface MealFoodItem {
  food_item_id?: string
  name: string
  quantity?: number
  unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  micros?: Micros
}

export interface Meal {
  id: string
  source: string
  meal_type?: string
  name?: string
  time: Date
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  food_items?: MealFoodItem[]
  micros?: Micros
  notes?: string
  sensitivities?: string[]
  created_at: Date
}

// ============================================================================
// Food Items (canonical library)
// ============================================================================

export interface FoodItemEntity {
  id: string
  name: string
  name_lower: string
  source: string
  default_quantity?: number
  default_unit?: string
  // All ~65 nutrient fields are optional numbers.
  // Using Record for the nutrient fields to avoid 65 lines of boilerplate.
  // At runtime these are individual columns, but in TypeScript we use an index signature.
  [nutrient: string]: string | number | Date | undefined
  created_at: Date
  updated_at: Date
}

export interface MealFoodItemLink {
  id: string
  meal_id: string
  food_item_id: string
  food_item_name?: string // populated via JOIN
  food_item_icon?: string // populated via JOIN
  quantity?: number
  unit?: string
  sort_order: number
  // Nutrient snapshot — same fields as FoodItemEntity
  [nutrient: string]: string | number | Date | undefined
}

// ============================================================================
// OAuth
// ============================================================================

export interface OAuthToken {
  provider: string
  access_token: string
  refresh_token?: string
  expires_at?: Date
  scopes?: string[]
}

// ============================================================================
// Sync State
// ============================================================================

export type { SyncStatus }

export interface SyncState {
  id?: string
  provider: string
  data_type: string
  last_sync_time?: Date
  sync_start_date?: Date
  status: SyncStatus
  error_message?: string
  retry_after?: Date
  updated_at?: Date
}

// ============================================================================
// Health Connect
// ============================================================================

export interface DailyAggregate {
  date: string // "2024-01-15"
  metric: string // "steps", "distance", etc.
  value: number
  data_origins: string[] // Contributing app package names
}

// ============================================================================
// User Settings
// ============================================================================

export interface CalendarConfig {
  name: string
  url: string
}

export interface UserSettings {
  birth_date?: string // YYYY-MM-DD
  calendars?: CalendarConfig[] // Calendar ICS URL configurations
  dashboard?: DashboardConfig // Custom dashboard configuration
  device_timezone?: string // IANA timezone from the Android device (e.g. "Europe/Stockholm")
  hr_zone_start?: { 1: number; 2: number; 3: number; 4: number; 5: number }
  lastfm_username?: string // Last.fm username for scrobble sync
  rescue_time_key?: string // RescueTime API key (personal token)
  sex?: BiologicalSex // Biological sex for calorie calculation
  item_icons?: Record<string, string> // Unified icon mappings for all timeline items (tags, activities, exercise types)
  tag_icons?: Record<string, string> // Deprecated: tag-only icons (migrated to item_icons)
  food_sensitivity_map?: Record<string, string[]> // Food item name -> sensitivity areas
  meal_slots?: Array<{ name: string; default_hour: number }> // Meal slots for quick-logging
  sensitivity_areas?: string[] // Sensitivity areas to track in meals
  tag_mappings?: Record<string, string> // Tag name mappings from UUIDs to display names
  training_load?: TrainingLoadSettings // Training load (Banister model) parameters
  garmin_disabled_data_types?: GarminDataType[] // Garmin data types to skip during sync
}

// ============================================================================
// MCP Sessions
// ============================================================================

export interface McpSessionRecord {
  session_id: string
  username: string
  created_at: Date
  last_activity: Date
}
