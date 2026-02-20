/* eslint-disable max-lines -- TODO: refactor */
import type {
  ActivitiesQuery,
  ActivitiesResponse,
  ActivityCorrelation,
  ActivityImpactData,
  ActivityImpactQuery,
  ActivityImpactResponse,
  ActivityImpactType,
  AddLastFmTagRuleBody,
  AddLastFmTagRuleResponse,
  AddNamedLocationBody,
  AddNamedLocationResponse,
  Activity as ApiActivity,
  DetectedLocation as ApiDetectedLocation,
  PlaceVisit as ApiPlaceVisit,
  ProductivityRecord as ApiProductivityRecord,
  Scrobble as ApiScrobble,
  Tag as ApiTag,
  BaselineData,
  BaselineResponse,
  DashboardConfig,
  DashboardResponse,
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
  PeriodMetricStats,
  PeriodSummaryQuery,
  PeriodSummaryResponse,
  ProductivityCorrelation,
  ProductivityQuery,
  ProductivityResponse,
  ProgrammaticTag,
  ProgrammaticTagsResponse,
  PromoteDetectedLocationBody,
  QueryMetricsBucketedQuery,
  QueryMetricsBucketedResponse,
  QueryMetricsQuery,
  QueryMetricsResponse,
  ScrobblesResponse,
  SetTagMappingResponse,
  SyncResponse,
  TagCorrelation,
  TagMappings,
  TagsQuery,
  TagsResponse,
  TrendDisplayPeriod,
  TrendQuery,
  TrendResponse,
  TrendResult,
  TrendSourceType,
  UniqueTagsResponse,
  UpdateSettingsInput,
  UserSettingsResponse,
} from '@aurboda/api-spec'
import axios from 'axios'
import { API_URL } from '../config'
import { auth } from './auth'

// Frontend types with Date objects (converted from API string types)
export type ActivityType = 'sleep' | 'exercise' | 'meditation' | 'nap'

export interface Activity extends Omit<ApiActivity, 'start_time' | 'end_time'> {
  start_time: Date
  end_time?: Date
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

export interface Tag extends Omit<ApiTag, 'start_time' | 'end_time'> {
  start_time: Date
  end_time?: Date
}

export interface Scrobble extends Omit<ApiScrobble, 'recorded_at'> {
  recorded_at: Date
}

// Re-export API types that don't need Date conversion
export type {
  ActivityCorrelation,
  ActivityImpactData,
  ActivityImpactType,
  AddLastFmTagRuleBody,
  BaselineData,
  DashboardConfig,
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
  TagCorrelation,
  TagMappings,
  TrendDisplayPeriod,
  TrendResult,
  TrendSourceType,
  UpdateSettingsInput,
  UserSettingsResponse,
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

// Fetch activities (sleep, exercise, meditation) for the specified date range
export const fetchActivities = async (
  start: Date,
  end: Date,
  types?: ActivityType[],
): Promise<Activity[]> => {
  const { token } = auth.value
  const params: ActivitiesQuery = {
    end: end.toISOString(),
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

// Fetch productivity data (RescueTime) for the specified date range
export const fetchProductivity = async (start: Date, end: Date): Promise<ProductivityRecord[]> => {
  const { token } = auth.value
  const params: ProductivityQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<ProductivityResponse>(`${API_URL}/productivity`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((record) => ({
    ...record,
    end_time: new Date(record.end_time),
    start_time: new Date(record.start_time),
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

// Fetch tags for the specified date range
export const fetchTags = async (start: Date, end: Date): Promise<Tag[]> => {
  const { token } = auth.value
  const params: TagsQuery = {
    end: end.toISOString(),
    start: start.toISOString(),
  }
  const response = await axios.get<TagsResponse>(`${API_URL}/tags`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  })

  return (response.data.data ?? []).map((tag) => ({
    ...tag,
    end_time: tag.end_time ? new Date(tag.end_time) : undefined,
    start_time: new Date(tag.start_time),
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

// ==========================================================================
// Tag Mappings API
// ==========================================================================

// Fetch all unique tag names
export const fetchUniqueTags = async (): Promise<string[]> => {
  const { token } = auth.value
  const response = await axios.get<UniqueTagsResponse>(`${API_URL}/tags/unique`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

// Fetch programmatic tags (UUIDs, tag_* prefixes) with their current mappings
export const fetchProgrammaticTags = async (): Promise<ProgrammaticTag[]> => {
  const { token } = auth.value
  const response = await axios.get<ProgrammaticTagsResponse>(`${API_URL}/tags/programmatic`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

// Set a tag mapping
export const setTagMapping = async (tagKey: string, name: string): Promise<TagMappings> => {
  const { token } = auth.value
  const response = await axios.post<SetTagMappingResponse>(
    `${API_URL}/tags/mapping`,
    { name, tag_key: tagKey },
    { headers: { Authorization: `Bearer ${token}` } },
  )

  return response.data.mapping ?? {}
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

// Fetch multiple metrics in time buckets (e.g. 1d for daily Oura scores)
export const fetchBucketedMetrics = async (
  start: Date,
  end: Date,
  metrics: string[],
  bucket: string = '1d',
): Promise<QueryMetricsBucketedResponse> => {
  const { token } = auth.value
  const params: QueryMetricsBucketedQuery = {
    bucket: bucket as QueryMetricsBucketedQuery['bucket'],
    end: end.toISOString(),
    metrics: metrics.join(','),
    start: start.toISOString(),
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
// Trends API
// ==========================================================================

export interface FetchTrendParams {
  source_type: TrendSourceType
  pattern: string
  half_life_days?: number
  lookback_days?: number
  display_period?: TrendDisplayPeriod
  aggregation?: 'count' | 'sum' | 'mean'
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

export const softDeleteTag = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/tags/id/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const restoreTag = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.post(
    `${API_URL}/tags/id/${id}/restore`,
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

export const fetchActivityById = async (id: string): Promise<Activity> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/activities/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  const d = response.data.data
  return {
    ...d,
    end_time: d.end_time ? new Date(d.end_time) : undefined,
    start_time: new Date(d.start_time),
  }
}

export const fetchTagById = async (id: string): Promise<Tag> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/tags/id/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

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
