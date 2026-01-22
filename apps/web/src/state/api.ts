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
