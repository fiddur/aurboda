import axios from 'axios'

import type { DeductionRule, DeductionRuleCondition } from './types'

import { API_URL } from '../../config'
import { auth } from '../auth'

export const fetchDeductionRules = async (): Promise<DeductionRule[]> => {
  const { token } = auth.value
  const response = await axios.get<{ success: boolean; data: DeductionRule[] }>(
    `${API_URL}/deduction-rules`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data ?? []
}

export const previewDeductionRule = async (body: {
  name: string
  conditions: DeductionRuleCondition[]
  output_activity_type: string
  output_title?: string
  merge_gap_seconds?: number
  priority?: number
  mode?: 'create' | 'enrich'
  output_data?: Record<string, unknown>
}): Promise<{ would_affect: number; sample_days: number }> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; would_affect: number; sample_days: number }>(
    `${API_URL}/deduction-rules/preview`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return { sample_days: response.data.sample_days, would_affect: response.data.would_affect }
}

export const createDeductionRule = async (body: {
  name: string
  conditions: DeductionRuleCondition[]
  output_activity_type: string
  output_title?: string
  merge_gap_seconds?: number
  priority?: number
  enabled?: boolean
  mode?: 'create' | 'enrich'
  output_data?: Record<string, unknown>
}): Promise<DeductionRule> => {
  const { token } = auth.value
  const response = await axios.post<{ success: boolean; data: DeductionRule }>(
    `${API_URL}/deduction-rules`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const updateDeductionRule = async (
  id: string,
  body: Partial<{
    name: string
    conditions: DeductionRuleCondition[]
    output_activity_type: string
    output_title: string | null
    merge_gap_seconds: number | null
    priority: number
    enabled: boolean
    mode: 'create' | 'enrich'
    output_data: Record<string, unknown> | null
  }>,
): Promise<DeductionRule> => {
  const { token } = auth.value
  const response = await axios.patch<{ success: boolean; data: DeductionRule }>(
    `${API_URL}/deduction-rules/${id}`,
    body,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  return response.data.data
}

export const deleteDeductionRule = async (id: string): Promise<void> => {
  const { token } = auth.value
  await axios.delete(`${API_URL}/deduction-rules/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export const evaluateDeductionRules = async (): Promise<{
  rules_evaluated: number
  activities_created: number
}> => {
  const { token } = auth.value
  const response = await axios.post<{
    success: boolean
    rules_evaluated: number
    activities_created: number
  }>(
    `${API_URL}/deduction-rules/evaluate`,
    {},
    {
      headers: { Authorization: `Bearer ${token}` },
    },
  )
  return {
    activities_created: response.data.activities_created,
    rules_evaluated: response.data.rules_evaluated,
  }
}
