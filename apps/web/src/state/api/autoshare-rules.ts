/** API client for auto-share rules (#903). */
import type {
  AddAutoshareRuleBody,
  AutoshareRule,
  AutoshareRuleResponse,
  AutoshareRulesResponse,
  PreviewAutoshareRuleResponse,
  UpdateAutoshareRuleBody,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const headers = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const listAutoshareRules = async (): Promise<AutoshareRulesResponse> => {
  const response = await axios.get<AutoshareRulesResponse>(`${API_URL}/autoshare-rules`, {
    headers: headers(),
  })
  return response.data
}

export const addAutoshareRule = async (body: AddAutoshareRuleBody): Promise<AutoshareRule> => {
  const response = await axios.post<AutoshareRuleResponse>(`${API_URL}/autoshare-rules`, body, {
    headers: headers(),
  })
  if (!response.data.rule) throw new Error('Create failed: no rule returned')
  return response.data.rule
}

export const updateAutoshareRule = async (
  id: string,
  body: UpdateAutoshareRuleBody,
): Promise<AutoshareRule> => {
  const response = await axios.patch<AutoshareRuleResponse>(
    `${API_URL}/autoshare-rules/${encodeURIComponent(id)}`,
    body,
    { headers: headers() },
  )
  if (!response.data.rule) throw new Error('Update failed: no rule returned')
  return response.data.rule
}

export const deleteAutoshareRule = async (id: string): Promise<void> => {
  await axios.delete(`${API_URL}/autoshare-rules/${encodeURIComponent(id)}`, { headers: headers() })
}

export const previewAutoshareRule = async (
  body: AddAutoshareRuleBody,
): Promise<PreviewAutoshareRuleResponse> => {
  const response = await axios.post<PreviewAutoshareRuleResponse>(
    `${API_URL}/autoshare-rules/preview`,
    body,
    { headers: headers() },
  )
  return response.data
}
