import type {
  AddCustomMetricBody,
  CustomMetricDefinition,
  CustomMetricsListResponse,
  UpdateCustomMetricBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

// Fetch user's custom metric definitions
export const fetchCustomMetrics = async (): Promise<CustomMetricDefinition[]> => {
  const { token } = auth.value
  const response = await axios.get<CustomMetricsListResponse>(`${API_URL}/metrics/custom`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  return response.data.data ?? []
}

export const addCustomMetric = async (body: AddCustomMetricBody): Promise<CustomMetricDefinition> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; data: CustomMetricDefinition }>(
    `${API_URL}/metrics/custom`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const updateCustomMetric = async (
  name: string,
  body: UpdateCustomMetricBody,
): Promise<CustomMetricDefinition> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean; data: CustomMetricDefinition }>(
    `${API_URL}/metrics/custom/${encodeURIComponent(name)}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const deleteCustomMetric = async (name: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/metrics/custom/${encodeURIComponent(name)}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const mergeCustomMetricApi = async (
  source: string,
  target: string,
): Promise<{ success: boolean; rows_reassigned?: number; rows_skipped?: number }> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; rows_reassigned?: number; rows_skipped?: number }>(
    `${API_URL}/metrics/custom/merge`,
    { source, target },
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data
}
