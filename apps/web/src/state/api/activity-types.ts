import type {
  ActivityTypeDefinitionResponse,
  DataSchemaDefinition,
  MergeActivityTypeResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import type { ActivityTypeDefinition } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchActivityTypeDefinitions = async (): Promise<ActivityTypeDefinition[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: ActivityTypeDefinition[] }>(
    `${API_URL}/activity-types`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

export const addActivityTypeDefinition = async (body: {
  name: string
  display_name?: string
  display_category?: string
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
  setData?: Record<string, unknown>,
): Promise<MergeActivityTypeResponse> => {
  const { token } = auth.value
  const response = await axios.post<MergeActivityTypeResponse>(
    `${API_URL}/activity-types/merge`,
    { source, target, ...(setData ? { set_data: setData } : {}) },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}

/** Appends the built-in catalogue fields the type lacks; answers with the updated definition. */
export const addCatalogFieldsToActivityType = async (name: string): Promise<ActivityTypeDefinition> => {
  const { token } = auth.value
  const response = await axios.post<ActivityTypeDefinitionResponse>(
    `${API_URL}/activity-types/${encodeURIComponent(name)}/catalog-fields`,
    {},
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.data.data) throw new Error('The server answered without the updated type')
  return response.data.data
}
