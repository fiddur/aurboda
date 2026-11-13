import type {
  ItemValueIdentity,
  ItemValueIdentityResponse,
  SetItemValueIdentityBody,
  UnmappedItemValues,
  UnmappedItemValuesResponse,
} from '@aurboda/api-spec'

import axios from 'axios'

import { API_URL } from '../../config'
import { auth } from '../auth'

const itemValuesUrl = (activityType: string): string =>
  `${API_URL}/activity-types/${encodeURIComponent(activityType)}/item-values`

const authHeaders = () => ({ Authorization: `Bearer ${auth.value.token}` })

export const ITEM_VALUE_IDENTITY_INVALIDATED_KEYS = [
  'item-value-identity',
  'unmapped-item-values',
  'activity-field-values',
  'activity-item-history',
  'chart-data',
]

export const fetchItemValueIdentity = async (
  activityType: string,
  field: string,
  value: string,
): Promise<ItemValueIdentity | null> => {
  const response = await axios.get<ItemValueIdentityResponse>(`${itemValuesUrl(activityType)}/identity`, {
    headers: authHeaders(),
    params: { field, value },
  })
  return response.data.data ?? null
}

export const setItemValueIdentityApi = async (
  activityType: string,
  body: SetItemValueIdentityBody,
): Promise<ItemValueIdentity | null> => {
  const response = await axios.put<ItemValueIdentityResponse>(
    `${itemValuesUrl(activityType)}/identity`,
    body,
    {
      headers: authHeaders(),
    },
  )
  return response.data.data ?? null
}

export const clearItemValueIdentityApi = async (
  activityType: string,
  field: string,
  value: string,
): Promise<void> => {
  await axios.delete(`${itemValuesUrl(activityType)}/identity`, {
    headers: authHeaders(),
    params: { field, value },
  })
}

export const fetchUnmappedItemValues = async (
  activityType: string,
  field: string,
): Promise<UnmappedItemValues | null> => {
  const response = await axios.get<UnmappedItemValuesResponse>(`${itemValuesUrl(activityType)}/unmapped`, {
    headers: authHeaders(),
    params: { field },
  })
  return response.data.data ?? null
}
