import type {
  ActivitiesQuery,
  ActivitiesResponse,
  AddNamedLocationResponse,
  Activity as ApiActivity,
  DetectedLocation as ApiDetectedLocation,
  PlaceVisit as ApiPlaceVisit,
  ProductivityRecord as ApiProductivityRecord,
  Tag as ApiTag,
  HrZoneThresholds,
  LocationsQuery,
  LocationsResponse,
  NamedLocation,
  NamedLocationsResponse,
  PeriodMetricStats,
  PeriodSummaryQuery,
  PeriodSummaryResponse,
  ProductivityQuery,
  ProductivityResponse,
  PromoteDetectedLocationBody,
  QueryMetricsQuery,
  QueryMetricsResponse,
  TagsQuery,
  TagsResponse,
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
export type { HrZoneThresholds, NamedLocation, PeriodMetricStats, UpdateSettingsInput, UserSettingsResponse }

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
