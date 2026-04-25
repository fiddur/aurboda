import type { DataSchemaDefinition } from '@aurboda/api-spec'

import axios from 'axios'

import type { ActivityTypeDefinition } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch activity type definitions (built-in + custom)
export const fetchActivityTypeDefinitions = async (): Promise<ActivityTypeDefinition[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: ActivityTypeDefinition[] }>(
    `${API_URL}/activity-types`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

// Add a custom activity type definition
export const addActivityTypeDefinition = async (body: {
  name: string
  display_name: string
  display_category: string
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

// Update activity type definition (show_on_timeline, color, icon, display_name, etc.)
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
): Promise<{ success: boolean; activities_reassigned?: number; deduction_rules_updated?: number }> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    activities_reassigned?: number
    deduction_rules_updated?: number
  }>(`${API_URL}/activity-types/merge`, { source, target }, { headers: { Authorization: `Bearer ${token}` } })
  return response.data
}
