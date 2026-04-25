import type {
  ProductivityRecord as ApiProductivityRecord,
  ProductivityQuery,
  ProductivityResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { ProductivityRecord } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

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
