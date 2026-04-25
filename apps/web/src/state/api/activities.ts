import {
  isMusicScrobbleActivity,
  type ActivitiesQuery,
  type ActivitiesResponse,
  type AddActivityBody,
  type AddActivityResponse,
  type ResyncActivityDetailResponse,
  type UpdateActivityBody,
} from '@aurboda/api-spec'
import axios from 'axios'

import type { Activity, ActivityType, Scrobble } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch activities (sleep, exercise, meditation) for the specified date range
export const fetchActivities = async (
  start: Date,
  end: Date,
  types?: ActivityType[],
  excludeTypes?: string[],
  dataFilter?: string,
  deductionRuleId?: string,
): Promise<Activity[]> => {
  const { token } = auth.value
  const params: ActivitiesQuery = {
    end: end.toISOString(),
    exclude_types: excludeTypes?.join(','),
    start: start.toISOString(),
    types: types?.join(','),
    ...(dataFilter ? { data_filter: dataFilter } : {}),
    ...(deductionRuleId ? { deduction_rule_id: deductionRuleId } : {}),
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

/**
 * Fetch Last.fm scrobbles for the specified date range. Reads from the
 * activities table via `/activities?types=music_scrobble` — there is no
 * longer a dedicated `/lastfm/scrobbles` endpoint.
 */
export const fetchScrobbles = async (start: Date, end: Date): Promise<Scrobble[]> => {
  const activities = await fetchActivities(start, end, ['music_scrobble'])
  return activities.flatMap((a) => {
    if (!isMusicScrobbleActivity(a)) return []
    return [
      {
        album: a.data.album ?? '',
        artist: a.data.artist,
        recorded_at: a.start_time,
        track: a.data.track,
      },
    ]
  })
}

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

export const resyncActivityDetail = async (activityId: string): Promise<ResyncActivityDetailResponse> => {
  const { token } = auth.value
  const response = await axios.post<ResyncActivityDetailResponse>(
    `${API_URL}/activities/${activityId}/resync-detail`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}
