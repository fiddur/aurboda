import type {
  ItemValueAlias,
  ItemValueAliasesResponse,
  MergeItemValuesBody,
  MergeItemValuesResponse,
  MergeItemValuesResult,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const itemValuesUrl = (activityType: string): string =>
  `${API_URL}/activity-types/${encodeURIComponent(activityType)}/item-values`

export const mergeItemValuesApi = async (
  activityType: string,
  body: MergeItemValuesBody,
): Promise<MergeItemValuesResult> => {
  const response = await axios.post<MergeItemValuesResponse>(`${itemValuesUrl(activityType)}/merge`, body, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
  })
  return response.data.data ?? { activities_updated: 0, alias: null }
}

export const fetchItemValueAliases = async (
  activityType: string,
  field: string,
): Promise<ItemValueAlias[]> => {
  const response = await axios.get<ItemValueAliasesResponse>(`${itemValuesUrl(activityType)}/aliases`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
    params: { field },
  })
  return response.data.data ?? []
}

export const deleteItemValueAliasApi = async (activityType: string, id: string): Promise<void> => {
  await axios.delete(`${itemValuesUrl(activityType)}/aliases/${encodeURIComponent(id)}`, {
    headers: { Authorization: `Bearer ${auth.value.token}` },
  })
}
