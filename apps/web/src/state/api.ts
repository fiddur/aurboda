import axios from 'axios'
import { API_URL } from '../config'
import { auth } from './auth'

// Types for timeline data
export type ActivityType = 'sleep' | 'exercise' | 'meditation' | 'nap'

export interface Activity {
  id?: string
  source: string
  activityType: ActivityType
  startTime: Date
  endTime?: Date
  title?: string
  notes?: string
}

export interface ProductivityRecord {
  source?: string
  startTime: Date
  endTime: Date
  activity: string
  category?: string
  productivity?: number
  durationSec: number
  isMobile?: boolean
}

export interface Place {
  region: string
  startTime: Date
  endTime: Date
}

export interface PlaceVisit {
  name: string
  lat?: number
  lon?: number
  startTime: Date
  endTime: Date
  durationMinutes: number
  source: 'named' | 'detected' | 'owntracks' | 'unknown'
  address?: string
  detectedLocationId?: string
}

export interface StoredDetectedLocation {
  id: string
  lat: number
  lon: number
  radius: number
  totalMinutes: number
  visitCount: number
  firstVisit: Date
  lastVisit: Date
  address: string | null
  geocodeStatus: 'pending' | 'geocoding' | 'success' | 'failed'
}

export interface NamedLocation {
  id: string
  name: string
  lat: number
  lon: number
  radius: number
}

export interface Tag {
  id?: string
  source: string
  externalId?: string
  tag: string
  startTime: Date
  endTime?: Date
}

// Fetch heart rate data for the specified date range
export const fetchHeartRate = async (start: Date, end: Date): Promise<[Date, number][]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: { time: string; value: number }[]
  }>(`${API_URL}/metrics/heart_rate`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.data.map(({ time, value }) => [new Date(time), value])
}

// Fetch activities (sleep, exercise, meditation) for the specified date range
export const fetchActivities = async (
  start: Date,
  end: Date,
  types?: ActivityType[],
): Promise<Activity[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (Activity & { startTime: string; endTime?: string })[]
  }>(`${API_URL}/activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
      types: types?.join(','),
    },
  })

  return response.data.data.map((activity) => ({
    ...activity,
    endTime: activity.endTime ? new Date(activity.endTime) : undefined,
    startTime: new Date(activity.startTime),
  }))
}

// Fetch productivity data (RescueTime) for the specified date range
export const fetchProductivity = async (start: Date, end: Date): Promise<ProductivityRecord[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (ProductivityRecord & { startTime: string; endTime: string })[]
  }>(`${API_URL}/productivity`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.data.map((record) => ({
    ...record,
    endTime: new Date(record.endTime),
    startTime: new Date(record.startTime),
  }))
}

// Fetch location/place data for the specified date range
export const fetchPlaces = async (start: Date, end: Date): Promise<Place[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (Place & { startTime: string; endTime: string })[]
  }>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.data.map((place) => ({
    ...place,
    endTime: new Date(place.endTime),
    startTime: new Date(place.startTime),
  }))
}

// Fetch tags for the specified date range
export const fetchTags = async (start: Date, end: Date): Promise<Tag[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (Tag & { startTime: string; endTime?: string })[]
  }>(`${API_URL}/tags`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.data.map((tag) => ({
    ...tag,
    endTime: tag.endTime ? new Date(tag.endTime) : undefined,
    startTime: new Date(tag.startTime),
  }))
}

// Fetch place visits for the specified date range
export const fetchPlaceVisits = async (start: Date, end: Date): Promise<PlaceVisit[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (Omit<PlaceVisit, 'startTime' | 'endTime' | 'durationMinutes'> & {
      startTime: string
      endTime: string
      duration: number
    })[]
  }>(`${API_URL}/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.data.map((place) => ({
    ...place,
    durationMinutes: place.duration,
    endTime: new Date(place.endTime),
    startTime: new Date(place.startTime),
  }))
}

// Fetch stored detected locations
export const fetchStoredDetectedLocations = async (): Promise<StoredDetectedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: (Omit<StoredDetectedLocation, 'firstVisit' | 'lastVisit'> & {
      firstVisit: string
      lastVisit: string
    })[]
  }>(`${API_URL}/locations/detected/stored`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data.map((loc) => ({
    ...loc,
    firstVisit: new Date(loc.firstVisit),
    lastVisit: new Date(loc.lastVisit),
  }))
}

// Fetch named locations
export const fetchNamedLocations = async (): Promise<NamedLocation[]> => {
  const { token } = auth.value
  const response = await axios.get<{
    success: boolean
    data: NamedLocation[]
  }>(`${API_URL}/locations/named`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data
}

// Promote a detected location to a named location
export const promoteDetectedLocation = async (params: {
  lat: number
  lon: number
  name: string
  radius?: number
}): Promise<NamedLocation> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    data: NamedLocation
  }>(`${API_URL}/locations/detected/promote`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data
}

// HR Zone types and API functions
export interface HrZoneThresholds {
  1: number
  2: number
  3: number
  4: number
  5: number
}

export interface PeriodMetricStats {
  metric: string
  unit: string
  avg?: number
  min?: number
  max?: number
  sum?: number
  count?: number
  stddev?: number
  trend?: number
  data_points?: number
}

export interface PeriodSummaryResponse {
  success: boolean
  metrics: PeriodMetricStats[]
  period_start?: string
  period_end?: string
}

export interface UserSettingsResponse {
  success: boolean
  hr_zone_start?: HrZoneThresholds
  birth_date?: string
}

// Fetch period summary for specified metrics
export const fetchPeriodSummary = async (
  start: Date,
  end: Date,
  metrics: string[],
): Promise<PeriodSummaryResponse> => {
  const { token } = auth.value
  const response = await axios.get<PeriodSummaryResponse>(`${API_URL}/period-summary`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      metrics: metrics.join(','),
      start: start.toISOString(),
    },
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

export interface UpdateUserSettingsParams {
  birth_date?: string | null
  hr_zone_start?: HrZoneThresholds | null
}

// Update user settings
export const updateUserSettings = async (params: UpdateUserSettingsParams): Promise<UserSettingsResponse> => {
  const { token } = auth.value
  const response = await axios.post<UserSettingsResponse>(`${API_URL}/user/settings`, params, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data
}
