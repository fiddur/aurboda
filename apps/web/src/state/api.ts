/* eslint-disable max-lines -- TODO: refactor */
import type {
  ActivitiesQuery,
  ActivitiesResponse,
  ActivityCorrelation,
  AuditLogResponse,
  ActivityImpactData,
  ActivityImpactQuery,
  ActivityImpactResponse,
  ActivityImpactType,
  AddActivityBody,
  AddActivityResponse,
  AddCustomMetricBody,
  AddReportBody,
  AddLastFmTagRuleBody,
  AddLastFmTagRuleResponse,
  AddMetricBody,
  AddMetricResponse,
  AddNamedLocationBody,
  AddNamedLocationResponse,
  Activity as ApiActivity,
  DetectedLocation as ApiDetectedLocation,
  PlaceVisit as ApiPlaceVisit,
  ProductivityRecord as ApiProductivityRecord,
  Scrobble as ApiScrobble,
  BaselineData,
  BaselineResponse,
  ChartDataBucket,
  ChartDataResponse,
  ChartDataSourceType,
  CreateScreentimeCategoryBody,
  CustomMetricDefinition,
  CustomMetricsListResponse,
  DashboardConfig,
  DashboardResponse,
  DataSchemaDefinition,
  ExerciseTypeName,
  GarminSyncResponse,
  GarminSyncStatusResponse,
  Goal,
  GoalProgress,
  GoalsProgressResponse,
  HrvActivitiesData,
  HrvActivitiesResponse,
  HrvStats,
  HrvStatsWithDelta,
  HrZoneThresholds,
  LastFmMatchMode,
  LastFmMatchType,
  LastFmTagRule,
  LastFmTagRulesResponse,
  LocationCorrelation,
  LocationsQuery,
  LocationsResponse,
  NamedLocation,
  NamedLocationsResponse,
  OuraSyncResponse,
  OuraSyncStatusResponse,
  PeriodMetricStats,
  PeriodSummaryQuery,
  PeriodSummaryResponse,
  ProductivityCorrelation,
  ProductivityQuery,
  ProductivityResponse,
  PromoteDetectedLocationBody,
  QueryMetricsBucketedQuery,
  QueryMetricsBucketedResponse,
  QueryMetricsQuery,
  QueryMetricsResponse,
  Meal as ApiMeal,
  AddMealBody,
  MealResponse,
  MealsResponse,
  MealsQuery,
  UpdateMealBody,
  Report as ApiReport,
  ReportResponse,
  ReportsResponse,
  ScreentimeCategory,
  ScreentimeCategoryListResponse,
  ScreentimeCategoryResponse,
  ScrobblesResponse,
  SyncResponse,
  TrainingLoadResponse,
  TrainingLoadResult,
  TrendDisplayPeriod,
  TrendQuery,
  TrendResponse,
  TrendResult,
  TrendSourceType,
  UpdateActivityBody,
  UpdateCustomMetricBody,
  UpdateLastFmTagRuleBody,
  UpdateLastFmTagRuleResponse,
  UpdateReportBody,
  UpdateScreentimeCategoryBody,
  UpdateSettingsInput,
  UserSettingsResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../config'
import { auth } from './auth'

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
}

export interface DeductionRuleCondition {
  kind: 'activity' | 'tag' | 'screentime_category' | 'activity_data' | 'location' | 'after_date'
  activity_type?: string
  tag_name?: string
  category?: string[]
  field?: string
  operator?: 'eq' | 'neq' | 'exists' | 'not_exists'
  value?: string | number | boolean
  location_name?: string
  date?: string
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
  exercise_type_name?: string
}

