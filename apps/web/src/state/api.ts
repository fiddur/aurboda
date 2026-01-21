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
  const response = await axios.get<[string, number][]>(`${API_URL}/api/heartrate`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.map(([time, rate]) => [new Date(time), rate])
}

// Fetch activities (sleep, exercise, meditation) for the specified date range
export const fetchActivities = async (
  start: Date,
  end: Date,
  types?: ActivityType[],
): Promise<Activity[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/api/activities`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
      types: types?.join(','),
    },
  })

  return response.data.map((activity: Activity & { startTime: string; endTime?: string }) => ({
    ...activity,
    endTime: activity.endTime ? new Date(activity.endTime) : undefined,
    startTime: new Date(activity.startTime),
  }))
}

// Fetch productivity data (RescueTime) for the specified date range
export const fetchProductivity = async (start: Date, end: Date): Promise<ProductivityRecord[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/api/productivity`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.map((record: ProductivityRecord & { startTime: string; endTime: string }) => ({
    ...record,
    endTime: new Date(record.endTime),
    startTime: new Date(record.startTime),
  }))
}

// Fetch location/place data for the specified date range
export const fetchPlaces = async (start: Date, end: Date): Promise<Place[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/api/locations`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.map((place: Place & { startTime: string; endTime: string }) => ({
    ...place,
    endTime: new Date(place.endTime),
    startTime: new Date(place.startTime),
  }))
}

// Fetch tags for the specified date range
export const fetchTags = async (start: Date, end: Date): Promise<Tag[]> => {
  const { token } = auth.value
  const response = await axios.get(`${API_URL}/api/tags`, {
    headers: { Authorization: `Bearer ${token}` },
    params: {
      end: end.toISOString(),
      start: start.toISOString(),
    },
  })

  return response.data.map((tag: Tag & { startTime: string; endTime?: string }) => ({
    ...tag,
    endTime: tag.endTime ? new Date(tag.endTime) : undefined,
    startTime: new Date(tag.startTime),
  }))
}
