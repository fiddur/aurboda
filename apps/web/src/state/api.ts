import type {
  ActivitiesQuery,
  ActivitiesResponse,
  ActivityCorrelation,
  ActivityImpactData,
  ActivityImpactQuery,
  ActivityImpactResponse,
  ActivityImpactType,
  AddNamedLocationResponse,
  Activity as ApiActivity,
  DetectedLocation as ApiDetectedLocation,
  PlaceVisit as ApiPlaceVisit,
  ProductivityRecord as ApiProductivityRecord,
  Tag as ApiTag,
  BaselineData,
  BaselineResponse,
  Goal,
  GoalProgress,
  GoalsProgressResponse,
  HrvActivitiesData,
  HrvActivitiesResponse,
  HrvStats,
  HrvStatsWithDelta,
  HrZoneThresholds,
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
  QueryMetricsQuery,
  QueryMetricsResponse,
  SetTagMappingResponse,
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

export interface Activity extends Omit<ApiActivity, 'startTime' | 'endTime'> {
  startTime: Date
  endTime?: Date
}

export interface ProductivityRecord extends Omit<ApiProductivityRecord, 'startTime' | 'endTime'> {
  startTime: Date
  endTime: Date
}

export interface Place {
  region: string
  startTime: Date
  endTime: Date
}

export interface PlaceVisit extends Omit<ApiPlaceVisit, 'startTime' | 'endTime'> {
  startTime: Date
  endTime: Date
  durationMinutes: number
}

export interface StoredDetectedLocation extends Omit<ApiDetectedLocation, 'firstVisit' | 'lastVisit'> {
  firstVisit: Date
  lastVisit: Date
}

export interface Tag extends Omit<ApiTag, 'startTime' | 'endTime'> {
  startTime: Date
  endTime?: Date
}

// Re-export API types that don't need Date conversion
export type {
  ActivityCorrelation,
  ActivityImpactData,
  ActivityImpactType,
  BaselineData,
  Goal,
  GoalProgress,
  HrvActivitiesData,
  HrvStats,
  HrvStatsWithDelta,
  HrZoneThresholds,
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
    endTime: activity.endTime ? new Date(activity.endTime) : undefined,
    startTime: new Date(activity.startTime),
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
    endTime: new Date(record.endTime),
    startTime: new Date(record.startTime),
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
    endTime: new Date(place.endTime),
    region: place.name,
    startTime: new Date(place.startTime),
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
    endTime: tag.endTime ? new Date(tag.endTime) : undefined,
    startTime: new Date(tag.startTime),
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
    endTime: new Date(place.endTime),
    startTime: new Date(place.startTime),
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
    firstVisit: new Date(loc.firstVisit),
    lastVisit: new Date(loc.lastVisit),
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
    { name, tagKey },
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
}

export interface InvitationResult {
  token: string
  url: string
  expiresAt: Date
}

// Fetch admin settings
export const fetchAdminSettings = async (): Promise<AdminSettings> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean } & AdminSettings>(`${API_URL}/admin/settings`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return {
    admin_count: response.data.admin_count,
    signup_mode: response.data.signup_mode,
  }
}

// Update admin settings
export const updateAdminSettings = async (params: { signup_mode?: SignupMode }): Promise<AdminSettings> => {
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
    expiresAt: string
  }>(
    `${API_URL}/admin/invitations`,
    { expiryHours },
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )

  return {
    expiresAt: new Date(response.data.expiresAt),
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
  sourceType: TrendSourceType
  pattern: string
  halfLifeDays?: number
  lookbackDays?: number
  displayPeriod?: TrendDisplayPeriod
  aggregation?: 'count' | 'sum' | 'mean'
}

// Fetch trend data with EMA calculation
export const fetchTrend = async (params: FetchTrendParams): Promise<TrendResult> => {
  const { token } = auth.value
  // Only include defined values to avoid sending empty strings
  const query: Partial<TrendQuery> = {
    pattern: params.pattern,
    source_type: params.sourceType,
  }
  if (params.aggregation) query.aggregation = params.aggregation
  if (params.displayPeriod) query.display_period = params.displayPeriod
  if (params.halfLifeDays) query.half_life_days = params.halfLifeDays.toString()
  if (params.lookbackDays) query.lookback_days = params.lookbackDays.toString()

  const response = await axios.get<TrendResponse>(`${API_URL}/trends`, {
    headers: { Authorization: `Bearer ${token}` },
    params: query,
  })

  return response.data.data!
}
