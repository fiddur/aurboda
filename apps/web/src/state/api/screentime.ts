import type {
  CreateScreentimeCategoryBody,
  ScreentimeCategory,
  ScreentimeCategoryListResponse,
  ScreentimeCategoryResponse,
  UpdateScreentimeCategoryBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

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