export interface Activity extends Omit<ApiActivity, 'start_time' | 'end_time'> {
  start_time: Date
  end_time?: Date
  source_records?: SourceRecord[]
  merged_start_time?: Date
  merged_end_time?: Date
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

export interface Scrobble extends Omit<ApiScrobble, 'recorded_at'> {
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
  AddLastFmTagRuleBody,
  BaselineData,
  CustomMetricDefinition,
  DashboardConfig,
  ExerciseTypeName,
  Goal,
  GoalProgress,
  HrvActivitiesData,
  HrvStats,
  HrvStatsWithDelta,
  HrZoneThresholds,
  LastFmMatchMode,
  LastFmMatchType,
  LastFmTagRule,
  LocationCorrelation,
  NamedLocation,
  PeriodMetricStats,
  ProductivityCorrelation,
  TrendDisplayPeriod,
  TrendResult,
  TrendSourceType,
  UpdateLastFmTagRuleBody,
  UpdateSettingsInput,
  UserSettingsResponse,
}

// Fetch activity type definitions (built-in + custom)
export const fetchActivityTypeDefinitions = async (): Promise<ActivityTypeDefinition[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: ActivityTypeDefinition[] }>(
    `${API_URL}/activity-types`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

// Check if ActivityWatch has ever pushed data (returns sync states per device)
export const fetchActivityWatchStatus = async (): Promise<{ last_sync_time: string | null }[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    states?: { last_sync_time: string | null }[]
  }>(`${API_URL}/sync/activitywatch/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.states ?? []
}

// Generate a fresh API token for the authenticated user (used for push agents like ActivityWatch)
export const generateApiToken = async (): Promise<string> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; token: string }>(`${API_URL}/auth/token`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.token
}

// Fetch heart rate data for the specified date range
export const fetchHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/heart_rate`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch HRV (RMSSD) data for the specified date range
export const fetchHrv = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/hrv_rmssd`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch stress level data for the specified date range
export const fetchStress = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/stress_level`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch HRV sleep (contextual: only during sleep) for the specified date range
export const fetchHrvSleep = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/hrv_sleep`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch activities (sleep, exercise, meditation) for the specified date range
export const fetchActivities = async (
  start: Date,
  end: Date,
  types?: ActivityType[],
  excludeTypes?: string[],
): Promise<Activity[]> => {
  const { token } = auth.value
  const params: ActivitiesQuery = {
    end: end.toISOString(),
    exclude_types: excludeTypes?.join(','),
    start: start.toISOString(),
    types: types?.join(','),
  }
  const response = await axios.get<ActivitiesResponse>(`${API_URL}/activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((activity) => ({
    ...activity,
    end_time: activity.end_time ? new Date(activity.end_time) : undefined,
    start_time: new Date(activity.start_time),
  }))
}

export interface ProductivityResult {
  records: ProductivityRecord[]
  categories?: Record<string, { name: string[]; color?: string; score?: number }>
}

// Fetch productivity data (RescueTime) for the specified date range
export const fetchProductivity = async (
  start: Date,
  end: Date,
  mergeBy?: 'category',
  mergeGapMs?: number,
): Promise<ProductivityResult> => {
  const { token } = auth.value
  const params: ProductivityQuery = {
    end: end.toISOString(),
    merge_by: mergeBy,
    merge_gap_ms: mergeGapMs?.toString(),
    start: start.toISOString(),
  }
  const response = await axios.get<ProductivityResponse>(`${API_URL}/productivity`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return {
    categories: response.data.categories,
    records: (response.data.data ?? []).map((record) => ({
      ...record,
      end_time: new Date(record.end_time),
      start_time: new Date(record.start_time),
    })),
  }
}

// Fetch a single productivity record by ID
export const fetchProductivityById = async (id: string): Promise<ProductivityRecord | null> => {
  const { token } = auth.value
  try {
    const response = await axios.get<{ data: ApiProductivityRecord; success: boolean }>(
      `${API_URL}/productivity/${id}`,
      { headers: { Authorization: `Bearer ${token}` } },
    )
    const record = response.data.data
    return {
      ...record,
      end_time: new Date(record.end_time),
      start_time: new Date(record.start_time),
    }
  } catch {
    return null
  }
}

// Fetch distinct app/title combinations with their categories and usage stats
export interface DistinctApp {
  activity: string
  title?: string
  resolved_category?: string[]
  total_duration_sec: number
  record_count: number
  last_seen?: string
}

export const fetchDistinctApps = async (): Promise<DistinctApp[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: DistinctApp[]; success: boolean }>(
    `${API_URL}/productivity/apps`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

// Fetch screentime bucketed by time and category
export interface ScreentimeBucketCategory {
  path: string[]
  total_sec: number
}

export interface ScreentimeBucketParsed {
  start: Date
  end: Date
  total_sec: number
  categories: ScreentimeBucketCategory[]
}

export const fetchScreentimeBucketed = async (
  start: Date,
  end: Date,
  bucket: string,
  tz?: string,
): Promise<ScreentimeBucketParsed[]> => {
  const { token } = auth.value
  const params: Record<string, string> = {
    bucket,
    end: end.toISOString(),
    start: start.toISOString(),
  }
  if (tz) params.tz = tz
  const response = await axios.get<{
    buckets?: Array<{
      start: string
      end: string
      total_sec: number
      categories: ScreentimeBucketCategory[]
    }>
    success: boolean
  }>(`${API_URL}/productivity/bucketed`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return (response.data.buckets ?? []).map((b) => ({
    categories: b.categories,
    end: new Date(b.end),
    start: new Date(b.start),
    total_sec: b.total_sec,
  }))
}

// Fetch location/place data for the specified date range
export const fetchPlaces = async (start: Date, end: Date): Promise<Place[]> => {
  const { token } = auth.value
  const params: LocationsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<LocationsResponse>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((place) => ({
    ...place,
    end_time: new Date(place.end_time),
    region: place.name,
    start_time: new Date(place.start_time),
  }))
}

// Fetch Last.fm scrobbles for the specified date range
export const fetchScrobbles = async (start: Date, end: Date): Promise<Scrobble[]> => {
  const { token } = auth.value
  const params = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<ScrobblesResponse>(`${API_URL}/lastfm/scrobbles`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((scrobble) => ({
    ...scrobble,
    recorded_at: new Date(scrobble.recorded_at),
  }))
}

// Fetch place visits for the specified date range
export const fetchPlaceVisits = async (start: Date, end: Date): Promise<PlaceVisit[]> => {
  const { token } = auth.value
  const params: LocationsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<LocationsResponse>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((place) => ({
    ...place,
    durationMinutes: place.duration,
    end_time: new Date(place.end_time),
    start_time: new Date(place.start_time),
  }))
}

// Fetch stored detected locations
export const fetchStoredDetectedLocations = async (): Promise<StoredDetectedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: ApiDetectedLocation[] }>(
    `${API_URL}/locations/detected/stored`,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return response.data.data.map((loc) => ({
    ...loc,
    first_visit: new Date(loc.first_visit),
    last_visit: new Date(loc.last_visit),
  }))
}

// Fetch named locations
export const fetchNamedLocations = async (): Promise<NamedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<NamedLocationsResponse>(`${API_URL}/locations/named`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

// Promote a detected location to a named location
export const promoteDetectedLocation = async (
  params: PromoteDetectedLocationBody,
): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.post<AddNamedLocationResponse>(
    `${API_URL}/locations/detected/promote`,
    params,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return response.data.data!
}

// Add a new named location directly
export const addNamedLocation = async (params: AddNamedLocationBody): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.post<AddNamedLocationResponse>(`${API_URL}/locations/named`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}

// Fetch period summary for specified metrics
export const fetchPeriodSummary = async (
  start: Date,
  end: Date,
  metrics: string[],
): Promise<PeriodSummaryResponse> => {
  const { token } = auth.value
  const params: PeriodSummaryQuery = {
    end: end.toISOString(),
    metrics: metrics.join(','),
    start: start.toISOString(),
  }
  const response = await axios.get<PeriodSummaryResponse>(`${API_URL}/period-summary`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data
}

// Fetch user settings (including HR zone thresholds)
export const fetchUserSettings = async (): Promise<UserSettingsResponse> => {
  const { token } = auth.value
  const response = await axios.get<UserSettingsResponse>(`${API_URL}/user/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data
}

// Update user settings
export const updateUserSettings = async (params: UpdateSettingsInput): Promise<UserSettingsResponse> => {
  const { token } = auth.value
  const response = await axios.patch<UserSettingsResponse>(`${API_URL}/user/settings`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data
}

// Upload an icon image, returns { id, url }
export const uploadIcon = async (file: File): Promise<{ id: string; url: string }> => {
  const { token } = auth.value
  const formData = new FormData()
  formData.append('icon', file)
  const response = await axios.post<{ id: string; success: boolean; url: string }>(
    `${API_URL}/icons`,
    formData,
    { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'multipart/form-data' } },
  )
  return { id: response.data.id, url: response.data.url }
}

// Trigger Oura sync
export const syncOura = async (fullResync?: boolean): Promise<OuraSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<OuraSyncResponse>(
    `${API_URL}/sync/oura`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchOuraSyncStatus = async (): Promise<OuraSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<OuraSyncStatusResponse>(`${API_URL}/sync/oura/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

// Garmin Connect auth + sync
export const connectGarmin = async (
  email: string,
  password: string,
): Promise<{ success: boolean; mfa_required?: boolean; error?: string }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/login`,
    { email, password },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const verifyGarminMfa = async (mfaCode: string): Promise<{ success: boolean; error?: string }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/mfa`,
    { mfa_code: mfaCode },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const disconnectGarmin = async (): Promise<{ success: boolean }> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/auth/garmin/disconnect`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const syncGarmin = async (fullResync?: boolean): Promise<GarminSyncResponse> => {
  const { token } = auth.value
  const response = await axios.post<GarminSyncResponse>(
    `${API_URL}/sync/garmin`,
    { full_resync: fullResync },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const fetchGarminSyncStatus = async (): Promise<GarminSyncStatusResponse> => {
  const { token } = auth.value
  const response = await axios.get<GarminSyncStatusResponse>(`${API_URL}/sync/garmin/status`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

/** Fetch item icons from user settings. */
export const fetchItemIcons = async (): Promise<Record<string, string>> => {
  const settings = await fetchUserSettings()
  return settings.item_icons ?? {}
}

// Add a custom activity type definition
export const addActivityTypeDefinition = async (body: {
  name: string
  display_name: string
  display_category: string
  color?: string
  icon?: string
  show_on_timeline?: boolean
}): Promise<ActivityTypeDefinition> => {
  const { token } = auth.value
  const response = await axios.post<{ data: ActivityTypeDefinition; success: boolean }>(
    `${API_URL}/activity-types`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

// Update activity type definition (show_on_timeline, color, icon, display_name, etc.)
export const updateActivityTypeDefinition = async (
  name: string,
  body: Partial<{
    display_name: string
    display_category: string
    color: string
    icon: string
    show_on_timeline: boolean
    data_schema: DataSchemaDefinition | null
  }>,
): Promise<ActivityTypeDefinition> => {
  const { token } = auth.value
  const response = await axios.patch<{ data: ActivityTypeDefinition; success: boolean }>(
    `${API_URL}/activity-types/${encodeURIComponent(name)}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

// Rename an activity type's snake_case identifier
export const renameActivityType = async (
  name: string,
  new_name: string,
): Promise<{
  success: boolean
  activities_updated?: number
  deduction_rules_updated?: number
  data?: ActivityTypeDefinition
}> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    activities_updated?: number
    deduction_rules_updated?: number
    data?: ActivityTypeDefinition
  }>(
    `${API_URL}/activity-types/${encodeURIComponent(name)}/rename`,
    { new_name },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

export const mergeActivityTypeApi = async (
  source: string,
  target: string,
): Promise<{ success: boolean; activities_reassigned?: number; deduction_rules_updated?: number }> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    activities_reassigned?: number
    deduction_rules_updated?: number
  }>(`${API_URL}/activity-types/merge`, { source, target }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}

// Deduction rules CRUD
export const fetchDeductionRules = async (): Promise<DeductionRule[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: DeductionRule[] }>(
    `${API_URL}/deduction-rules`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

export const previewDeductionRule = async (body: {
  name: string
  conditions: DeductionRuleCondition[]
  output_activity_type: string
  output_title?: string
  merge_gap_seconds?: number
  priority?: number
  mode?: 'create' | 'enrich'
  output_data?: Record<string, unknown>
}): Promise<{ would_affect: number; sample_days: number }> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; would_affect: number; sample_days: number }>(
    `${API_URL}/deduction-rules/preview`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return { sample_days: response.data.sample_days, would_affect: response.data.would_affect }
}

export const createDeductionRule = async (body: {
  name: string
  conditions: DeductionRuleCondition[]
  output_activity_type: string
  output_title?: string
  merge_gap_seconds?: number
  priority?: number
  enabled?: boolean
  mode?: 'create' | 'enrich'
  output_data?: Record<string, unknown>
}): Promise<DeductionRule> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; data: DeductionRule }>(
    `${API_URL}/deduction-rules`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const updateDeductionRule = async (
  id: string,
  body: Partial<{
    name: string
    conditions: DeductionRuleCondition[]
    output_activity_type: string
    output_title: string | null
    merge_gap_seconds: number | null
    priority: number
    enabled: boolean
    mode: 'create' | 'enrich'
    output_data: Record<string, unknown> | null
  }>,
): Promise<DeductionRule> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean; data: DeductionRule }>(
    `${API_URL}/deduction-rules/${id}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const deleteDeductionRule = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/deduction-rules/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const evaluateDeductionRules = async (): Promise<{
  rules_evaluated: number
  activities_created: number
}> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    rules_evaluated: number
    activities_created: number
  }>(
    `${API_URL}/deduction-rules/evaluate`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return {
    activities_created: response.data.activities_created,
    rules_evaluated: response.data.rules_evaluated,
  }
}

// Fetch goal progress
export const fetchGoalsProgress = async (): Promise<GoalProgress[]> => {
  const { token } = auth.value
  const response = await axios.get<GoalsProgressResponse>(`${API_URL}/goals/progress`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.goals
}

// ==========================================================================
// Admin API
// ==========================================================================

export type SignupMode = 'open' | 'invite_only' | 'closed'

export interface AdminSettings {
  signup_mode: SignupMode
  admin_count: number
  lastfm_api_key_set: boolean
  oura_webhook_available: boolean
  oura_webhook_enabled: boolean
}

export interface InvitationResult {
  token: string
  url: string
  expires_at: Date
}

// Fetch admin settings
export const fetchAdminSettings = async (): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean } & AdminSettings>(`${API_URL}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return {
    admin_count: response.data.admin_count,
    lastfm_api_key_set: response.data.lastfm_api_key_set,
    oura_webhook_available: response.data.oura_webhook_available,
    oura_webhook_enabled: response.data.oura_webhook_enabled,
    signup_mode: response.data.signup_mode,
  }
}

// Update admin settings
export const updateAdminSettings = async (params: {
  signup_mode?: SignupMode
  lastfm_api_key?: string | null
  oura_webhook_enabled?: boolean
}): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean } & AdminSettings>(
    `${API_URL}/admin/settings`,
    params,
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    admin_count: response.data.admin_count,
    lastfm_api_key_set: response.data.lastfm_api_key_set,
    oura_webhook_available: response.data.oura_webhook_available,
    oura_webhook_enabled: response.data.oura_webhook_enabled,
    signup_mode: response.data.signup_mode,
  }
}

// Generate invitation
export const generateInvitation = async (expiryHours?: number): Promise<InvitationResult> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    token: string
    url: string
    expires_at: string
  }>(
    `${API_URL}/admin/invitations`,
    { expiry_hours: expiryHours },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    expires_at: new Date(response.data.expires_at),
    token: response.data.token,
    url: response.data.url,
  }
}

// ==========================================================================
// Correlation Analysis API
// ==========================================================================

// Fetch HRV/HR baseline (7-day and 30-day averages with trends)
export const fetchBaseline = async (referenceDate?: string): Promise<BaselineData> => {
  const { token } = auth.value
  const params = referenceDate ? { reference_date: referenceDate } : {}
  const response = await axios.get<BaselineResponse>(`${API_URL}/correlations/baseline`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data.data!
}

// Fetch HRV-activities correlations
export const fetchHrvActivitiesCorrelation = async (periodDays?: number): Promise<HrvActivitiesData> => {
  const { token } = auth.value
  const params = periodDays ? { period_days: String(periodDays) } : {}
  const response = await axios.get<HrvActivitiesResponse>(`${API_URL}/correlations/hrv-activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return response.data.data!
}

// Fetch activity impact timeline (HRV/HR before/during/after an activity)
export const fetchActivityImpact = async (
  activity: string,
  activityType: ActivityImpactType,
  periodDays?: number,
  windowMinutes?: number,
): Promise<ActivityImpactData> => {
  const { token } = auth.value
  const params: ActivityImpactQuery = {
    activity_type: activityType,
    ...(periodDays && { period_days: String(periodDays) }),
    ...(windowMinutes && { window_minutes: String(windowMinutes) }),
  }
  const response = await axios.get<ActivityImpactResponse>(
    `${API_URL}/correlations/activity-impact/${encodeURIComponent(activity)}`,
    {
      headers: { Authorization: `Bearer ${token}` },
      params,
    },
  )

  return response.data.data!
}

/** Browser's IANA timezone (e.g. "Europe/Stockholm"), sent to the backend for TZ-aware bucketing. */
const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone

// Fetch multiple metrics in time buckets (e.g. 1d for daily Oura scores)
export const fetchBucketedMetrics = async (
  start: Date,
  end: Date,
  metrics?: string[],
  bucket: string = '1d',
  exclude?: string[],
): Promise<QueryMetricsBucketedResponse> => {
  const { token } = auth.value
  const params: QueryMetricsBucketedQuery = {
    bucket: bucket as QueryMetricsBucketedQuery['bucket'],
    end: end.toISOString(),
    start: start.toISOString(),
    tz: browserTz,
    ...(metrics && { metrics: metrics.join(',') }),
    ...(exclude && { exclude: exclude.join(',') }),
  }
  const response = await axios.get<QueryMetricsBucketedResponse>(`${API_URL}/metrics/bucketed`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return response.data
}

// Fetch sleep metrics time series
export const fetchSleepScores = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/sleep_score`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch readiness scores time series
export const fetchReadinessScores = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/readiness_score`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch resting heart rate time series
export const fetchRestingHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/resting_heart_rate`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// Fetch steps time series
export const fetchSteps = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/steps`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

// ==========================================================================
// Custom Metrics API
// ==========================================================================

// Fetch user's custom metric definitions
export const fetchCustomMetrics = async (): Promise<CustomMetricDefinition[]> => {
  const { token } = auth.value
  const response = await axios.get<CustomMetricsListResponse>(`${API_URL}/metrics/custom`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

// Fetch time series data for any metric (built-in or custom)
export const fetchMetricTimeSeries = async (
  metric: string,
  start: Date,
  end: Date,
): Promise<[Date, number][]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map(({ time, value }) => [new Date(time), value])
}

/** Metric data point with source info for linking to detail views. */
export interface MetricDataPointWithSource {
  time: Date
  value: number
  source: string
  metric: string
}

/** Fetch time series data for a metric including source (for entity linking). */
export const fetchMetricTimeSeriesWithSource = async (
  metric: string,
  start: Date,
  end: Date,
): Promise<MetricDataPointWithSource[]> => {
  const { token } = auth.value
  const params: QueryMetricsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<QueryMetricsResponse>(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((d) => ({
    metric,
    source: d.source ?? 'manual',
    time: new Date(d.time),
    value: d.value,
  }))
}

// ==========================================================================
// Trends API
// ==========================================================================

export interface FetchTrendParams {
  source_type: TrendSourceType
  pattern: string
  half_life_days?: number
  lookback_days?: number
  display_period?: TrendDisplayPeriod
  aggregation?: 'count' | 'sum' | 'mean'
  tag_definition_id?: string
}

// Fetch trend data with EMA calculation
export const fetchTrend = async (params: FetchTrendParams): Promise<TrendResult> => {
  const { token } = auth.value
  // Only include defined values to avoid sending empty strings
  const query: Partial<TrendQuery> = {
    pattern: params.pattern,
    source_type: params.source_type,
  }
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.display_period) query.display_period = params.display_period
  if (params.half_life_days) query.half_life_days = params.half_life_days.toString()
  if (params.lookback_days) query.lookback_days = params.lookback_days.toString()
  if (params.tag_definition_id) query.tag_definition_id = params.tag_definition_id

  const response = await axios.get<TrendResponse>(`${API_URL}/trends`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })

  return response.data.data!
}

// ==========================================================================
// Dashboard API
// ==========================================================================

// Fetch user's dashboard configuration
export const fetchDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.get<DashboardResponse>(`${API_URL}/dashboard`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

// Save dashboard configuration
export const saveDashboard = async (dashboard: DashboardConfig): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.put<DashboardResponse>(`${API_URL}/dashboard`, dashboard, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

// Reset dashboard to default configuration
export const resetDashboard = async (): Promise<DashboardConfig> => {
  const { token } = auth.value
  const response = await axios.post<DashboardResponse>(`${API_URL}/dashboard/reset`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.dashboard
}

// ==========================================================================
// Last.fm Tag Rules API
// ==========================================================================

// Fetch all Last.fm tag rules
export const fetchLastFmTagRules = async (): Promise<LastFmTagRule[]> => {
  const { token } = auth.value
  const response = await axios.get<LastFmTagRulesResponse>(`${API_URL}/lastfm/tag-rules`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

// Create a new Last.fm tag rule
export const createLastFmTagRule = async (rule: AddLastFmTagRuleBody): Promise<LastFmTagRule> => {
  const { token } = auth.value
  const response = await axios.post<AddLastFmTagRuleResponse>(`${API_URL}/lastfm/tag-rules`, rule, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data!
}

// Update an existing Last.fm tag rule
export const updateLastFmTagRule = async (
  ruleId: string,
  body: UpdateLastFmTagRuleBody,
): Promise<LastFmTagRule> => {
  const { token } = auth.value
  const response = await axios.put<UpdateLastFmTagRuleResponse>(
    `${API_URL}/lastfm/tag-rules/${ruleId}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data!
}

// Delete a Last.fm tag rule
export const deleteLastFmTagRule = async (ruleId: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete<SyncResponse>(`${API_URL}/lastfm/tag-rules/${ruleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ============================================================================
// Soft Delete & Restore
// ============================================================================

export const softDeleteActivity = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const updateActivity = async (id: string, body: UpdateActivityBody): Promise<void> => {
  const { token } = auth.value
  await axios.patch(`${API_URL}/activities/${id}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const restoreActivity = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.post(
    `${API_URL}/activities/${id}/restore`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
}

export const softDeleteProductivity = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/productivity/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const restoreProductivity = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.post(
    `${API_URL}/productivity/${id}/restore`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
}

// ============================================================================
// Entity Detail Fetching
// ============================================================================

export interface ActivityDetailResult {
  activity: Activity
  referenced_rules?: Record<string, string>
}

export const fetchActivityById = async (id: string): Promise<ActivityDetailResult> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const d = response.data.data
  return {
    activity: {
      ...d,
      end_time: d.end_time ? new Date(d.end_time) : undefined,
      merged_end_time: d.merged_end_time ? new Date(d.merged_end_time) : undefined,
      merged_start_time: d.merged_start_time ? new Date(d.merged_start_time) : undefined,
      source_records: d.source_records,
      start_time: new Date(d.start_time),
    },
    referenced_rules: response.data.referenced_rules,
  }
}

export const fetchNearbyActivities = async (id: string, hours = 6): Promise<Activity[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/activities/${id}/nearby`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { hours },
  })

  return response.data.data.map((d: Record<string, unknown>) => ({
    ...d,
    end_time: d.end_time ? new Date(d.end_time as string) : undefined,
    start_time: new Date(d.start_time as string),
  }))
}

export const mergeActivities = async (
  activityIds: string[],
  title?: string,
  notes?: string,
): Promise<Activity> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/activities/merge`,
    { activity_ids: activityIds, notes, title },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  const d = response.data.data
  return {
    ...d,
    end_time: d.end_time ? new Date(d.end_time) : undefined,
    start_time: new Date(d.start_time),
  }
}

// ============================================================================
// Notes
// ============================================================================

export interface NoteData {
  id: string
  entity_type: string
  entity_id: string
  content: string
  created_at: string
  updated_at: string
}

export const fetchNotes = async (entityType: string, entityId: string): Promise<NoteData[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/notes`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { entity_id: entityId, entity_type: entityType },
  })

  return response.data.data ?? []
}

export const addNote = async (entityType: string, entityId: string, content: string): Promise<NoteData> => {
  const { token } = auth.value
  const response = await axios.post(
    `${API_URL}/notes`,
    { content, entity_id: entityId, entity_type: entityType },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data
}

export const updateNote = async (id: string, content: string): Promise<NoteData> => {
  const { token } = auth.value
  const response = await axios.patch(
    `${API_URL}/notes/${id}`,
    { content },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.data
}

export const deleteNote = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/notes/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ============================================================================
// Add Data (Activity, Tag, Metric)
// ============================================================================

export const addActivity = async (body: AddActivityBody): Promise<AddActivityResponse> => {
  const { token } = auth.value
  const response = await axios.post<AddActivityResponse>(`${API_URL}/activities`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const uploadFitFile = async (file: File): Promise<AddActivityResponse> => {
  const { token } = auth.value
  const formData = new FormData()
  formData.append('fit_file', file)
  const response = await axios.post<AddActivityResponse>(`${API_URL}/activities/upload-fit`, formData, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

export const addMetric = async (body: AddMetricBody): Promise<AddMetricResponse> => {
  const { token } = auth.value
  const response = await axios.post<AddMetricResponse>(`${API_URL}/metrics`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data
}

/** Delete a single metric measurement (soft delete). */
export const deleteMetricPoint = async (metric: string, time: string, source: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/metrics/${encodeURIComponent(metric)}`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { source, time },
  })
}

// ============================================================================
// Custom Metrics Management
// ============================================================================

export const addCustomMetric = async (body: AddCustomMetricBody): Promise<CustomMetricDefinition> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; data: CustomMetricDefinition }>(
    `${API_URL}/metrics/custom`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const updateCustomMetric = async (
  name: string,
  body: UpdateCustomMetricBody,
): Promise<CustomMetricDefinition> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean; data: CustomMetricDefinition }>(
    `${API_URL}/metrics/custom/${encodeURIComponent(name)}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const deleteCustomMetric = async (name: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/metrics/custom/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const mergeCustomMetricApi = async (
  source: string,
  target: string,
): Promise<{ success: boolean; rows_reassigned?: number; rows_skipped?: number }> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; rows_reassigned?: number; rows_skipped?: number }>(
    `${API_URL}/metrics/custom/merge`,
    { source, target },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

// ============================================================================
// Screentime Categories
// ============================================================================

export const fetchScreentimeCategories = async (): Promise<ScreentimeCategory[]> => {
  const { token } = auth.value
  const response = await axios.get<ScreentimeCategoryListResponse>(`${API_URL}/screentime-categories`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.data ?? []
}

export const fetchScreentimeCategoryById = async (id: string): Promise<ScreentimeCategory | null> => {
  const { token } = auth.value
  try {
    const response = await axios.get<ScreentimeCategoryResponse>(`${API_URL}/screentime-categories/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    return response.data.data ?? null
  } catch {
    return null
  }
}

export const createScreentimeCategory = async (
  body: CreateScreentimeCategoryBody,
): Promise<ScreentimeCategory> => {
  const { token } = auth.value
  const response = await axios.post<ScreentimeCategoryResponse>(`${API_URL}/screentime-categories`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return response.data.data!
}

/** Partial update (PATCH) — used for auto-save on individual fields. */
export const updateScreentimeCategory = async (
  id: string,
  body: UpdateScreentimeCategoryBody,
): Promise<ScreentimeCategory> => {
  const { token } = auth.value
  const response = await axios.patch<ScreentimeCategoryResponse>(
    `${API_URL}/screentime-categories/${id}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data!
}

/** Full upsert (PUT) — used for creating with client-generated UUID. */
export const upsertScreentimeCategory = async (
  id: string,
  body: CreateScreentimeCategoryBody,
): Promise<ScreentimeCategory> => {
  const { token } = auth.value
  const response = await axios.put<ScreentimeCategoryResponse>(
    `${API_URL}/screentime-categories/${id}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data!
}

/** Move a category to a new parent (or top level if null). */
export const moveScreentimeCategory = async (id: string, newParentId: string | null): Promise<void> => {
  const { token } = auth.value
  await axios.patch(
    `${API_URL}/screentime-categories/${id}/move`,
    { new_parent_id: newParentId },
    { headers: { Authorization: `Bearer ${token}` } },
  )
}

export const deleteScreentimeCategory = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/screentime-categories/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const importAwCategories = async (options?: {
  url?: string
  replace?: boolean
}): Promise<ScreentimeCategory[]> => {
  const { token } = auth.value
  const response = await axios.post<ScreentimeCategoryListResponse>(
    `${API_URL}/screentime-categories/import-activitywatch`,
    options ?? {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

export const recategorizeScreentime = async (): Promise<{ records_updated: number }> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; records_updated: number }>(
    `${API_URL}/screentime-categories/recategorize`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return { records_updated: response.data.records_updated }
}

export const fetchDefaultScreentimeCategories = async (): Promise<CreateScreentimeCategoryBody[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: CreateScreentimeCategoryBody[]; success: boolean }>(
    `${API_URL}/screentime-categories/defaults`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

// ==========================================================================
// Training Load API
// ==========================================================================

export const fetchTrainingLoad = async (
  start: Date,
  end: Date,
  bucketSize?: '1h' | '1d' | '1w',
): Promise<TrainingLoadResult> => {
  const { token } = auth.value
  const response = await axios.get<TrainingLoadResponse>(`${API_URL}/training-load`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      bucket_size: bucketSize,
      end: end.toISOString(),
      start: start.toISOString(),
      tz: browserTz,
    },
  })
  return response.data.data!
}

// ==========================================================================
// Reports API
// ==========================================================================

const mapReport = (r: ApiReport): Report => ({
  ...r,
  created_at: r.created_at ? new Date(r.created_at) : undefined,
  date: new Date(r.date),
})

export const fetchReports = async (params?: {
  report_type?: string
  start?: string
  end?: string
}): Promise<Report[]> => {
  const { token } = auth.value
  const response = await axios.get<ReportsResponse>(`${API_URL}/reports`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return (response.data.data ?? []).map(mapReport)
}

export const fetchReport = async (id: string): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.get<ReportResponse>(`${API_URL}/reports/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const createReport = async (body: AddReportBody): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.post<ReportResponse>(`${API_URL}/reports`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const updateReport = async (id: string, body: UpdateReportBody): Promise<Report> => {
  const { token } = auth.value
  const response = await axios.patch<ReportResponse>(`${API_URL}/reports/${id}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapReport(response.data.data!)
}

export const deleteReport = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/reports/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ==========================================================================
// Meals API
// ==========================================================================

const mapMeal = (m: ApiMeal): Meal => ({
  ...m,
  created_at: m.created_at ? new Date(m.created_at) : undefined,
  time: new Date(m.time),
})

export interface MealsResult {
  meals: Meal[]
  log_completed?: boolean
}

export const fetchMeals = async (params?: MealsQuery): Promise<MealsResult> => {
  const { token } = auth.value
  const response = await axios.get<MealsResponse>(`${API_URL}/meals`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return {
    meals: (response.data.data ?? []).map(mapMeal),
    log_completed: response.data.log_completed,
  }
}

export const fetchMeal = async (id: string): Promise<Meal> => {
  const { token } = auth.value
  const response = await axios.get<MealResponse>(`${API_URL}/meals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const addMealApi = async (body: AddMealBody): Promise<Meal> => {
  const { token } = auth.value
  const payload = { ...body, id: body.id ?? crypto.randomUUID() }
  const response = await axios.put<MealResponse>(`${API_URL}/meals`, payload, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const updateMealApi = async (id: string, body: UpdateMealBody): Promise<Meal> => {
  const { token } = auth.value
  const response = await axios.patch<MealResponse>(`${API_URL}/meals/${id}`, body, {
    headers: { Authorization: `Bearer ${token}` },
  })
  return mapMeal(response.data.data!)
}

export const deleteMealApi = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/meals/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Meal log completion

export const setMealLogCompletedApi = async (date: string): Promise<void> => {
  const { token } = auth.value
  await axios.put(`${API_URL}/meals/log-completed/${date}`, null, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const unsetMealLogCompletedApi = async (date: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/meals/log-completed/${date}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// ==========================================================================
// Food Items API
// ==========================================================================

export interface FoodItemEntity {
  id: string
  name: string
  source?: string
  default_quantity?: number
  default_unit?: string
  calories?: number
  protein?: number
  carbs?: number
  fat?: number
  fiber?: number
  [nutrient: string]: string | number | undefined
}

export const searchFoodItemsApi = async (q: string, limit = 10): Promise<FoodItemEntity[]> => {
  const { token } = auth.value
  const response = await axios.get<{ data: FoodItemEntity[]; success: boolean }>(`${API_URL}/food-items`, {
    headers: { Authorization: `Bearer ${token}` },
    params: { q, limit },
  })
  return response.data.data ?? []
}

// ==========================================================================
// Chart Data API (bucketed aggregation for bar charts)
// ==========================================================================

export interface FetchChartDataParams {
  source_type: ChartDataSourceType
  start: string
  end: string
  pattern?: string
  tag_definition_id?: string
  bucket_size?: '1m' | '5m' | '15m' | '1h' | '1d' | '1w' | '1M'
  aggregation?: 'count' | 'sum' | 'mean'
  breakdown_field?: string
}

export interface ChartDataResult {
  buckets: ChartDataBucket[]
  breakdown_field?: string
  breakdown_series?: string[]
  breakdown_buckets?: Array<{ bucket_start: string; series: Record<string, number> }>
}

export const fetchChartData = async (params: FetchChartDataParams): Promise<ChartDataResult> => {
  const { token } = auth.value
  const query: Record<string, string> = {
    source_type: params.source_type,
    start: params.start,
    end: params.end,
  }
  if (params.pattern) query.pattern = params.pattern
  if (params.tag_definition_id) query.tag_definition_id = params.tag_definition_id
  if (params.bucket_size) query.bucket_size = params.bucket_size
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.breakdown_field) query.breakdown_field = params.breakdown_field

  const response = await axios.get<ChartDataResponse>(`${API_URL}/chart-data`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })

  const data = response.data.data
  if (data?.breakdown_field) {
    return {
      breakdown_buckets: data.buckets as Array<{ bucket_start: string; series: Record<string, number> }>,
      breakdown_field: data.breakdown_field,
      breakdown_series: data.breakdown_series,
      buckets: [],
    }
  }

  return { buckets: (data?.buckets ?? []) as ChartDataBucket[] }
}

// ============================================================================
// Audit Log
// ============================================================================

export interface FetchAuditLogParams {
  level?: string
  category?: string
  since?: string
  limit?: number
  offset?: number
}

export const fetchAuditLog = async (params: FetchAuditLogParams = {}): Promise<AuditLogResponse> => {
  const { token } = auth.value
  const response = await axios.get<AuditLogResponse>(`${API_URL}/user/audit-log`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })
  return response.data
}
